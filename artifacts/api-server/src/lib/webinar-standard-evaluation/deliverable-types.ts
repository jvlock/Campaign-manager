import type { ReadinessStage, RuleId, StandardId, StandardVersion } from "../webinar-standard-catalog/types";
import type { ManualEvidence } from "../webinar-standard-evidence";
import type { RuleEvaluationResult } from "./types";

export type DeliverableRole = "speaker" | "recording_statement" | "waitlist_procedure"
  | "handraiser" | "support_channel" | "accessibility" | "sales_handoff"
  | "message" | "plan" | "registration_page" | "brief" | "supporting_content"
  | "capture" | "qa_checklist";

/** Concrete current versions, not planned production or a claim that QA occurred. */
export interface DeliverableArtifact {
  readonly deliverableId: string;
  readonly role: DeliverableRole;
  readonly eventId: string;
  readonly occurrenceId: string;
  readonly contentVersion: string;
  readonly versionCreatedAtEpochMs: number;
  readonly lifecycle: "planned" | "produced";
  readonly communicationId: string | null;
  readonly assetId: string | null;
  readonly destinationId: string | null;
  readonly content: string;
  readonly owner: string | null;
  readonly dueAtEpochMs: number | null;
  /** Speaker participation status is not proof of confirmation or materials receipt. */
  readonly speakerConfirmed: boolean | null;
  readonly reviews: readonly DeliverableReview[];
}
export interface DeliverableReview {
  readonly ruleId: RuleId;
  readonly kind: "review" | "test" | "approval" | "receipt" | "observation";
  readonly evidence: ManualEvidence;
}
export interface DeliverableCommunication {
  readonly communicationId: string;
  readonly eventId: string;
  readonly occurrenceId: string;
  readonly kind: "recruitment" | "confirmation" | "reminder" | "change" | "cancellation"
    | "waitlist" | "follow_up" | "qa_test";
  readonly channel: string;
  readonly variant: "attended" | "absent" | "neutral" | "test" | null;
  readonly audienceState: "attended" | "absent" | "unknown" | "internal_test" | "registrant" | "non_registrant" | "waitlisted";
}
/** Each supplied prerequisite is a canonical finding plus its current scoped provenance. */
export interface DeliverablePrerequisite {
  readonly result: RuleEvaluationResult;
  readonly evidence: ManualEvidence;
}
export interface DeliverableEvaluationContext {
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly eventId: string;
  readonly occurrenceId: string;
  readonly snapshotVersion: string;
  readonly snapshotCreatedAtEpochMs: number;
  readonly complete: boolean;
  readonly activityType: string | null;
  readonly evaluationStage: ReadinessStage | null;
  readonly communications: readonly DeliverableCommunication[];
  readonly artifacts: readonly DeliverableArtifact[];
  readonly prerequisites: readonly DeliverablePrerequisite[];
  /** Review of the complete required-content inventory, including an explicitly empty inventory. */
  readonly supportingContentInventoryEvidence: ManualEvidence | null;
  readonly facts: Readonly<{
    capacitySet: boolean | null;
    capacityReachable: boolean | null;
    objectiveCallsForHandraiser: boolean | null;
    absentHandraiserAppropriate: boolean | null;
    supportingChannelsUsed: boolean | null;
    accessibilityRequired: boolean | null;
    salesAdjacent: boolean | null;
    waitlistInUse: boolean | null;
    qaSendRequested: boolean | null;
    recordingAvailability: "available" | "expected" | "not_expected" | null;
    captureInUse: boolean | null;
  }>;
}
export type DeliverableRuleId =
  | "WEB-SETUP-012" | "WEB-SETUP-019" | "WEB-SETUP-C02" | "WEB-SETUP-C03"
  | "WEB-SETUP-C04" | "WEB-SETUP-C06" | "WEB-SETUP-C08"
  | "WEB-FU-ATT-002" | "WEB-FU-ATT-003" | "WEB-FU-ATT-004" | "WEB-FU-ATT-005"
  | "WEB-FU-ABS-002" | "WEB-FU-ABS-003" | "WEB-FU-ABS-004" | "WEB-FU-ABS-005"
  | "WEB-FU-WL-004" | "WEB-FU-INT-002" | "WEB-RDY-REC-003"
  | "WEB-RDY-RUN-002" | "WEB-RDY-RUN-003" | "WEB-RDY-RUN-004" | "WEB-RDY-RUN-006"
  | "WEB-QA-001" | "WEB-QA-002" | "WEB-QA-007" | "WEB-QA-009";
/** Compile-time check that no new identifier extends the canonical inventory. */
export type CanonicalDeliverableRuleId = Extract<DeliverableRuleId, RuleId>;