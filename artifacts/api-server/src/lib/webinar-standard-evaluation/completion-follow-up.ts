import type { WebinarStandardCatalog, RuleId } from "../webinar-standard-catalog/types";
import { addBusinessDays } from "../webinar-standard-planning-time/business-days";
import type { EvaluationContext, RuleEvaluator, RuleFinding } from "./types";
import type { FollowUpCompletionContext } from "./completion-follow-up-types";

export const FOLLOW_UP_COMPLETION_RULE_IDS = Object.freeze([
  "WEB-FU-ATT-001", "WEB-FU-ABS-001", "WEB-FU-UNK-001", "WEB-FU-UNK-003",
] as const satisfies readonly RuleId[]);
type FollowUpRule = typeof FOLLOW_UP_COMPLETION_RULE_IDS[number];

const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const instant = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const result = (status: RuleFinding["status"], reason: RuleFinding["reason"], message: string): RuleFinding =>
  Object.freeze({ status, reason, evidence: Object.freeze([message]) });
const pass = (m: string) => result("pass", "satisfied", m);
const fail = (m: string) => result("fail", "violation", m);
const missing = (m: string) => result("evidence_unavailable", "missing_evidence", m);
const invalid = (m: string) => result("fail", "invalid_context", m);
const na = (m: string) => result("not_applicable", "condition_not_met", m);

function contextIssue(catalog: WebinarStandardCatalog, c: EvaluationContext, id: FollowUpRule): RuleFinding | null {
  const f = c.completionFollowUp;
  const rule = catalog.rules.find(r => r.ruleId === id);
  if (!rule || !f) return missing("Immutable completion follow-up observations are required.");
  if (f.standardId !== catalog.standardId || f.standardVersion !== catalog.standardVersion
    || f.eventId !== c.event.eventId || !text(f.occurrenceId)
    || f.participantId !== c.participant?.participantId || !text(f.snapshotId)
    || !text(f.timeZone) || !instant(f.observedAtEpochMs) || f.observedAtEpochMs !== c.observedAtEpochMs
    || !Array.isArray(f.sends) || f.attendanceState !== c.participant?.attendanceState) return invalid("Completion follow-up scope, provenance, or observation fields are invalid.");
  if (!["attended", "absent", "unknown"].includes(f.attendanceState)) return invalid("Unknown attendance state.");
  if (f.actualEventEndAtEpochMs !== null && !instant(f.actualEventEndAtEpochMs)) return invalid("Actual event end is not a finite instant.");
  for (const send of f.sends) {
    if (!send || !text(send.communicationId) || send.participantId !== f.participantId
      || !["attended", "absent", "neutral"].includes(send.variant)
      || !["planned", "sent", "recorded", "omitted"].includes(send.state)
      || (send.atEpochMs !== null && !instant(send.atEpochMs))) return invalid("Follow-up observation is malformed or mis-scoped.");
    if (!text(send.evidenceId)) return missing("Scoped operational send evidence identifier is required.");
    if (send.atEpochMs !== null && send.atEpochMs > f.observedAtEpochMs) return invalid("A follow-up observation cannot be from the future.");
    if (f.actualEventEndAtEpochMs !== null && send.atEpochMs !== null && send.atEpochMs < f.actualEventEndAtEpochMs)
      return invalid("A follow-up observation cannot precede actual event completion.");
  }
  if (f.actualEventEndAtEpochMs !== null && f.actualEventEndAtEpochMs > f.observedAtEpochMs)
    return invalid("Actual event completion cannot be after the observation instant.");
  if (f.reconciliation) {
    if (f.reconciliation.participantId !== f.participantId
      || (f.reconciliation.reconciledAtEpochMs !== null && !instant(f.reconciliation.reconciledAtEpochMs)))
      return invalid("Reconciliation evidence is malformed or mis-scoped.");
    if (!text(f.reconciliation.evidenceId)) return missing("Scoped operational reconciliation evidence identifier is required.");
    if (f.reconciliation.reconciledAtEpochMs !== null
      && (f.reconciliation.reconciledAtEpochMs < (f.actualEventEndAtEpochMs ?? -Infinity)
        || f.reconciliation.reconciledAtEpochMs > f.observedAtEpochMs))
      return invalid("Reconciliation instant is outside the observed event interval.");
  }
  try { addBusinessDays(f.actualEventEndAtEpochMs ?? 0, f.timeZone, 0); } catch { return invalid("Time zone must be a valid IANA time zone."); }
  return null;
}

function deadline(f: FollowUpCompletionContext): number | null {
  return f.actualEventEndAtEpochMs === null ? null : addBusinessDays(f.actualEventEndAtEpochMs, f.timeZone, 1).epochMs;
}

function attended(c: EvaluationContext): RuleFinding {
  const f = c.completionFollowUp!;
  if (f.attendanceState !== "attended") return na("Participant is not classified as attended.");
  if (f.actualEventEndAtEpochMs === null) return missing("Actual event completion is required; planned end is not an anchor.");
  const due = deadline(f)!;
  const sent = f.sends.filter(s => s.participantId === f.participantId && s.variant === "attended" && ["sent", "recorded"].includes(s.state));
  if (!sent.length) return missing("A scoped actual attended follow-up observation is required.");
  if (sent.some(s => s.atEpochMs === null)) return missing("Actual attended follow-up time is unavailable.");
  return sent.some(s => s.atEpochMs! <= due) && !f.sends.some(s => s.participantId === f.participantId && s.variant === "absent" && ["sent", "recorded"].includes(s.state))
    ? pass("Attended follow-up was observed within one business day of actual event completion.")
    : fail("Attended follow-up was late or an absent variant was also observed.");
}

