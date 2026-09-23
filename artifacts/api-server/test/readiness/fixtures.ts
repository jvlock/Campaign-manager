import assert from "node:assert/strict";
import type { ReadinessStage, WebinarStandardRule } from "../../src/lib/webinar-standard-catalog/types";
import type { EvaluationStatus, RuleEvaluationResult } from "../../src/lib/webinar-standard-evaluation/types";
import type { WebinarException } from "../../src/lib/webinar-standard-exceptions/types";
import type { ReadinessInput, ReadinessReport } from "../../src/lib/webinar-standard-readiness/types";
export { catalog, registry, referenceTime, makeContext } from "../evaluation/fixtures";
import { catalog, referenceTime } from "../evaluation/fixtures";

// Synthetic findings exercise aggregation, not implementations of the remaining evaluators.
export function finding(rule: WebinarStandardRule, status: EvaluationStatus = "pass"): RuleEvaluationResult {
  return {
    mode: "descriptive_only", standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    ruleId: rule.ruleId, rule: structuredClone(rule), status,
    reason: status === "pass" ? "satisfied" : status === "fail" ? "violation"
      : status === "evidence_unavailable" ? "missing_evidence"
      : status === "not_applicable" ? "condition_not_met" : "not_implemented",
    participantId: null, evidence: ["Explicit synthetic evidence for aggregation contract tests."],
  };
}

export function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    evaluationTimeEpochMs: referenceTime,
    results: catalog.rules.map((rule) => finding(rule)), exceptions: [], exceptionClaims: [],
    completeObligations: {
      attendanceReconciliation: "resolved", requiredFollowUpCompletion: "resolved",
      exceptionRecording: "resolved", measurementCapture: "resolved",
    },
    ...overrides,
  };
}

export function select(predicate: (rule: WebinarStandardRule) => boolean): WebinarStandardRule {
  const rule = catalog.rules.find(predicate);
  assert.ok(rule, "The authentic catalog must contain this test's rule category");
  return rule;
}

export function withFinding(rule: WebinarStandardRule, status: EvaluationStatus = "fail"): ReadinessInput {
  return input({ results: catalog.rules.map((entry) => finding(entry, entry.ruleId === rule.ruleId ? status : "pass")) });
}

export function exception(rule: WebinarStandardRule, overrides: Partial<WebinarException> = {}): WebinarException {
  return {
    exceptionId: `exception-${rule.ruleId}`, standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    ruleId: rule.ruleId, requirementOverridden: rule.expectedBehavior,
    businessJustification: "Documented pilot business need reviewed against the canonical requirement.",
    requestor: "Pilot requestor", reviewer: "Pilot reviewer", reviewerVerificationStatus: "unverified",
    decision: "approved", decisionAtEpochMs: referenceTime - 100,
    createdAtEpochMs: referenceTime - 200, expiresAtEpochMs: referenceTime + 100,
    expirationRequired: true, compensatingAction: "Manually verify the alternate control.",
    compensatingActionRequired: true, pilotAudit: { pilotReference: "pilot-1", auditReference: "audit-1" },
    ...overrides,
  };
}

export function claimed(rule: WebinarStandardRule, record: unknown = exception(rule)): ReadinessInput {
  return {
    ...withFinding(rule), exceptions: [record],
    exceptionClaims: [{ ruleId: rule.ruleId, exceptionId: `exception-${rule.ruleId}` }],
  };
}

export function stage(report: ReadinessReport, name: ReadinessStage) {
  const value = report.stages.find((entry) => entry.stage === name);
  assert.ok(value);
  return value;
}

export function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value), "Every report object and array must be frozen");
  for (const child of Object.values(value)) assertDeepFrozen(child);
}