import { AUDIENCE_COMMUNICATION_KINDS, validateWebinarAudiencePlanResult } from "../webinar-standard-audience";
import type { WebinarStandardCatalog, RuleId } from "../webinar-standard-catalog/types";
import { validateManualEvidence } from "../webinar-standard-evidence/validate";
import type { ManualEvidence } from "../webinar-standard-evidence/types";
import type { EvaluationContext, RuleFinding } from "./types";
import { validMaterialChange } from "./audience-policy";
import type { AudienceCommunicationObservation } from "./audience-types";

export const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export const instant = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= 8_640_000_000_000_000;
const finding = (status: RuleFinding["status"], reason: RuleFinding["reason"], message: string): RuleFinding =>
  Object.freeze({ status, reason, evidence: Object.freeze([message]) });
export const pass = (s: string) => finding("pass", "satisfied", s);
export const fail = (s: string) => finding("fail", "violation", s);
export const invalid = (s: string) => finding("fail", "invalid_context", s);
export const missing = (s: string) => finding("evidence_unavailable", "missing_evidence", s);
export const na = (s: string) => finding("not_applicable", "condition_not_met", s);

export function common(catalog: WebinarStandardCatalog, c: EvaluationContext): RuleFinding | null {
  if (!c || !instant(c.observedAtEpochMs) || !c.event || !text(c.event.eventId)) return invalid("Invalid event/observation context.");
  const a = c.audience;
  if (a == null) return missing("Version-bound audience input and plan are required.");
  if (!text(a.occurrenceId) || !a.input || !a.plan) return invalid("Malformed audience context.");
  const issue = validateWebinarAudiencePlanResult(a.plan, a.input, catalog);
  if (issue) return invalid(issue);
  if (a.input.event.eventId !== c.event.eventId || a.input.event.operationalStatus !== c.event.operationalStatus
    || a.input.event.startsAtEpochMs !== c.event.startsAtEpochMs
    || a.input.calculationInstantEpochMs !== c.observedAtEpochMs
    || a.input.event.observedAtEpochMs !== c.observedAtEpochMs) return invalid("Audience input does not match the current event observation.");
  if (c.participant) {
    const p = a.input.participants.find(p => p.participantId === c.participant!.participantId);
    if (!p || p.eventId !== c.participant.eventId || p.registrationStatus !== c.participant.registrationStatus
      || p.attendanceState !== c.participant.attendanceState || p.audienceClass !== c.participant.audienceClass) {
      return invalid("Selected participant contradicts the supplied audience input.");
    }
  }
  const basis = a.registrationBasis;
  if (basis != null) {
    if (!basis.input || !basis.plan) return invalid("Malformed immutable registration basis.");
    const basisIssue = validateWebinarAudiencePlanResult(basis.plan, basis.input, catalog);
    if (basisIssue) return invalid(basisIssue);
    const original = basis.input.participants.find(p => p.participantId === c.participant?.participantId);
    const current = a.input.participants.find(p => p.participantId === c.participant?.participantId);
    if (basis.input.event.eventId !== a.input.event.eventId || basis.input.event.startsAtEpochMs !== a.input.event.startsAtEpochMs
      || basis.input.timeZone !== a.input.timeZone || basis.input.calculationInstantEpochMs > c.observedAtEpochMs
      || !original || !current || original.registrationStatus !== "registered" || original.registrationAtEpochMs !== current.registrationAtEpochMs
      || basis.input.calculationInstantEpochMs !== original.registrationAtEpochMs) return invalid("Registration basis must match the original successful registration and occurrence.");
  }
  return null;
}

export function evidence(
  catalog: WebinarStandardCatalog, c: EvaluationContext, ruleId: RuleId, value: ManualEvidence,
  snapshotId: string, communicationIds: readonly string[], participantIds: readonly string[],
  artifactVersion: string | null = null,
): RuleFinding | null {
  const result = validateManualEvidence(value, {
    catalog, nowEpochMs: c.observedAtEpochMs, expectedRuleId: ruleId,
    expectedScope: { eventId: c.event.eventId, sessionIds: [c.audience!.occurrenceId],
      participantIds, communicationIds, deliverableIds: [] },
    expectedInputSnapshotVersion: snapshotId, expectedArtifactVersion: artifactVersion, referenceRequired: true,
  });
  if (!result.ok) return invalid("Scoped operational evidence is invalid, expired, or version-mismatched.");
  if (result.evidence.binding.snapshotCompleteness !== "complete"
    || ["incomplete", "unavailable"].includes(result.evidence.evidenceStatus)) return missing("Complete operational evidence is required.");
  if (result.evidence.evidenceStatus === "rejected") return fail("Reviewed operational evidence rejects the required behavior.");
  return null;
}

