import type { EventOperationalStatus } from "../webinar-standard-evaluation/types";
import type {
  RuleId, StandardId, StandardVersion, WebinarStandardCatalog,
} from "../webinar-standard-catalog/types";

export type { EventOperationalStatus, WebinarStandardCatalog };

export const RECRUITMENT_TOUCH_IDENTITIES = Object.freeze([
  "recruitment_1",
  "recruitment_2",
  "recruitment_3",
  "final_recruitment",
] as const);

export type RecruitmentTouchIdentity = (typeof RECRUITMENT_TOUCH_IDENTITIES)[number];
export type RecruitmentWindowBand =
  | "full_window"
  | "days_14_to_20"
  | "days_7_to_13"
  | "days_2_to_6"
  | "days_0_to_1"
  | "inactive_event";
export type RecruitmentTouchDisposition = "scheduled" | "adjusted" | "omitted";
export type RecruitmentTouchReason =
  | "standard_offset"
  | "shortened_window_immediate"
  | "shortened_window_omission"
  | "nominal_instant_precedes_calculation"
  | "nominal_instant_not_before_start"
  | "insufficient_24_hour_separation"
  | "duplicate_scheduled_instant"
  | "event_in_progress"
  | "event_completed"
  | "event_cancelled";
export type RecruitmentWarning =
  | "compressed_window"
  | "dst_gap_forward"
  | "dst_overlap_earlier"
  | "nominal_touch_past_due"
  | "insufficient_24_hour_separation"
  | "duplicate_scheduled_instant"
  | "recruitment_inactive";

export interface RecruitmentTouchInput {
  readonly identity: RecruitmentTouchIdentity;
  readonly communicationId: string;
}

export interface RecruitmentPlanningInput {
  readonly calculationInstantEpochMs: number;
  readonly webinarStartEpochMs: number;
  readonly timeZone: string;
  readonly eventStatus: EventOperationalStatus;
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly touches: readonly RecruitmentTouchInput[];
}

export interface PlannedRecruitmentTouch {
  readonly identity: RecruitmentTouchIdentity;
  readonly communicationId: string;
  readonly disposition: RecruitmentTouchDisposition;
  readonly scheduledAtEpochMs: number | null;
  readonly eventLocalDate: string | null;
  readonly eventLocalTime: string | null;
  readonly eventLocalOffset: string | null;
  readonly originalOffsetDays: 21 | 14 | 7 | 1;
  readonly reason: RecruitmentTouchReason;
  readonly warnings: readonly RecruitmentWarning[];
  readonly ruleIds: readonly RuleId[];
  readonly timeAdjustment: {
    readonly disambiguation: "none" | "gap_forward" | "overlap_earlier";
    readonly requestedLocalDateTime: string | null;
  };
}

/** A planning description only; none of these flags grants operational authority. */
export interface RecruitmentPlan {
  readonly planningOnly: true;
  readonly sendAuthorized: false;
  readonly authority: {
    readonly readinessOverride: false;
    readonly exceptionOverride: false;
    readonly suppressionOverride: false;
  };
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly selectedBand: RecruitmentWindowBand;
  readonly localCalendarDaysRemaining: number;
  readonly calculationInstantEpochMs: number;
  readonly webinarStartEpochMs: number;
  readonly timeZone: string;
  readonly eventStatus: EventOperationalStatus;
  readonly touches: readonly PlannedRecruitmentTouch[];
  readonly warnings: readonly RecruitmentWarning[];
  readonly ruleIds: readonly RuleId[];
}

export type RecruitmentPlanningValidationCode =
  | "invalid_catalog"
  | "invalid_input"
  | "unknown_field"
  | "missing_field"
  | "invalid_instant"
  | "invalid_time_zone"
  | "unsupported_event_status"
  | "standard_mismatch"
  | "invalid_touches"
  | "duplicate_touch_identity"
  | "duplicate_communication_id"
  | "active_event_not_in_future";

export class RecruitmentPlanningValidationError extends Error {
  readonly name = "RecruitmentPlanningValidationError";

  constructor(
    readonly code: RecruitmentPlanningValidationCode,
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
  }
}