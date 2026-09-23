import type { RuleId, StandardId, StandardVersion, WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import type { RuleEvaluationResult, RuleFinding } from "./types";
import type { CompleteObligation } from "../webinar-standard-readiness/types";

export type CompletionObligationState = "resolved" | "unresolved" | "unknown" | "not_applicable";
export type CompletionOutcome =
  | "complete" | "incomplete_blocker" | "incomplete_evidence"
  | "incomplete_operational" | "incomplete_invalid_context"
  | "incomplete_evaluator_unavailable" | "resolvedByException" | "advisory";

/** The data-only boundary for the final evaluator. Callers should freeze this
 * object (and its children) before handing it to an evaluator. */
export interface CompletionSnapshotContext {
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly eventId: string;
  readonly occurrenceId: string;
  readonly calculatedAtEpochMs: number;
  readonly registryFingerprint: string;
  readonly exceptionSnapshotId: string;
  readonly canonicalRuleIds: readonly RuleId[];
  readonly results: readonly CompletionFindingEnvelope[];
  readonly exceptions: readonly unknown[];
  readonly exceptionClaims: readonly { readonly ruleId: string; readonly exceptionId: string }[];
  readonly evidenceSnapshot: {
    readonly snapshotId: string;
    readonly snapshotCompleteness: "complete" | "partial" | "unknown";
    readonly eventId: string;
    readonly occurrenceId: string;
    readonly calculatedAtEpochMs: number;
    readonly registryFingerprint: string;
  } | null;
  readonly operationalObligations: Readonly<Record<CompleteObligation, CompletionObligationState>>;
}

/** A result is not portable by itself: this envelope binds it to the
 * occurrence and immutable calculation snapshot that produced it. */
export interface CompletionFindingEnvelope {
  readonly result: RuleEvaluationResult;
  readonly eventId: string;
  readonly occurrenceId: string;
  readonly calculatedAtEpochMs: number;
  readonly snapshotFingerprint: string;
  readonly evidenceSnapshotId: string;
  readonly exceptionSnapshotId: string;
}

export interface CompletionProjection {
  readonly outcome: CompletionOutcome;
  readonly complete: boolean;
  readonly blockers: readonly RuleEvaluationResult[];
  readonly evidenceUnavailable: readonly RuleEvaluationResult[];
  readonly operationalGaps: readonly string[];
  readonly resolvedByException: readonly RuleId[];
  readonly advisories: readonly RuleEvaluationResult[];
  readonly issues: readonly string[];
}

export interface CompletionDoneEvaluation {
  readonly finding: RuleFinding;
  readonly projection: CompletionProjection;
}

export type CompletionDoneEvaluator = (context: import("./types").EvaluationContext) => RuleFinding;
export type CompletionDoneEvaluatorFactory = (catalog: WebinarStandardCatalog) => CompletionDoneEvaluator;