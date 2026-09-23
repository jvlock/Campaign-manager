import { registrantReminderInstant, type AudienceCommunicationKind } from "../webinar-standard-audience";
import { READINESS_STAGES, type RuleId, type WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { validateIncomingResults } from "../webinar-standard-readiness/result-validation";
import type { EvaluationContext, RuleEvaluator, RuleFinding } from "./types";
import { common, evidence, fail, historicalRecipient, instant, invalid, missing, na, operational, pass, suppressedPath, text } from "./audience-helpers";
import { materialNoticeDeadline, materialNoticeRequired } from "./audience-policy";

export const AUDIENCE_BATCH_RULE_IDS = Object.freeze([
  "WEB-REG-001", "WEB-REG-002", "WEB-REG-003", "WEB-REG-004", "WEB-REG-005", "WEB-REG-006",
  "WEB-REG-007", "WEB-REG-008", "WEB-FU-WL-001", "WEB-FU-WL-002", "WEB-FU-WL-003",
  "WEB-FU-CAN-001", "WEB-FU-CAN-002", "WEB-RDY-REC-004", "WEB-RDY-RUN-005",
] as const satisfies readonly RuleId[]);
type AudienceRule = typeof AUDIENCE_BATCH_RULE_IDS[number];
const participant = (c: EvaluationContext) => c.audience!.input.participants.find(p => p.participantId === c.participant!.participantId)!;

function receipt(c: EvaluationContext, kind: AudienceCommunicationKind, trigger: number | null,
  deadline: number | null, immediate = false): RuleFinding {
  if (!instant(trigger)) return missing("Explicit trigger instant and operational receipt are required.");
  const s = c.audience!.operational!;
  if (s.evidence.binding.observationFromEpochMs! > trigger) return missing("The ledger does not cover the trigger instant.");
  const r = s.communications.find(r => r.kind === kind && r.triggerAtEpochMs === trigger);
  if (!r) return fail(`Complete ledger contains no ${kind} receipt for the recorded trigger.`);
  if (!r.customerPath || r.outcome !== "delivered" || r.atEpochMs < trigger
    || (deadline !== null && r.atEpochMs > deadline) || (immediate && r.atEpochMs !== trigger)) {
    return fail(`${kind} was not delivered within its required operational interval.`);
  }
  return pass(`${kind} has a scoped, reviewed operational delivery receipt.`);
}

function registration(c: EvaluationContext, kind: "registration_confirmation" | "calendar_information"): RuleFinding {
  const p = participant(c);
  if (p.registrationAtEpochMs === null) return p.registrationStatus === "registered"
    ? missing("Registration success instant is unavailable.") : na("Registration has not succeeded.");
  const result = receipt(c, kind, p.registrationAtEpochMs, null, kind === "registration_confirmation");
  if (result.status !== "pass" || kind !== "calendar_information") return result;
  const confirmation = receipt(c, "registration_confirmation", p.registrationAtEpochMs, null);
  if (confirmation.status !== "pass") return confirmation;
  const r = c.audience!.operational!.communications.find(r => r.kind === kind && r.triggerAtEpochMs === p.registrationAtEpochMs)!;
  const confirmationRecord = c.audience!.operational!.communications.find(r =>
    r.kind === "registration_confirmation" && r.triggerAtEpochMs === p.registrationAtEpochMs)!;
  return r.calendarIncluded && r.attendanceInformationIncluded && r.atEpochMs >= confirmationRecord.atEpochMs
    ? result : fail("Delivered calendar and attendance information are both required.");
}

function reminder(c: EvaluationContext, kind: "reminder_24_hour" | "reminder_1_hour"): RuleFinding {
  const p = participant(c);
  const due = registrantReminderInstant(c.audience!.input.event.startsAtEpochMs, kind);
  if (c.observedAtEpochMs < due) return na("The reminder delivery deadline has not yet arrived.");
  const history = historicalRecipient(c, due);
  if (!history) return missing("Reviewed historical recipient state at the reminder deadline is required.");
  if (p.registrationAtEpochMs === null) return p.registrationStatus === "registered"
    ? missing("Historical registration instant is unavailable.") : na("No registration at the reminder deadline.");
  // Evaluate recipient state at the deadline, not the state at today's observation.
  const cancelled = p.participantCancellationTriggeredAtEpochMs;
  const eventCancelled = c.audience!.input.event.cancellationTriggeredAtEpochMs;
  if (history.registrationStatus !== "registered" || history.audienceClass !== "customer" || history.eventStatus === "cancelled"
    || p.registrationAtEpochMs >= due || (cancelled !== null && cancelled <= due)
    || (eventCancelled !== null && eventCancelled <= due)) {
    return c.audience!.operational!.communications.some(r => r.kind === kind && r.outcome !== "suppressed")
      ? fail("An ineligible or late registrant received a reminder.") : na("No eligible recipient existed at the nominal reminder deadline.");
  }
  return receipt(c, kind, due, due);
}

function notice(c: EvaluationContext, cancellation: boolean): RuleFinding {
  const a = c.audience!, p = participant(c);
  const changes = a.operational!.materialChanges.filter(change => materialNoticeRequired(change)
    && (cancellation ? change.field === "cancellation" : change.field !== "cancellation"));
  const trigger = cancellation ? a.input.event.cancellationTriggeredAtEpochMs : a.input.event.materialChangeTriggeredAtEpochMs;
  if (cancellation && a.input.event.operationalStatus !== "cancelled") return na("The event is not cancelled; participant cancellation is distinct.");
  if (trigger !== null && !changes.some(change => change.changedAtEpochMs === trigger)) {
    return missing("The explicit event trigger requires a matching reviewed material-change record.");
  }
  if (!changes.length) return cancellation ? missing("Cancellation trigger and change record are required.")
    : na("No applicable participant-facing material change is recorded.");
  const results: RuleFinding[] = [];
  for (const change of changes) {
    const history = historicalRecipient(c, change.changedAtEpochMs);
    if (!history) return missing("Reviewed historical recipient state at the material-change instant is required.");
    if (history.registrationStatus !== "registered" || history.audienceClass !== "customer") continue;
    results.push(receipt(c, cancellation ? "event_cancellation_notice" : "event_change_notice",
      change.changedAtEpochMs, materialNoticeDeadline(change.changedAtEpochMs, a.input.event.startsAtEpochMs)));
  }
  return results.find(r => r.status === "fail") ?? results.find(r => r.status === "evidence_unavailable")
    ?? (results.length ? pass("Every applicable material change was delivered within D2's bounded interval.")
      : na("The participant was not a current registrant at any material-change trigger."));
}

function rendered(catalog: WebinarStandardCatalog, c: EvaluationContext): RuleFinding {
  const records = c.audience!.operational!.communications.filter(r => r.outcome !== "suppressed");
  if (!records.length) return na("The complete ledger contains no rendered communications.");
  const seen = new Set<string>();
  const checks: RuleFinding[] = [];
  for (const r of records) {
    if (!r.renderedEvidence || !text(r.renderVersion)) { checks.push(missing("Each actual rendered artifact requires scoped version-bound source evidence.")); continue; }
    if (seen.has(r.renderedEvidence.evidenceId) || r.renderedEvidence.evidenceId === c.audience!.operational!.evidence.evidenceId) return invalid("Duplicate rendered evidence identity.");
    seen.add(r.renderedEvidence.evidenceId);
    const checked = evidence(catalog, c, "WEB-REG-007", r.renderedEvidence, c.audience!.operational!.snapshotId,
      [r.communicationId], [c.participant!.participantId], r.renderVersion);
    if (checked) checks.push(checked);
    else if (r.renderedTimes.some(t => t.zoneText !== c.audience!.input.timeZone)) checks.push(fail("A rendered event time lacks the correct adjacent event time-zone display."));
  }
  if (checks.length) return checks.find(r => r.reason === "invalid_context") ?? checks.find(r => r.status === "fail") ?? checks[0]!;
  return pass("Complete actual rendered artifacts display a zone alongside every event time.");
}

function late(c: EvaluationContext): RuleFinding {
  const p = participant(c), a = c.audience!;
  if (p.registrationAtEpochMs === null) return p.registrationStatus === "registered" ? missing("Registration instant is required.") : na("Not a registrant.");
  if (!a.registrationBasis) return missing("Immutable registration-time planning basis is required for late-registration cadence.");
  const reminders = a.registrationBasis.plan.participants.find(item => item.participantId === p.participantId)!.obligations
    .filter(o => o.kind === "reminder_24_hour" || o.kind === "reminder_1_hour");
  if (p.registrationAtEpochMs < registrantReminderInstant(a.input.event.startsAtEpochMs, "reminder_24_hour")) return na("Not a late registrant.");
  const confirmation = registration(c, "registration_confirmation");
  if (confirmation.status !== "pass") return confirmation;
  for (const kind of ["reminder_24_hour", "reminder_1_hour"] as const) {
    const due = registrantReminderInstant(a.input.event.startsAtEpochMs, kind);
    const records = a.operational!.communications.filter(r => r.kind === kind && r.outcome !== "suppressed");
    if (due <= p.registrationAtEpochMs || (p.participantCancellationTriggeredAtEpochMs !== null && p.participantCancellationTriggeredAtEpochMs <= due)
      || (a.input.event.cancellationTriggeredAtEpochMs !== null && a.input.event.cancellationTriggeredAtEpochMs <= due)) {
      if (records.length) return fail("A suppressed/backdated reminder remains in the late-registrant path.");
    } else {
      const history = due <= c.observedAtEpochMs ? historicalRecipient(c, due) : null;
      if (due <= c.observedAtEpochMs && !history) return missing("Historical reminder recipient state is unavailable.");
      const eligible = history ? history.audienceClass === "customer" && history.registrationStatus === "registered" && history.eventStatus !== "cancelled"
        : p.audienceClass === "customer" && p.registrationStatus === "registered" && a.input.event.operationalStatus !== "cancelled";
      if (!eligible) {
        if (records.length) return fail("A historically suppressed recipient remains on a late-registration reminder path.");
        continue;
      }
      if (!reminders.some(o => o.kind === kind && o.disposition === "required" && o.dueAtEpochMs === due)
        || !records.some(r => r.atEpochMs === due && r.customerPath && r.triggerAtEpochMs === due
          && (due <= c.observedAtEpochMs ? r.outcome === "delivered" : r.outcome === "scheduled"))) {
        return fail("A remaining future reminder is not correctly configured or delivered.");
      }
      if (records.some(r => r.atEpochMs !== due || r.atEpochMs >= a.input.event.startsAtEpochMs)) return fail("Late registrant reminders may not be backdated or sent at/after start.");
    }
  }
  return pass("Confirmation and only the remaining future reminders are operationally evidenced.");
}

function waitlist(c: EvaluationContext, kind: "waitlist_confirmation" | "waitlist_promotion" | "waitlist_closure"): RuleFinding {
  const p = participant(c);
  const trigger = kind === "waitlist_confirmation" ? p.waitlistedAtEpochMs
    : kind === "waitlist_promotion" ? p.waitlistPromotionTriggeredAtEpochMs : p.waitlistClosureTriggeredAtEpochMs;
  if (trigger === null) return kind === "waitlist_confirmation" && p.registrationStatus === "waitlisted"
    ? missing("Waitlist entry instant is required.") : na("No explicit waitlist trigger is recorded.");
  return receipt(c, kind, trigger, null, kind === "waitlist_confirmation");
}

function cancellation(c: EvaluationContext): RuleFinding {
  const p = participant(c);
  if (p.registrationStatus !== "cancelled") return na("No participant cancellation; event cancellation is a separate state.");
  return receipt(c, "participant_cancellation_confirmation", p.participantCancellationTriggeredAtEpochMs, null);
}

function cancellationSuppression(catalog: WebinarStandardCatalog, c: EvaluationContext): RuleFinding {
  const p = participant(c), s = c.audience!.operational!;
  if (p.registrationStatus !== "cancelled") return na("Participant is not cancelled.");
  const trigger = p.participantCancellationTriggeredAtEpochMs;
  if (trigger === null) return missing("Explicit participant cancellation instant is required.");
  if (s.evidence.binding.observationFromEpochMs! > trigger) return missing("Suppression evidence must cover the cancellation instant.");
  const checks: RuleFinding[] = [];
  const evidenceIds = new Set([s.evidence.evidenceId]);
  for (const r of s.communications) {
    if (!r.customerPath || r.atEpochMs < trigger || r.outcome === "suppressed"
      || r.kind === "participant_cancellation_confirmation") continue;
    if (!r.cancellationPermission) {
      checks.push(fail("A cancelled registrant remains on a subsequent customer communication path without reviewed permission."));
      continue;
    }
    if (evidenceIds.has(r.cancellationPermission.evidenceId)) return invalid("Permission must be an independent uniquely identified explicit reviewed policy record.");
    evidenceIds.add(r.cancellationPermission.evidenceId);
    const checked = evidence(catalog, c, "WEB-FU-CAN-002", r.cancellationPermission,
      s.snapshotId, [r.communicationId], [p.participantId]);
    if (checked) checks.push(checked);
  }
  if (checks.length) return checks.find(r => r.reason === "invalid_context") ?? checks.find(r => r.status === "fail") ?? checks[0]!;
  return pass("All post-cancellation customer paths are suppressed or supported by explicit reviewed policy permission.");
}

function readiness(catalog: WebinarStandardCatalog, c: EvaluationContext, ruleId: "WEB-RDY-REC-004" | "WEB-RDY-RUN-005"): RuleFinding {
  const a = c.audience!, stage = a.evaluationStage;
  if (stage == null) return missing("Canonical evaluation stage is required.");
  if (!(READINESS_STAGES as readonly string[]).includes(stage)) return invalid("Unknown canonical evaluation stage.");
  if (stage !== (ruleId === "WEB-RDY-REC-004" ? "Ready to recruit" : "Ready to run")) return na("Outside this rule's canonical readiness gate.");
  const s = a.configuration;
  if (!s) return missing("A version-bound actual configuration snapshot is required; sends are not configuration.");
  if (!text(s.snapshotId) || s.occurrenceId !== a.occurrenceId || s.observedAtEpochMs !== c.observedAtEpochMs
    || typeof s.complete !== "boolean" || !Array.isArray(s.entries) || !Array.isArray(s.prerequisiteResults)
    || new Set(s.entries.map(e => e?.kind)).size !== s.entries.length
    || new Set(s.entries.map(e => e?.communicationId)).size !== s.entries.length
    || s.entries.some(e => !e || !text(e.communicationId) || !["registration_confirmation", "reminder_24_hour", "reminder_1_hour"].includes(e.kind)
      || !["configured", "omitted"].includes(e.disposition) || typeof e.immediate !== "boolean"
      || !(e.nominalAtEpochMs === null || instant(e.nominalAtEpochMs)))) return invalid("Malformed configuration snapshot.");
  const results = validateIncomingResults(s.prerequisiteResults, catalog);
  const ids: readonly RuleId[] = ruleId === "WEB-RDY-REC-004" ? ["WEB-REG-001"] : ["WEB-REG-003", "WEB-REG-004"];
  if (results.issues.length || results.duplicateRuleIds.length || results.results.some(r => r.participantId !== null || !ids.includes(r.ruleId) || r.reason === "invalid_context")) return invalid("Malformed, unrelated, or invalid-context canonical prerequisites.");
  const checked = evidence(catalog, c, ruleId, s.evidence, s.snapshotId, s.entries.map(e => e.communicationId), []);
  if (checked && (checked.reason === "invalid_context" || checked.status === "evidence_unavailable")) return checked;
  if (!s.complete) return missing("Configuration inventory is incomplete.");
  if (checked) return checked;
  // Operational delivery prerequisites are optional and cannot substitute for actual configuration.
  if (results.results.some(r => r.status === "unimplemented" || r.status === "evidence_unavailable")) return missing("A supplied prerequisite is unavailable.");
  if (results.results.some(r => r.status === "fail")) return fail("A supplied canonical prerequisite failed.");
  const kinds = ruleId === "WEB-RDY-REC-004" ? ["registration_confirmation"] : ["reminder_24_hour", "reminder_1_hour"];
  for (const kind of kinds) {
    const entry = s.entries.find(e => e.kind === kind);
    if (!entry) return fail("Complete configuration inventory is missing a required communication.");
    if (kind === "registration_confirmation") {
      if (entry.disposition !== "configured" || !entry.immediate || entry.nominalAtEpochMs !== null) return fail("Immediate registration confirmation is not configured.");
    } else {
      const planned = a.plan.participants.flatMap(p => p.obligations).filter(o => o.kind === kind);
      if (!planned.length) return missing("A matching audience reminder planning basis is required to validate configuration or omission.");
      const due = registrantReminderInstant(a.input.event.startsAtEpochMs, kind as "reminder_24_hour" | "reminder_1_hour");
      if (entry.nominalAtEpochMs !== due || entry.immediate
        || (entry.disposition === "omitted" && planned.some(o => o.disposition !== "omitted"))
        || (entry.disposition === "configured" && !planned.some(o => o.disposition === "required" && o.dueAtEpochMs === due))
        || (entry.disposition === "omitted" && due > c.observedAtEpochMs)
        || (entry.disposition === "configured" && due <= c.observedAtEpochMs)) return fail("Reminder configuration is not the approved future cadence or a valid past-due omission.");
    }
  }
  return pass("Complete reviewed configuration satisfies the canonical readiness gate.");
}

export function createAudienceEvaluators(catalog: WebinarStandardCatalog): Readonly<Record<AudienceRule, RuleEvaluator>> {
  function bind(id: AudienceRule, evaluate: (c: EvaluationContext) => RuleFinding, config = false): RuleEvaluator {
    return c => {
      const issue = common(catalog, c);
      if (issue) return issue;
      if (config) return evaluate(c);
      if (!c.participant) return missing("A selected participant scope is required.");
      const checked = operational(catalog, c, id);
      if (checked) return checked;
      return suppressedPath(c) ?? evaluate(c);
    };
  }
  return Object.freeze({
    "WEB-REG-001": bind("WEB-REG-001", c => registration(c, "registration_confirmation")),
    "WEB-REG-002": bind("WEB-REG-002", c => registration(c, "calendar_information")),
    "WEB-REG-003": bind("WEB-REG-003", c => reminder(c, "reminder_24_hour")),
    "WEB-REG-004": bind("WEB-REG-004", c => reminder(c, "reminder_1_hour")),
    "WEB-REG-005": bind("WEB-REG-005", c => notice(c, false)),
    "WEB-REG-006": bind("WEB-REG-006", c => notice(c, true)),
    "WEB-REG-007": bind("WEB-REG-007", c => rendered(catalog, c)),
    "WEB-REG-008": bind("WEB-REG-008", late),
    "WEB-FU-WL-001": bind("WEB-FU-WL-001", c => waitlist(c, "waitlist_confirmation")),
    "WEB-FU-WL-002": bind("WEB-FU-WL-002", c => waitlist(c, "waitlist_promotion")),
    "WEB-FU-WL-003": bind("WEB-FU-WL-003", c => waitlist(c, "waitlist_closure")),
    "WEB-FU-CAN-001": bind("WEB-FU-CAN-001", cancellation),
    "WEB-FU-CAN-002": bind("WEB-FU-CAN-002", c => cancellationSuppression(catalog, c)),
    "WEB-RDY-REC-004": bind("WEB-RDY-REC-004", c => readiness(catalog, c, "WEB-RDY-REC-004"), true),
    "WEB-RDY-RUN-005": bind("WEB-RDY-RUN-005", c => readiness(catalog, c, "WEB-RDY-RUN-005"), true),
  });
}