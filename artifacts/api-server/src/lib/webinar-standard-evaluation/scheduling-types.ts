import type { RuleId, StandardId, StandardVersion } from "../webinar-standard-catalog/types";
import type { WebinarAudiencePlan } from "../webinar-standard-audience/types";
import type { ManualEvidence } from "../webinar-standard-evidence/types";
import type { RuleEvaluationResult } from "./types";
import type {
  RecruitmentPlan, RecruitmentTouchDisposition, RecruitmentTouchIdentity,
  RecruitmentTouchReason, RecruitmentWarning,
} from "../webinar-standard-scheduling/types";

export interface ConfiguredRecruitmentTouch {
  readonly identity: RecruitmentTouchIdentity;
  readonly communicationId: string;
  readonly disposition: RecruitmentTouchDisposition;
  readonly scheduledAtEpochMs: number | null;
}

/** Complete caller-owned configuration snapshot; it describes configuration, never sending. */
export interface RecruitmentConfigurationSnapshot {
  readonly snapshotId: string;
  readonly occurrenceId: string;
  readonly eventId: string;
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly complete: boolean;
  readonly touches: readonly ConfiguredRecruitmentTouch[];
  readonly surfacedWarnings: readonly RecruitmentWarning[];
}

/** Immutable occurrence-scoped creation basis; later recalculation never replaces it. */
export interface RecruitmentCreationSnapshot {
  readonly snapshotId: string;
  readonly occurrenceId: string;
  readonly eventId: string;
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly capturedAtEpochMs: number;
  readonly timeZone: string;
  readonly eventStatus: RecruitmentPlan["eventStatus"];
  readonly recruitmentPlan: RecruitmentPlan;
  readonly configuredPlan: RecruitmentConfigurationSnapshot;
}

export interface SuppressionObservation {
  readonly ruleId: "WEB-REC-006" | "WEB-REC-007" | "WEB-REC-009";
  readonly participantId: string;
  readonly evidence: ManualEvidence;
  readonly conditionApplies: boolean;
  /** Required only for cancelled registrants; historical recipients before this instant are permitted. */
  readonly cancellationAtEpochMs: number | null;
  readonly recipientObservations: readonly Readonly<{
    communicationId: string;
    scheduledAtEpochMs: number;
    included: boolean;
  }>[];
}

export interface SuppressionControlObservation {
  readonly ruleId: RuleId;
  readonly evidence: ManualEvidence;
  readonly active: boolean;
}

export interface RecruitmentSuppressionSnapshot {
  readonly snapshotId: string;
  readonly occurrenceId: string;
  readonly eventId: string;
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly observedAtEpochMs: number;
  readonly completePopulation: boolean;
  readonly recruitmentCommunicationIds: readonly string[];
  readonly audiencePlan: WebinarAudiencePlan;
  readonly observations: readonly SuppressionObservation[];
  readonly controls: readonly SuppressionControlObservation[];
  readonly prerequisiteResults: readonly RuleEvaluationResult[];
}

export interface OmissionDisplayEntry {
  readonly identity: RecruitmentTouchIdentity;
  readonly communicationId: string;
  readonly label: "omitted-because-past-due";
  readonly reason: RecruitmentTouchReason;
}

/** Read-only evidence from an actual rendered artifact; this is not a UI model. */
export interface OmissionDisplayEvidence {
  readonly evidence: ManualEvidence;
  readonly occurrenceId: string;
  readonly configuredSnapshotId: string;
  readonly renderVersion: string;
  readonly entries: readonly OmissionDisplayEntry[];
}

export interface SchedulingEvaluationContext {
  /** Caller-observed canonical evaluation stage; omitted/null means unavailable evidence. */
  readonly evaluationStage?: string | null;
  readonly occurrenceId: string;
  readonly timeZone: string;
  readonly recruitmentPlan: RecruitmentPlan | null;
  readonly configuredPlan: RecruitmentConfigurationSnapshot | null;
  readonly creationSnapshot: RecruitmentCreationSnapshot | null;
  readonly suppression: RecruitmentSuppressionSnapshot | null;
  readonly omissionDisplay: OmissionDisplayEvidence | null;
}