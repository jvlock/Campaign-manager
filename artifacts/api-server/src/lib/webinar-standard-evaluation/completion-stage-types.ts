import type { RuleEvaluationResult, EvaluationContext } from "./types";
import type { WebinarException } from "../webinar-standard-exceptions/types";
import type { StandardId, StandardVersion } from "../webinar-standard-catalog/types";

/** Caller supplied, read-only observations used by the Complete-stage rules. */
export interface CompletionStageContext {
  readonly standardId?: StandardId;
  readonly standardVersion?: StandardVersion;
  readonly eventId: string;
  readonly occurrenceId: string;
  readonly snapshotId?: string | null;
  readonly complete?: boolean;
  readonly unknownFollowUpResults?: readonly RuleEvaluationResult[];
  readonly followUpResults?: readonly RuleEvaluationResult[];
  readonly results?: readonly RuleEvaluationResult[];
  /** Named evidence buckets mirror the coverage-plan terminology. */
  readonly findingEvidence?: Readonly<{
    readonly unknownFollowUpResults?: readonly RuleEvaluationResult[];
    readonly followUpResults?: readonly RuleEvaluationResult[];
    readonly exceptions?: readonly unknown[];
    readonly sourceFindings?: readonly RuleEvaluationResult[];
    readonly usedExceptionIds?: readonly string[];
  }> | null;
  readonly plannerEvidence?: Readonly<{ readonly audience?: unknown }> | null;
  readonly audience?: Readonly<{
    complete: boolean;
    eventId: string;
    occurrenceId: string;
    participantIds?: readonly string[];
    participants?: readonly Readonly<{
      participantId: string;
      attendanceState: "attended" | "absent" | "unknown";
    }>[];
  }> | null;
  readonly exceptions?: readonly unknown[];
  readonly exceptionClaims?: readonly Readonly<{ ruleId: string; exceptionId: string }>[];
  readonly exceptionProvenance?: readonly Readonly<{
    exceptionId: string; ruleId: string; eventId: string; occurrenceId: string;
    originalFindingId: string; originalStatus: "fail"; originalStandardId: StandardId; originalStandardVersion: StandardVersion;
  }>[];
  readonly usedExceptionIds?: readonly string[];
  readonly sourceFindings?: readonly RuleEvaluationResult[];
  readonly measurementActuals?: readonly Readonly<{
    targetId: string;
    value: number;
    unit: string;
    eventId: string;
    occurrenceId: string;
    snapshotId: string;
    observedAtEpochMs: number;
  }>[];
}

/** Structural type until the owning evaluation types module wires the property. */
export type EvaluationContextWithCompletion = EvaluationContext & {
  readonly completionStage?: CompletionStageContext | null;
};