function absent(c: EvaluationContext): RuleFinding {
  const f = c.completionFollowUp!;
  if (f.attendanceState !== "absent") return na("Participant is not classified as absent.");
  if (f.actualEventEndAtEpochMs === null) return missing("Actual event completion is required; attendance-data delay cannot supply an anchor.");
  const due = deadline(f)!;
  const sent = f.sends.filter(s => s.participantId === f.participantId && s.variant === "absent" && ["sent", "recorded"].includes(s.state));
  if (!sent.length) return missing("A scoped actual absent follow-up observation is required.");
  if (sent.some(s => s.atEpochMs === null)) return missing("Actual absent follow-up time is unavailable.");
  return sent.some(s => s.atEpochMs! <= due) && !f.sends.some(s => s.participantId === f.participantId && s.variant === "attended" && ["sent", "recorded"].includes(s.state))
    ? pass("Absent follow-up was observed within one business day of actual event completion.")
    : fail("Absent follow-up was late or an attended variant was also observed.");
}

function unknown(c: EvaluationContext): RuleFinding {
  const f = c.completionFollowUp!;
  if (f.attendanceState !== "unknown") return na("Participant attendance is already reconciled.");
  if (f.actualEventEndAtEpochMs === null) return missing("Actual event completion is required for reconciliation.");
  const reconciliation = f.reconciliation;
  if (!reconciliation || reconciliation.participantId !== f.participantId) return missing("Scoped attendance reconciliation evidence is required.");
  const actual = f.sends.filter(s => s.participantId === f.participantId
    && ["attended", "absent"].includes(s.variant) && ["sent", "recorded"].includes(s.state));
  const hasAttended = actual.some(s => s.variant === "attended");
  const hasAbsent = actual.some(s => s.variant === "absent");
  if (hasAttended && hasAbsent) return fail("Attended and absent variants cannot both be observed for one participant.");
  if (reconciliation.reconciledAtEpochMs === null) {
    if (reconciliation.attendanceState !== "unknown" || hasAttended || hasAbsent)
      return invalid("A reconciled attendance state requires a scoped, timestamped reconciliation before variant treatment.");
    return pass("Attendance remains explicitly unresolved and reconciliation is required before treatment.");
  }
  if (reconciliation.attendanceState === "unknown") return invalid("Unknown reconciliation cannot claim a completed reconciliation instant.");
  const reconciliationAt = reconciliation.reconciledAtEpochMs;
  if (reconciliationAt === null) return invalid("Resolved attendance requires a reconciliation instant.");
  if (actual.some(s => s.atEpochMs === null || reconciliationAt > s.atEpochMs!))
    return fail("Attendance reconciliation must precede or equal every attended/absent treatment.");
  if ((reconciliation.attendanceState === "attended" && hasAbsent)
    || (reconciliation.attendanceState === "absent" && hasAttended))
    return fail("Unknown attendance must not produce attended and absent follow-up variants.");
  return pass("Attendance was reconciled with scoped timestamped evidence before follow-up treatment.");
}

function neutral(c: EvaluationContext): RuleFinding {
  const f = c.completionFollowUp!;
  if (f.attendanceState !== "unknown") return na("Neutral treatment applies only while attendance is unknown.");
  if (f.actualEventEndAtEpochMs === null) return missing("Actual event completion is required for neutral eligibility.");
  if (!f.neutralVariantApproved) return na("Neutral follow-up has not been explicitly approved.");
  const due = addBusinessDays(f.actualEventEndAtEpochMs, f.timeZone, 2).epochMs;
  if (f.observedAtEpochMs < due) return na("Two business days have not elapsed.");
  if (!f.reconciliation || f.reconciliation.attendanceState !== "unknown") return na("Attendance was reconciled before neutral eligibility.");
  if (f.sends.some(s => s.participantId === f.participantId && s.variant === "neutral" && ["sent", "recorded"].includes(s.state))) {
    if (f.sends.some(s => s.participantId === f.participantId && s.variant === "neutral"
      && ["sent", "recorded"].includes(s.state) && s.atEpochMs === null))
      return missing("Actual neutral follow-up time is unavailable.");
    if (f.sends.some(s => s.participantId === f.participantId && s.atEpochMs! < due && ["sent", "recorded"].includes(s.state)))
      return fail("Neutral follow-up was observed before its two-business-day eligibility boundary.");
    return pass("The approved neutral variant is observed after two business days unresolved.");
  }
  return missing("Neutral eligibility is not evidence that a neutral follow-up was sent.");
}

export function createCompletionFollowUpEvaluators(catalog: WebinarStandardCatalog): Readonly<Record<FollowUpRule, RuleEvaluator>> {
  const bind = (id: FollowUpRule, fn: (c: EvaluationContext) => RuleFinding): RuleEvaluator => c => {
    const issue = contextIssue(catalog, c, id);
    return issue ?? fn(c);
  };
  return Object.freeze({
    "WEB-FU-ATT-001": bind("WEB-FU-ATT-001", attended),
    "WEB-FU-ABS-001": bind("WEB-FU-ABS-001", absent),
    "WEB-FU-UNK-001": bind("WEB-FU-UNK-001", unknown),
    "WEB-FU-UNK-003": bind("WEB-FU-UNK-003", neutral),
  });
}