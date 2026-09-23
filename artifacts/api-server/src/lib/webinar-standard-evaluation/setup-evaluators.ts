import { Temporal } from "@js-temporal/polyfill";
import { isDeepStrictEqual } from "node:util";
import type { RuleId, WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { READINESS_STAGES } from "../webinar-standard-catalog/types";
import { assertInstant, assertTimeZone, localTime } from "../webinar-standard-planning-time/time";
import type { EvaluationContext, RuleEvaluator, RuleFinding } from "./types";
import type { SetupContext } from "./setup-types";

/** Exact section-5 coverage-plan rows whose Proposed batch column is 1. */
export const SETUP_BATCH_RULE_IDS = Object.freeze([
  "WEB-SETUP-001", "WEB-SETUP-002", "WEB-SETUP-004", "WEB-SETUP-005",
  "WEB-SETUP-006", "WEB-SETUP-007", "WEB-SETUP-008", "WEB-SETUP-009",
  "WEB-SETUP-010", "WEB-SETUP-011", "WEB-SETUP-013", "WEB-SETUP-014",
  "WEB-SETUP-015", "WEB-SETUP-016", "WEB-SETUP-017", "WEB-SETUP-018",
  "WEB-SETUP-020", "WEB-SETUP-C01", "WEB-SETUP-C05", "WEB-RDY-REC-001",
  "WEB-RDY-REC-007", "WEB-QA-008", "WEB-MEAS-001",
] as const satisfies readonly RuleId[]);
type BatchId = typeof SETUP_BATCH_RULE_IDS[number];
const result = (status: RuleFinding["status"], reason: RuleFinding["reason"], detail: string): RuleFinding =>
  Object.freeze({ status, reason, evidence: Object.freeze([detail]) });
const pass = () => result("pass", "satisfied", "Required setup evidence satisfies this rule.");
const fail = (detail: string) => result("fail", "violation", detail);
const invalid = (detail: string) => result("fail", "invalid_context", detail);
const missing = (detail: string) => result("evidence_unavailable", "missing_evidence", detail);
const na = () => result("not_applicable", "condition_not_met", "The canonical trigger is explicitly not met.");
const nonblank = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const absent = (v: unknown) => v === undefined || v === null;

function checked(fn: (c: EvaluationContext, s: SetupContext) => RuleFinding, readiness = false): RuleEvaluator {
  return (c) => {
    try { assertInstant(c.observedAtEpochMs, "observedAtEpochMs"); }
    catch { return invalid("Invalid observation instant."); }
    if (!c.event || !nonblank(c.event.eventId)
      || !["draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled"]
        .includes(c.event.operationalStatus)) return invalid("Invalid event identity or operational status.");
    if (!absent(c.event.startsAtEpochMs)) {
      try { assertInstant(c.event.startsAtEpochMs, "event.startsAtEpochMs"); }
      catch { return invalid("Invalid event start instant."); }
    }
    const s = c.setup;
    if (absent(s)) return missing("Current setup snapshot is unavailable.");
    if (!s || typeof s !== "object" || !nonblank(s.snapshotId) || s.eventId !== c.event.eventId
      || typeof s.complete !== "boolean") return invalid("Malformed or incorrectly scoped setup snapshot.");
    if (absent(s.activityType)) return missing("Activity type is unknown.");
    if (!nonblank(s.activityType)) return invalid("Malformed activity type.");
    if (s.activityType !== "Webinar") return na();
    if (readiness) {
      if (absent(s.evaluationStage)) return missing("Evaluation stage is unknown.");
      if (!(READINESS_STAGES as readonly string[]).includes(s.evaluationStage!)) {
        return invalid("Invalid evaluation stage.");
      }
      if (s.evaluationStage !== "Ready to recruit") return na();
    }
    return fn(c, s);
  };
}

function requiredText(v: unknown, s: { readonly complete: boolean }, label: string): RuleFinding {
  if (absent(v)) return s.complete ? fail(`${label} is absent in the complete snapshot.`) : missing(`${label} is unavailable.`);
  if (typeof v !== "string") return invalid(`${label} must be text.`);
  return nonblank(v) ? pass() : fail(`${label} is empty.`);
}
function anyText(a: unknown, b: unknown, s: SetupContext, label: string): RuleFinding {
  if ([a, b].some(v => !absent(v) && typeof v !== "string")) return invalid(`${label} must be text.`);
  if (nonblank(a) || nonblank(b)) return pass();
  if (!s.complete && (absent(a) || absent(b))) return missing(`${label} is unavailable.`);
  return fail(`${label} is empty.`);
}
const textField = (key: keyof SetupContext): RuleEvaluator => checked((_c, s) => requiredText(s[key], s, key));

export const evaluate_WEB_SETUP_001 = textField("title");
export const evaluate_WEB_SETUP_002 = checked((_c, s) => anyText(s.topic, s.description, s, "Topic or description"));
export const evaluate_WEB_SETUP_004 = textField("intendedAudience");
export const evaluate_WEB_SETUP_005 = checked((c, s) => {
  const date = requiredText(s.eventLocalDate, s, "Event date");
  if (date.status !== "pass") return date;
  const zone = requiredText(s.timeZone, s, "Time zone");
  if (zone.status !== "pass") return zone;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.eventLocalDate!)) return invalid("Event date must be an ISO local date.");
    const d = Temporal.PlainDate.from(s.eventLocalDate!, { overflow: "reject" });
    return Temporal.PlainDate.compare(d, localTime(c.observedAtEpochMs, s.timeZone!).date) >= 0
      ? pass() : fail("Event local date precedes the observation local date.");
  } catch { return invalid("Invalid local event date or IANA time zone."); }
});
export const evaluate_WEB_SETUP_006 = checked((c, s) => {
  const time = requiredText(s.localStartTime, s, "Start time");
  if (time.status !== "pass") return time;
  try {
    if (!/^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(s.localStartTime!)) return invalid("Start time must be an ISO local time.");
    const t = Temporal.PlainTime.from(s.localStartTime!, { overflow: "reject" });
    if (absent(c.event.startsAtEpochMs) || absent(s.eventLocalDate) || absent(s.timeZone)) {
      return missing("Resolved event instant, event date and time zone are required to validate the entered start time.");
    }
    const resolved = localTime(c.event.startsAtEpochMs!, s.timeZone!);
    if (Temporal.PlainTime.compare(t, resolved.time) !== 0 || resolved.date !== s.eventLocalDate) {
      return invalid("Entered local start time/date does not match the resolved event instant.");
    }
    return pass();
  } catch { return invalid("Invalid local start time or resolved event instant."); }
});
export const evaluate_WEB_SETUP_007 = checked((_c, s) => {
  if (absent(s.durationMinutes)) return s.complete ? fail("Duration is absent.") : missing("Duration is unavailable.");
  if (typeof s.durationMinutes !== "number" || !Number.isFinite(s.durationMinutes)) return invalid("Duration must be finite.");
  return s.durationMinutes! > 0 ? pass() : fail("Duration must be positive.");
});
export const evaluate_WEB_SETUP_008 = checked((_c, s) => {
  const value = requiredText(s.timeZone, s, "Time zone");
  if (value.status !== "pass") return value;
  try { assertTimeZone(s.timeZone); return pass(); } catch { return invalid("Invalid IANA time zone."); }
});
export const evaluate_WEB_SETUP_009 = checked((_c, s) => {
  const value = requiredText(s.format, s, "Format");
  if (value.status !== "pass") return value;
  return ["live", "hybrid", "simulated live", "on-demand"].includes(s.format!) ? pass() : invalid("Unsupported format.");
});
export const evaluate_WEB_SETUP_010 = checked((_c, s) => anyText(s.platform, s.physicalLocation, s, "Platform or physical location"));
export const evaluate_WEB_SETUP_011 = textField("registrationDestination");
export const evaluate_WEB_SETUP_013 = textField("owner");
export const evaluate_WEB_SETUP_014 = textField("recruitmentOwner");
export const evaluate_WEB_SETUP_015 = textField("followUpOwner");
export const evaluate_WEB_SETUP_016 = textField("primaryCta");
export const evaluate_WEB_SETUP_017 = textField("followUpCta");
export const evaluate_WEB_SETUP_018 = checked((_c, s) => {
  if (absent(s.measurementTargets)) return s.complete ? fail("No measurement target selected.") : missing("Measurement selections unavailable.");
  if (!Array.isArray(s.measurementTargets) || !s.measurementTargets.every(nonblank)
    || new Set(s.measurementTargets).size !== s.measurementTargets.length) return invalid("Malformed measurement target selections.");
  return s.measurementTargets.length > 0 ? pass() : fail("At least one measurement target must be selected.");
});
export const evaluate_WEB_SETUP_020 = checked((_c, s) => {
  const opening = requiredText(s.registrationOpeningRule, s, "Registration opening rule");
  const closing = requiredText(s.registrationClosingRule, s, "Registration closing rule");
  return combine([opening, closing]);
});
export const evaluate_WEB_SETUP_C01 = checked((_c, s) => {
  if (absent(s.platformEnforcesCapacity)) return missing("Platform capacity enforcement is unknown.");
  if (typeof s.platformEnforcesCapacity !== "boolean") return invalid("Malformed capacity trigger.");
  if (!s.platformEnforcesCapacity) return na();
  if (absent(s.capacity)) return s.complete ? fail("Capacity is absent.") : missing("Capacity is unavailable.");
  if (typeof s.capacity !== "number" || !Number.isSafeInteger(s.capacity)) return invalid("Capacity must be a finite integer.");
  return s.capacity! > 0 ? pass() : fail("Capacity must be positive.");
});
export const evaluate_WEB_SETUP_C05 = checked((_c, s) => {
  if (absent(s.audienceNonDefaultLanguage)) return missing("Audience language applicability is unknown.");
  if (typeof s.audienceNonDefaultLanguage !== "boolean") return invalid("Malformed language trigger.");
  return s.audienceNonDefaultLanguage ? requiredText(s.language, s, "Language") : na();
});
function combine(findings: readonly RuleFinding[]): RuleFinding {
  return findings.find(f => f.reason === "invalid_context") ?? findings.find(f => f.status === "fail")
    ?? findings.find(f => f.status === "evidence_unavailable") ?? pass();
}
export const evaluate_WEB_QA_008 = checked((_c, s) =>
  combine([requiredText(s.recruitmentOwner, s, "Recruitment owner"), requiredText(s.followUpOwner, s, "Follow-up owner")]), true);
