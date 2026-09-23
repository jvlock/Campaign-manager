import type { RuleId, WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { READINESS_STAGES, STANDARD_ID, STANDARD_VERSION } from "../webinar-standard-catalog/types";
import {
  RECRUITMENT_TOUCH_IDENTITIES,
  validateRecruitmentPlanResult,
  type PlannedRecruitmentTouch, type RecruitmentPlan, type RecruitmentTouchIdentity,
  type RecruitmentWarning, type RecruitmentWindowBand,
} from "../webinar-standard-scheduling";
import type {
  RecruitmentConfigurationSnapshot, RecruitmentCreationSnapshot,
} from "./scheduling-types";
import type { EvaluationContext, RuleEvaluator, RuleFinding } from "./types";
import {
  evaluateOmissionDisplay, evaluateSuppression, evaluateSuppressionReadiness,
  validateSchedulingCommonContext,
} from "./scheduling-operational";

export const SCHEDULING_BATCH_RULE_IDS = Object.freeze([
  "WEB-REC-001", "WEB-REC-002", "WEB-REC-003", "WEB-REC-004",
  "WEB-REC-006", "WEB-REC-007", "WEB-REC-009",
  "WEB-WIN-001", "WEB-WIN-002", "WEB-WIN-003", "WEB-WIN-004", "WEB-WIN-005",
  "WEB-RDY-REC-005", "WEB-RDY-REC-006", "WEB-WIN-007",
] as const satisfies readonly RuleId[]);
type BatchId = typeof SCHEDULING_BATCH_RULE_IDS[number];

const BAND_RULE: Readonly<Record<RecruitmentWindowBand, RuleId>> = Object.freeze({
  full_window: "WEB-WIN-001", days_14_to_20: "WEB-WIN-002",
  days_7_to_13: "WEB-WIN-003", days_2_to_6: "WEB-WIN-004",
  days_0_to_1: "WEB-WIN-005", inactive_event: "WEB-WIN-006",
});
const BAND_BY_RULE = new Map<RuleId, RecruitmentWindowBand>(
  Object.entries(BAND_RULE).map(([band, rule]) => [rule, band as RecruitmentWindowBand]),
);
const WARNINGS = new Set<RecruitmentWarning>([
  "compressed_window", "dst_gap_forward", "dst_overlap_earlier", "nominal_touch_past_due",
  "insufficient_24_hour_separation", "duplicate_scheduled_instant", "recruitment_inactive",
]);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const result = (status: RuleFinding["status"], reason: RuleFinding["reason"], detail: string): RuleFinding =>
  Object.freeze({ status, reason, evidence: Object.freeze([detail]) });
const pass = (detail = "Current scoped scheduling evidence satisfies this rule.") => result("pass", "satisfied", detail);
const fail = (detail: string) => result("fail", "violation", detail);
const invalid = (detail: string) => result("fail", "invalid_context", detail);
const missing = (detail: string) => result("evidence_unavailable", "missing_evidence", detail);
const na = (detail = "The canonical trigger is explicitly not met.") => result("not_applicable", "condition_not_met", detail);

function validateConfiguration(c: EvaluationContext, value: RecruitmentConfigurationSnapshot): string | null {
  if (!value || !text(value.snapshotId) || !text(value.occurrenceId)
    || value.occurrenceId !== c.scheduling?.occurrenceId || value.eventId !== c.event.eventId
    || value.standardId !== STANDARD_ID || value.standardVersion !== STANDARD_VERSION
    || typeof value.complete !== "boolean" || !Array.isArray(value.touches)
    || value.touches.some(touch => !touch || typeof touch !== "object")
    || !Array.isArray(value.surfacedWarnings) || value.surfacedWarnings.some(w => !WARNINGS.has(w))) {
    return "Configured recruitment snapshot is malformed, mis-scoped, or incorrectly versioned.";
  }
  const ids = value.touches.map(t => t.identity);
  const comms = value.touches.map(t => t.communicationId);
  if (value.complete && (value.touches.length !== 4 || new Set(ids).size !== 4 || new Set(comms).size !== 4
    || RECRUITMENT_TOUCH_IDENTITIES.some(id => !ids.includes(id)))) return "Complete configured snapshot must contain four unique canonical touches.";
  for (const t of value.touches) {
    if (!RECRUITMENT_TOUCH_IDENTITIES.includes(t.identity) || !text(t.communicationId)
      || !["scheduled", "adjusted", "omitted"].includes(t.disposition)
      || (t.disposition === "omitted" ? t.scheduledAtEpochMs !== null : !Number.isSafeInteger(t.scheduledAtEpochMs))) {
      return "Configured recruitment snapshot contains a malformed touch.";
    }
  }
  return null;
}

function schedulingChecked(fn: (c: EvaluationContext, p: RecruitmentPlan, cfg: RecruitmentConfigurationSnapshot) => RuleFinding): RuleEvaluator {
  return c => {
    const commonIssue = validateSchedulingCommonContext(c);
    if (commonIssue) return invalid(commonIssue);
    const s = c.scheduling;
    if (s === undefined || s === null || s.recruitmentPlan === null || s.configuredPlan === null) {
      return missing("Version-bound scheduler result and configured plan snapshot are required.");
    }
    const planIssue = validateRecruitmentPlanResult(s.recruitmentPlan, {
      standardId: STANDARD_ID, standardVersion: STANDARD_VERSION,
      calculationInstantEpochMs: c.observedAtEpochMs,
      webinarStartEpochMs: c.event.startsAtEpochMs!,
      timeZone: s.timeZone, eventStatus: c.event.operationalStatus,
    });
    if (planIssue) return invalid(planIssue);
    const configIssue = validateConfiguration(c, s.configuredPlan);
    if (configIssue) return invalid(configIssue);
    if (!s.configuredPlan.complete) return missing("A complete configured recruitment snapshot is required.");
    return fn(c, s.recruitmentPlan, s.configuredPlan);
  };
}
function creationChecked(
  fn: (c: EvaluationContext, p: RecruitmentPlan, cfg: RecruitmentConfigurationSnapshot) => RuleFinding,
): RuleEvaluator {
  return c => {
    const commonIssue = validateSchedulingCommonContext(c);
    if (commonIssue) return invalid(commonIssue);
    const creation: RecruitmentCreationSnapshot | null | undefined = c.scheduling?.creationSnapshot;
    if (creation === undefined || creation === null) {
      return missing("Immutable occurrence-creation scheduling evidence is required.");
    }
    if (!text(creation.snapshotId) || creation.occurrenceId !== c.scheduling?.occurrenceId
      || creation.eventId !== c.event.eventId || creation.standardId !== STANDARD_ID
      || creation.standardVersion !== STANDARD_VERSION || !text(creation.timeZone)) {
      return invalid("Creation scheduling snapshot is malformed, mis-scoped, or incorrectly versioned.");
    }
    const planIssue = validateRecruitmentPlanResult(creation.recruitmentPlan, {
      standardId: STANDARD_ID, standardVersion: STANDARD_VERSION,
      calculationInstantEpochMs: creation.capturedAtEpochMs,
      webinarStartEpochMs: c.event.startsAtEpochMs!,
      timeZone: creation.timeZone, eventStatus: creation.eventStatus,
    });
    if (planIssue) return invalid(planIssue);
    const configIssue = validateConfiguration(c, creation.configuredPlan);
    if (configIssue) return invalid(configIssue);
    if (!creation.configuredPlan.complete) return missing("Complete creation configuration evidence is required.");
    return fn(c, creation.recruitmentPlan, creation.configuredPlan);
  };
}
function readyToRecruitChecked(
  fn: (c: EvaluationContext, p: RecruitmentPlan, cfg: RecruitmentConfigurationSnapshot) => RuleFinding,
): RuleEvaluator {
  const evaluate = schedulingChecked(fn);
  return c => {
    const commonIssue = validateSchedulingCommonContext(c);
    if (commonIssue) return invalid(commonIssue);
    const stage = c.scheduling?.evaluationStage;
    if (stage === undefined || stage === null) return missing("Canonical evaluation-stage evidence is required.");
    if (typeof stage !== "string" || !(READINESS_STAGES as readonly string[]).includes(stage)) {
      return invalid("Scheduling evaluation stage is not canonical.");
    }
    if (stage !== "Ready to recruit") return na("This readiness rule is only evaluated at Ready to recruit.");
    return evaluate(c);
  };
}

function touchMatches(planTouch: PlannedRecruitmentTouch, cfg: RecruitmentConfigurationSnapshot): boolean {
  const configured = cfg.touches.find(t => t.identity === planTouch.identity);
  return !!configured && configured.communicationId === planTouch.communicationId
    && configured.disposition === planTouch.disposition
    && configured.scheduledAtEpochMs === planTouch.scheduledAtEpochMs;
}
function allTouchesMatch(plan: RecruitmentPlan, cfg: RecruitmentConfigurationSnapshot): boolean {
  return plan.touches.every(t => touchMatches(t, cfg));
}
function touchEvaluator(identity: RecruitmentTouchIdentity): RuleEvaluator {
  return schedulingChecked((_c, plan, cfg) => {
    const touch = plan.touches.find(t => t.identity === identity)!;
    if (touch.disposition === "omitted") return na("The verified scheduler explicitly omitted this touch under its applicable policy.");
    return touchMatches(touch, cfg) ? pass() : fail("Configured touch does not match the verified scheduler result.");
  });
}
function bandEvaluator(ruleId: RuleId): RuleEvaluator {
  return schedulingChecked((_c, plan, cfg) => {
    if (plan.selectedBand !== BAND_BY_RULE.get(ruleId)) return na();
    if (!allTouchesMatch(plan, cfg)) return fail("Configured touch set does not match the verified scheduler band output.");
    if (ruleId === "WEB-WIN-005" && (!plan.warnings.includes("compressed_window")
      || !cfg.surfacedWarnings.includes("compressed_window"))) {
      return fail("Compressed-window warning is not retained in the configured plan.");
    }
    return pass();
  });
}

export const evaluate_WEB_REC_001 = creationChecked((_c, plan, cfg) => {
  const touch = plan.touches.find(item => item.identity === "recruitment_1")!;
  if (touch.disposition === "omitted") return na("The creation-basis scheduler explicitly omitted this touch.");
  return touchMatches(touch, cfg) ? pass() : fail("Creation-basis configured touch does not match scheduler output.");
});
export const evaluate_WEB_REC_002 = touchEvaluator("recruitment_2");
export const evaluate_WEB_REC_003 = touchEvaluator("recruitment_3");
export const evaluate_WEB_REC_004 = touchEvaluator("final_recruitment");
export const evaluate_WEB_WIN_001 = creationChecked((_c, plan, cfg) => {
  if (plan.selectedBand !== "full_window") return na();
  return allTouchesMatch(plan, cfg) ? pass() : fail("Creation-basis configuration does not match the full-window scheduler output.");
});
export const evaluate_WEB_WIN_002 = bandEvaluator("WEB-WIN-002");
export const evaluate_WEB_WIN_003 = bandEvaluator("WEB-WIN-003");
export const evaluate_WEB_WIN_004 = bandEvaluator("WEB-WIN-004");
export const evaluate_WEB_WIN_005 = bandEvaluator("WEB-WIN-005");
export const evaluate_WEB_RDY_REC_005 = readyToRecruitChecked((_c, plan, cfg) =>
  allTouchesMatch(plan, cfg) ? pass() : fail("The configured recruitment set does not apply the verified scheduler band."));
export function createSchedulingEvaluators(catalog: WebinarStandardCatalog): Readonly<Record<BatchId, RuleEvaluator>> {
  const suppression = (ruleId: "WEB-REC-006" | "WEB-REC-007" | "WEB-REC-009") =>
    schedulingChecked((context, plan, configured) =>
      evaluateSuppression(catalog, context, ruleId, plan, configured));
  const readinessSuppression = readyToRecruitChecked((context, plan, configured) =>
    evaluateSuppressionReadiness(catalog, context, plan, configured));
  const omissionDisplay = schedulingChecked((context, plan, configured) =>
    evaluateOmissionDisplay(catalog, context, plan, configured));
  return Object.freeze({
    "WEB-REC-001": evaluate_WEB_REC_001, "WEB-REC-002": evaluate_WEB_REC_002,
    "WEB-REC-003": evaluate_WEB_REC_003, "WEB-REC-004": evaluate_WEB_REC_004,
    "WEB-REC-006": suppression("WEB-REC-006"),
    "WEB-REC-007": suppression("WEB-REC-007"),
    "WEB-REC-009": suppression("WEB-REC-009"),
    "WEB-WIN-001": evaluate_WEB_WIN_001,
    "WEB-WIN-002": evaluate_WEB_WIN_002, "WEB-WIN-003": evaluate_WEB_WIN_003,
    "WEB-WIN-004": evaluate_WEB_WIN_004, "WEB-WIN-005": evaluate_WEB_WIN_005,
    "WEB-RDY-REC-005": evaluate_WEB_RDY_REC_005, "WEB-RDY-REC-006": readinessSuppression,
    "WEB-WIN-007": omissionDisplay,
  });
}