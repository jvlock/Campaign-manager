import type {
  RuleId, StandardId, StandardVersion, WebinarStandardRule,
} from "../webinar-standard-catalog/types";

export type EventOperationalStatus =
  | "draft" | "open_for_registration" | "scheduled"
  | "in_progress" | "completed" | "cancelled";
export type ParticipantAttendanceState = "attended" | "absent" | "unknown";
export type ParticipantRegistrationStatus = "not_registered" | "registered" | "waitlisted" | "cancelled";
export type AudienceClass = "customer" | "internal" | "test";

/** Operational event state intentionally has no aggregate attendance state. */
export interface EventContext {
  readonly eventId: string;
  readonly operationalStatus: EventOperationalStatus;
  readonly startsAtEpochMs: number | null;
}

/** Each evaluation selects one participant; attendance is never stored on an event. */
export interface ParticipantContext {
  readonly participantId: string;
  readonly eventId: string;
  readonly registrationStatus: ParticipantRegistrationStatus;
  readonly attendanceState: ParticipantAttendanceState;
  readonly audienceClass: AudienceClass;
  readonly includedInAttendance: boolean | null;
  readonly includedInReporting: boolean | null;
}

export interface GovernedValueEvidence {
  readonly value: string;
  readonly source: "foundation" | "manual" | "other";
  readonly verified: boolean;
}

/** Observed/configured facts only. There is no executable channel or delivery adapter. */
export interface CommunicationContext {
  readonly communicationId: string;
  readonly eventId: string;
  readonly recipientIds: readonly string[];
  readonly kind: "recruitment" | "registrant" | "follow_up";
  readonly variant: "attended" | "absent" | "neutral" | null;
  readonly state: "planned" | "recorded" | "omitted";
  readonly createdAtEpochMs: number | null;
  readonly scheduledAtEpochMs: number | null;
  readonly recordedAtEpochMs: number | null;
  readonly utmRequired: boolean | null;
  readonly utm: GovernedValueEvidence | null;
}

export interface HumanConfirmation {
  readonly confirmed: boolean;
  readonly evidence: string;
}

export interface FollowUpVariant {
  readonly variantId: string;
  readonly messageContent: string;
  readonly destinationId: string | null;
}

/** Caller-supplied observation time, never wall-clock time. Null means missing evidence. */
export interface EvaluationContext {
  readonly observedAtEpochMs: number;
  readonly event: EventContext;
  readonly participant: ParticipantContext | null;
  readonly communications: readonly CommunicationContext[];
  readonly registrationFlowTest: HumanConfirmation | null;
  readonly joinLinkOrVenueTest: HumanConfirmation | null;
  readonly consent: {
    readonly required: boolean | null;
    readonly languageAttached: boolean | null;
    readonly confirmation: HumanConfirmation | null;
  };
  readonly governance: {
    readonly internalName: GovernedValueEvidence | null;
    readonly campaignCode: GovernedValueEvidence | null;
    readonly taxonomyValues: readonly GovernedValueEvidence[] | null;
  };
  readonly followUp: {
    readonly attended: FollowUpVariant | null;
    readonly absent: FollowUpVariant | null;
    readonly distinctContentConfirmation: HumanConfirmation | null;
  };
}

export type EvaluationStatus = "pass" | "fail" | "not_applicable" | "unimplemented";
export type EvaluationReason =
  | "satisfied" | "violation" | "condition_not_met"
  | "missing_evidence" | "invalid_context" | "not_implemented";

/** A descriptive finding, not an execution permission or an overall readiness result. */
export interface RuleEvaluationResult {
  readonly mode: "descriptive_only";
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly ruleId: RuleId;
  readonly rule: WebinarStandardRule;
  readonly status: EvaluationStatus;
  readonly reason: EvaluationReason;
  readonly participantId: string | null;
  readonly evidence: readonly string[];
}

export interface RuleFinding {
  readonly status: Exclude<EvaluationStatus, "unimplemented">;
  readonly reason: Exclude<EvaluationReason, "not_implemented">;
  readonly evidence: readonly string[];
}

export type RuleEvaluator = (context: EvaluationContext) => RuleFinding;

export interface EvaluatorRegistryEntry {
  readonly ruleId: RuleId;
  readonly rule: WebinarStandardRule;
  readonly evaluate: (context: EvaluationContext) => RuleEvaluationResult;
}

export interface PartialEvaluatorRegistry {
  readonly implementedRuleIds: readonly RuleId[];
  readonly unimplementedRuleIds: readonly RuleId[];
  readonly entries: readonly EvaluatorRegistryEntry[];
  readonly evaluate: (ruleId: RuleId, context: EvaluationContext) => RuleEvaluationResult;
}