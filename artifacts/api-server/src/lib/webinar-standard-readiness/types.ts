import type { ReadinessStage, RuleId } from "../webinar-standard-catalog/types";
import type { RuleEvaluationResult } from "../webinar-standard-evaluation/types";
import type { WebinarException } from "../webinar-standard-exceptions/types";

export type StageStatus = "ready" | "blocked" | "incomplete";
export type ObligationStatus = "resolved" | "unresolved" | "unknown" | "not_applicable";
export const COMPLETE_OBLIGATIONS = Object.freeze([
  "attendanceReconciliation", "requiredFollowUpCompletion", "exceptionRecording", "measurementCapture",
] as const);
export type CompleteObligation = (typeof COMPLETE_OBLIGATIONS)[number];

/** Explicit links only: supplying an exception record does not claim a resolution. */
export interface ExceptionResolutionClaim {
  readonly ruleId: string;
  readonly exceptionId: string;
}

export interface ReadinessInput {
  readonly evaluationTimeEpochMs: number;
  readonly results: readonly unknown[];
  readonly exceptions: readonly unknown[];
  readonly exceptionClaims: readonly ExceptionResolutionClaim[];
  readonly completeObligations: Readonly<Record<CompleteObligation, ObligationStatus>>;
}

export interface ReadinessIssue {
  readonly code: string;
  readonly ruleId: string | null;
  /** null means the issue cannot safely be attributed to one catalog stage. */
  readonly stage: ReadinessStage | null;
  readonly message: string;
}

export interface ExceptionResolvedBlocker {
  readonly ruleId: RuleId;
  readonly classification: "resolvedByException";
  readonly originalFailure: RuleEvaluationResult;
  readonly exception: WebinarException;
}

export interface PrerequisiteIssue {
  readonly prerequisite: "Ready to run" | CompleteObligation;
  readonly status: "blocked" | "incomplete";
  readonly message: string;
}

export interface StageReadinessResult {
  readonly stage: ReadinessStage;
  readonly status: StageStatus;
  readonly fullyEvaluated: boolean;
  readonly assignedRuleIds: readonly RuleId[];
  /** Conservatively includes missing/invalid results until a valid not-applicable result exists. */
  readonly applicableRuleIds: readonly RuleId[];
  readonly evaluatedRuleIds: readonly RuleId[];
  readonly missingRuleIds: readonly RuleId[];
  readonly passes: readonly RuleEvaluationResult[];
  readonly notApplicable: readonly RuleEvaluationResult[];
  readonly failedBlockers: readonly RuleEvaluationResult[];
  readonly failedNonBlocking: readonly RuleEvaluationResult[];
  /** Warning failures remain visible as a subset of failedNonBlocking. */
  readonly warnings: readonly RuleEvaluationResult[];
  readonly exceptionResolvedBlockers: readonly ExceptionResolvedBlocker[];
  readonly unresolvedRuleIds: readonly RuleId[];
  readonly diagnosticCoveragePercent: number;
  readonly issues: readonly ReadinessIssue[];
  readonly prerequisiteIssues: readonly PrerequisiteIssue[];
}

export interface ReadinessReport {
  readonly mode: "descriptive_only";
  readonly evaluationTimeEpochMs: number | null;
  readonly coverage: {
    readonly totalRuleCount: number;
    readonly implementedRuleCount: number;
    readonly missingEvaluatorCount: number;
    readonly implementedRuleIds: readonly RuleId[];
    readonly missingEvaluatorRuleIds: readonly RuleId[];
  };
  readonly stages: readonly StageReadinessResult[];
  readonly issues: readonly ReadinessIssue[];
}