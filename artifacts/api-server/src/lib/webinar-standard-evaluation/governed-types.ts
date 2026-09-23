import type { StandardId, StandardVersion } from "../webinar-standard-catalog/types";
import type { ManualEvidence } from "../webinar-standard-evidence/types";
import type { WebinarAudienceInput, WebinarAudiencePlan } from "../webinar-standard-audience/types";
import type { GovernedValueEvidence } from "./types";

export type GovernedRuleId = "WEB-SETUP-003" | "WEB-REC-010";
/** Internal normalized discriminators, NOT a Foundation transport/API contract. */
export type GovernedCapability = "objective_membership" | "campaign_exclusion";
export interface GovernedSourceVersion {
  readonly version: string;
  readonly effectiveFromEpochMs: number;
  readonly effectiveThroughEpochMs: number | null;
  readonly deprecated: boolean;
}
export interface GovernedRequest {
  readonly eventId: string;
  readonly campaignId: string;
  readonly inputFingerprint: string;
  readonly inputVersion: string;
  readonly requestReference: string;
  readonly expectedSourceVersion: GovernedSourceVersion;
}
/** Supplied authoritative provenance is checked, not remotely authenticated.
 * Test receipts never substantiate production; manual approvals are separate. */
export interface GovernedObservation {
  readonly observationId: string;
  readonly ruleId: GovernedRuleId;
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly source: GovernedValueEvidence["source"];
  readonly capability: GovernedCapability;
  readonly sourceVersion: string;
  readonly eventId: string;
  readonly campaignId: string;
  readonly participantId: string | null;
  readonly objectiveId: string | null;
  readonly inputFingerprint: string;
  readonly inputVersion: string;
  readonly requestReference: string;
  readonly outputReference: string | null;
  readonly outputType: GovernedCapability;
  readonly status: "success" | "unavailable" | "error";
  /** Membership for SETUP; exclusion applicability for REC. No local policy calculation. */
  readonly decision: boolean | null;
  readonly generatedAtEpochMs: number;
  readonly recordedAtEpochMs: number;
  readonly validFromEpochMs: number;
  readonly expiresAtEpochMs: number | null;
  readonly provenance: ManualEvidence;
  readonly environment: "production" | "test";
  readonly unavailableReason: string | null;
  readonly notes: string;
}
export interface GovernedObjectiveContext {
  readonly request: GovernedRequest;
  readonly objectiveId: string | null;
  readonly observations: readonly GovernedObservation[];
}
export interface GovernedExclusionContext {
  readonly request: GovernedRequest;
  readonly occurrenceId: string;
  readonly completePopulation: boolean;
  readonly audienceInput: WebinarAudienceInput;
  readonly audiencePlan: WebinarAudiencePlan;
  readonly observations: readonly GovernedObservation[];
  readonly operational: readonly Readonly<{
    participantId: string;
    evidence: ManualEvidence;
    recipientObservations: readonly Readonly<{
      communicationId: string;
      scheduledAtEpochMs: number;
      included: boolean;
    }>[];
  }>[];
}
export interface GovernedEvaluationContext {
  readonly environment: "production" | "test";
  readonly objective: GovernedObjectiveContext | null;
  readonly exclusion: GovernedExclusionContext | null;
}