export function operational(catalog: WebinarStandardCatalog, c: EvaluationContext, ruleId: RuleId): RuleFinding | null {
  const s = c.audience!.operational;
  if (!s) return missing("A complete operational ledger is required; planning is not execution evidence.");
  if (!text(s.snapshotId) || s.occurrenceId !== c.audience!.occurrenceId || s.observedAtEpochMs !== c.observedAtEpochMs
    || s.participantId !== c.participant?.participantId || s.ruleId !== ruleId || typeof s.complete !== "boolean"
    || !Array.isArray(s.communications) || !Array.isArray(s.materialChanges)
    || !Array.isArray(s.recipientHistory)) return invalid("Malformed or mis-scoped operational ledger.");
  const seen = new Set<string>();
  for (const r of s.communications) {
    if (!r || !text(r.communicationId) || seen.has(`${r.communicationId}:${r.triggerAtEpochMs}`)
      || !(["recruitment", ...AUDIENCE_COMMUNICATION_KINDS] as readonly string[]).includes(r.kind)
      || !["delivered", "failed", "scheduled", "suppressed"].includes(r.outcome)
      || typeof r.customerPath !== "boolean" || !instant(r.atEpochMs)
      || (r.outcome !== "scheduled" && r.atEpochMs > c.observedAtEpochMs)
      || !(r.triggerAtEpochMs === null || instant(r.triggerAtEpochMs))
      || typeof r.calendarIncluded !== "boolean" || typeof r.attendanceInformationIncluded !== "boolean"
      || !Array.isArray(r.renderedTimes) || !(r.renderVersion === null || text(r.renderVersion))
      || r.renderedTimes.some((t: AudienceCommunicationObservation["renderedTimes"][number]) => !t || !text(t.text) || !(t.zoneText === null || text(t.zoneText)))
      || (r.kind === "qa_test_send" && r.customerPath !== false)) return invalid("Malformed, duplicate, or contradictory communication ledger.");
    seen.add(`${r.communicationId}:${r.triggerAtEpochMs}`);
    const obligation = c.audience!.plan.participants.find(p => p.participantId === s.participantId)
      ?.obligations.find(o => o.kind === r.kind);
    if (obligation && obligation.communicationId !== r.communicationId) return invalid("Communication identity contradicts the bound audience plan.");
  }
  for (let i = 0; i < s.recipientHistory.length; i++) {
    const h = s.recipientHistory[i]!;
    if (!h || !instant(h.fromEpochMs) || h.fromEpochMs > c.observedAtEpochMs
      || !(h.throughEpochMs === null || (instant(h.throughEpochMs) && h.throughEpochMs > h.fromEpochMs && h.throughEpochMs <= c.observedAtEpochMs))
      || !["registered", "not_registered", "waitlisted", "cancelled"].includes(h.registrationStatus)
      || !["customer", "internal", "test"].includes(h.audienceClass)
      || !["draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled"].includes(h.eventStatus)
      || (i > 0 && s.recipientHistory[i - 1]!.throughEpochMs !== h.fromEpochMs)
      || (h.throughEpochMs === null && i !== s.recipientHistory.length - 1)) return invalid("Recipient history is malformed, overlapping, contradictory, or has gaps.");
  }
  const latest = s.recipientHistory.at(-1);
  if (latest && latest.throughEpochMs === null && (latest.registrationStatus !== c.participant!.registrationStatus
    || latest.audienceClass !== c.participant!.audienceClass || latest.eventStatus !== c.event.operationalStatus)) return invalid("Historical recipient state contradicts the current observation.");
  if (s.materialChanges.some(change => !validMaterialChange(change) || change.changedAtEpochMs > c.observedAtEpochMs)
    || new Set(s.materialChanges.map(change => `${change.field}:${change.changedAtEpochMs}`)).size !== s.materialChanges.length) {
    return invalid("Malformed or duplicate material-change history.");
  }
  const checked = evidence(catalog, c, ruleId, s.evidence, s.snapshotId,
    [...new Set(s.communications.map(r => r.communicationId))], [s.participantId]);
  if (checked && (checked.reason === "invalid_context" || checked.status === "evidence_unavailable")) return checked;
  if (!s.complete) return missing("The operational ledger is incomplete.");
  if (s.evidence.binding.observationThroughEpochMs !== c.observedAtEpochMs
    || !instant(s.evidence.binding.observationFromEpochMs)) return missing("A complete observation interval is required.");
  if (checked) return checked;
  return null;
}

export function historicalRecipient(c: EvaluationContext, at: number) {
  return c.audience!.operational!.recipientHistory.find(h => h.fromEpochMs <= at
    && (h.throughEpochMs === null ? at <= c.observedAtEpochMs : at < h.throughEpochMs));
}

/** Valid evidence is checked before these facts can produce a policy failure. */
export function suppressedPath(c: EvaluationContext): RuleFinding | null {
  const p = c.audience!.input.participants.find(p => p.participantId === c.participant!.participantId)!;
  const records = c.audience!.operational!.communications;
  if (records.some(r => r.customerPath && r.outcome !== "suppressed"
    && (historicalRecipient(c, r.atEpochMs)?.audienceClass ?? p.audienceClass) !== "customer")) {
    return fail("Internal/test recipients must not enter a customer communication path.");
  }
  if (p.audienceClass !== "customer") {
    if (!c.audience!.operational!.recipientHistory.length) return missing("Historical audience-class evidence is required; current internal/test status cannot erase earlier obligations.");
    if (!c.audience!.operational!.recipientHistory.some(h => h.audienceClass === "customer")) {
      return na("Internal/test communications are excluded; labelled QA is not a customer path.");
    }
  }
  if (p.registrationAtEpochMs !== null && records.some(r => r.kind === "recruitment"
    && r.atEpochMs >= p.registrationAtEpochMs! && r.outcome !== "suppressed")) {
    return fail("Registration did not suppress subsequent recruitment.");
  }
  return null;
}