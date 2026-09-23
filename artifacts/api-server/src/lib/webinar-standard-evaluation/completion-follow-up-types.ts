import type { StandardId, StandardVersion } from "../webinar-standard-catalog/types";

/** Immutable, caller-supplied observations used by the completion follow-up rules.
 *  These are deliberately observations, not a send request or a delivery adapter. */
export interface FollowUpSendObservation {
  readonly communicationId: string;
  readonly participantId: string;
  readonly variant: "attended" | "absent" | "neutral";
  readonly state: "planned" | "sent" | "recorded" | "omitted";
  readonly atEpochMs: number | null;
  readonly evidenceId: string;
}

export interface FollowUpReconciliationObservation {
  readonly participantId: string;
  readonly attendanceState: "attended" | "absent" | "unknown";
  readonly reconciledAtEpochMs: number | null;
  readonly evidenceId: string;
}

export interface FollowUpCompletionContext {
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly eventId: string;
  readonly occurrenceId: string;
  readonly snapshotId: string;
  readonly observedAtEpochMs: number;
  readonly timeZone: string;
  /** Actual completion, never the planned end and never attendance ingestion time. */
  readonly actualEventEndAtEpochMs: number | null;
  readonly participantId: string;
  readonly attendanceState: "attended" | "absent" | "unknown";
  readonly plannedFollowUp?: {
    readonly variant: "attended" | "absent" | "neutral";
    readonly dueAtEpochMs: number | null;
    readonly communicationId: string;
  } | null;
  readonly sends: readonly FollowUpSendObservation[];
  readonly reconciliation?: FollowUpReconciliationObservation | null;
  readonly neutralVariantApproved?: boolean;
  readonly evidence?: readonly string[];
}