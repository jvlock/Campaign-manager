import type { RuleId, StandardId, StandardVersion } from "../webinar-standard-catalog/types";
import type {
  AudienceClass, EventOperationalStatus, ParticipantAttendanceState,
  ParticipantRegistrationStatus,
} from "../webinar-standard-evaluation/types";
import type { planWebinarRecruitment } from "../webinar-standard-scheduling/index";

export const AUDIENCE_COMMUNICATION_KINDS = Object.freeze([
  "registration_confirmation", "calendar_information", "reminder_24_hour",
  "reminder_1_hour", "event_change_notice", "event_cancellation_notice",
  "attended_follow_up", "absent_follow_up", "attendance_reconciliation",
  "neutral_follow_up", "waitlist_confirmation", "waitlist_promotion",
  "waitlist_closure", "participant_cancellation_confirmation", "qa_test_send",
] as const);

export type AudienceCommunicationKind = (typeof AUDIENCE_COMMUNICATION_KINDS)[number];
export type AudienceState =
  | "eligible_non_registrant" | "registered" | "attended" | "registered_absent"
  | "attendance_unknown" | "waitlisted" | "cancelled" | "internal_or_test";

export interface AudienceEventInput {
  readonly eventId: string;
  readonly operationalStatus: EventOperationalStatus;
  readonly startsAtEpochMs: number;
  readonly endsAtEpochMs: number | null;
  readonly actualEndsAtEpochMs: number | null;
  readonly observedAtEpochMs: number;
  readonly materialChangeTriggeredAtEpochMs: number | null;
  readonly cancellationTriggeredAtEpochMs: number | null;
}

export interface AudienceParticipantInput {
  readonly participantId: string;
  readonly eventId: string;
  readonly registrationStatus: ParticipantRegistrationStatus;
  readonly attendanceState: ParticipantAttendanceState;
  readonly audienceClass: AudienceClass;
  readonly recruitmentEligible: boolean;
  readonly contactable: boolean;
  readonly optedOut: boolean;
  readonly invalidAddress: boolean;
  readonly governedExclusion: boolean;
  readonly registrationAtEpochMs: number | null;
  readonly attendanceAvailableAtEpochMs: number | null;
  readonly waitlistedAtEpochMs: number | null;
  readonly waitlistPromotionTriggeredAtEpochMs: number | null;
  readonly waitlistClosureTriggeredAtEpochMs: number | null;
  readonly participantCancellationTriggeredAtEpochMs: number | null;
  readonly neutralVariantApproved: boolean;
  readonly qaTestSendRequested: boolean;
  readonly followUpAssetId: string | null;
  /** Optional caller identities. Missing identities are derived without delimiter collisions. */
  readonly communicationIds?: Readonly<Partial<Record<AudienceCommunicationKind, string>>>;
}

export interface WebinarAudienceInput {
  readonly calculationInstantEpochMs: number;
  readonly timeZone: string;
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly event: AudienceEventInput;
  readonly recruitmentTouches: readonly {
    readonly identity: "recruitment_1" | "recruitment_2" | "recruitment_3" | "final_recruitment";
    readonly communicationId: string;
  }[];
  readonly participants: readonly AudienceParticipantInput[];
}

export interface AudienceObligation {
  readonly kind: AudienceCommunicationKind;
  readonly communicationId: string;
  readonly disposition: "required" | "eligible" | "omitted";
  /** Classifies dueAtEpochMs; it is never an authorized or requested send-at instant. */
  readonly timingKind: "deadline" | "eligibility" | "none";
  /** A descriptive deadline or earliest eligibility instant, never send authorization. */
  readonly dueAtEpochMs: number | null;
  readonly overdue: boolean;
  readonly reason: string;
  readonly customerPath: boolean;
  readonly variant: "attended" | "absent" | "neutral" | "qa_test" | null;
  readonly assetId: string | null;
  readonly canonicalRuleIds: readonly RuleId[];
  readonly deadlineLocal: {
    readonly date: string;
    readonly time: string;
    readonly offset: string;
    readonly disambiguation: "none" | "gap_forward" | "overlap_earlier";
    readonly requestedLocalDateTime: string;
  } | null;
}

export interface ParticipantAudiencePlan {
  readonly participantId: string;
  readonly state: AudienceState;
  readonly recruitmentEligible: boolean;
  readonly customerReportingIncluded: boolean;
  readonly suppressions: readonly string[];
  readonly warnings: readonly string[];
  readonly obligations: readonly AudienceObligation[];
  readonly recruitmentPlan: ReturnType<typeof planWebinarRecruitment> | null;
}

export interface WebinarAudiencePlan {
  readonly mode: "planning_only";
  readonly sendAuthorized: false;
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly eventId: string;
  readonly calculationInstantEpochMs: number;
  readonly timeZone: string;
  readonly authority: {
    readonly readinessOverride: false;
    readonly exceptionOverride: false;
    readonly sendingAuthority: false;
  };
  readonly businessDayConvention: {
    readonly days: "Monday-Friday";
    readonly holidayCalendar: false;
    readonly timeZone: string;
    readonly limitation: string;
  };
  readonly participants: readonly ParticipantAudiencePlan[];
}

export class AudiencePlanningInputError extends Error {
  readonly code = "INVALID_AUDIENCE_PLANNING_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "AudiencePlanningInputError";
  }
}