export const evaluate_WEB_MEAS_001 = checked((c, s) => {
  const p = c.measurementPlan;
  if (absent(p)) return missing("Measurement plan unavailable.");
  if (!p || typeof p !== "object" || p.eventId !== c.event.eventId || p.snapshotId !== s.snapshotId
    || typeof p.complete !== "boolean") return invalid("Malformed or incorrectly scoped measurement plan.");
  const description = requiredText(p.description, p, "Measurement plan definition");
  if (description.status !== "pass") return description;
  if (absent(p.targets)) return p.complete ? fail("Measurement targets absent.") : missing("Measurement targets unavailable.");
  if (!Array.isArray(p.targets) || p.targets.some(t => !t || !nonblank(t.targetId) || !nonblank(t.metric)
    || !nonblank(t.unit) || typeof t.target !== "number" || !Number.isFinite(t.target))
    || new Set(p.targets.map(t => t.targetId)).size !== p.targets.length) return invalid("Malformed measurement targets.");
  return p.targets.length ? pass() : fail("Measurement targets absent.");
}, true);

function prerequisites(catalog: WebinarStandardCatalog, ids: readonly RuleId[], key: "setupResults" | "ownerResults"): RuleEvaluator {
  return checked((c, s) => {
    const envelope = c.findingEvidence;
    if (absent(envelope)) return missing("Scoped prerequisite findings unavailable.");
    if (!envelope || typeof envelope !== "object" || envelope.standardId !== catalog.standardId
      || envelope.standardVersion !== catalog.standardVersion || envelope.eventId !== c.event.eventId
      || envelope.snapshotId !== s.snapshotId || typeof envelope.complete !== "boolean"
      || envelope.observedAtEpochMs !== c.observedAtEpochMs) return invalid("Prerequisite findings have invalid identity, scope, version or observation.");
    const findings = envelope[key];
    if (absent(findings)) return missing("Prerequisite results unavailable.");
    if (!Array.isArray(findings)) return invalid("Prerequisite results must be an array.");
    const seen = new Set<RuleId>();
    for (const f of findings) {
      const canonical = f && catalog.rules.find(r => r.ruleId === f.ruleId);
      if (!canonical || !ids.includes(f.ruleId) || seen.has(f.ruleId)
        || f.standardId !== catalog.standardId || f.standardVersion !== catalog.standardVersion
        || f.mode !== "descriptive_only" || f.participantId !== null || !isDeepStrictEqual(f.rule, canonical)
        || !Array.isArray(f.evidence) || !f.evidence.length || !f.evidence.every(nonblank)) {
        return invalid("Forged, duplicate, unrelated or malformed prerequisite finding.");
      }
      const validReason = (f.status === "pass" && f.reason === "satisfied")
        || (f.status === "fail" && ["violation", "invalid_context"].includes(f.reason))
        || (f.status === "not_applicable" && f.reason === "condition_not_met" && f.ruleId.startsWith("WEB-SETUP-C"))
        || (f.status === "evidence_unavailable" && f.reason === "missing_evidence")
        || (f.status === "unimplemented" && f.reason === "not_implemented");
      if (!validReason) return invalid("Invalid prerequisite status or reason.");
      seen.add(f.ruleId);
    }
    if (findings.some(f => f.reason === "invalid_context")) return invalid("A prerequisite setup rule has invalid context.");
    if (findings.some(f => f.status === "fail")) return fail("A prerequisite setup rule failed.");
    if (!envelope.complete || ids.some(id => !seen.has(id))
      || findings.some(f => f.status === "unimplemented" || f.status === "evidence_unavailable")) {
      return missing("Complete evaluated prerequisite coverage and evidence are required.");
    }
    return pass();
  }, true);
}
export function evaluate_WEB_RDY_REC_001(catalog: WebinarStandardCatalog): RuleEvaluator {
  // Section A comprises the canonical setup records, including conditional fields.
  return prerequisites(catalog, catalog.rules.filter(r => r.ruleId.startsWith("WEB-SETUP-")).map(r => r.ruleId), "setupResults");
}
export function evaluate_WEB_RDY_REC_007(catalog: WebinarStandardCatalog): RuleEvaluator {
  return prerequisites(catalog, ["WEB-SETUP-013", "WEB-SETUP-014", "WEB-SETUP-015"], "ownerResults");
}
export function createSetupEvaluators(catalog: WebinarStandardCatalog): Readonly<Record<BatchId, RuleEvaluator>> {
  return Object.freeze({
    "WEB-SETUP-001": evaluate_WEB_SETUP_001, "WEB-SETUP-002": evaluate_WEB_SETUP_002,
    "WEB-SETUP-004": evaluate_WEB_SETUP_004, "WEB-SETUP-005": evaluate_WEB_SETUP_005,
    "WEB-SETUP-006": evaluate_WEB_SETUP_006, "WEB-SETUP-007": evaluate_WEB_SETUP_007,
    "WEB-SETUP-008": evaluate_WEB_SETUP_008, "WEB-SETUP-009": evaluate_WEB_SETUP_009,
    "WEB-SETUP-010": evaluate_WEB_SETUP_010, "WEB-SETUP-011": evaluate_WEB_SETUP_011,
    "WEB-SETUP-013": evaluate_WEB_SETUP_013, "WEB-SETUP-014": evaluate_WEB_SETUP_014,
    "WEB-SETUP-015": evaluate_WEB_SETUP_015, "WEB-SETUP-016": evaluate_WEB_SETUP_016,
    "WEB-SETUP-017": evaluate_WEB_SETUP_017, "WEB-SETUP-018": evaluate_WEB_SETUP_018,
    "WEB-SETUP-020": evaluate_WEB_SETUP_020, "WEB-SETUP-C01": evaluate_WEB_SETUP_C01,
    "WEB-SETUP-C05": evaluate_WEB_SETUP_C05, "WEB-QA-008": evaluate_WEB_QA_008,
    "WEB-MEAS-001": evaluate_WEB_MEAS_001,
    "WEB-RDY-REC-001": evaluate_WEB_RDY_REC_001(catalog),
    "WEB-RDY-REC-007": evaluate_WEB_RDY_REC_007(catalog),
  });
}