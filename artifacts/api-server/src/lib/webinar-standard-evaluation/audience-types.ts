import type { AudienceCommunicationKind, WebinarAudienceInput, WebinarAudiencePlan } from "../webinar-standard-audience";
import type { ManualEvidence } from "../webinar-standard-evidence/types";
import type { RuleId } from "../webinar-standard-catalog/types";
import type { RuleEvaluationResult } from "./types";

export type MaterialNoticeField = "cancellation" | "event_date" | "start_time" | "end_time"
  | "time_zone" | "format" | "venue" | "location" | "platform" | "join_link"
  | "access_instructions" | "title" | "topic" | "speakers" | "agenda"
  | "access_requirements" | "internal_owner" | "internal_notes" | "measurement_configuration" | "internal_administration";
export interface AudienceMaterialChange {
  readonly field: MaterialNoticeField;
  readonly participantFacingPublished: boolean;
  readonly changedAtEpochMs: number;
}
/** Complete operational recipient ledger, not a send request or a planner assertion. */
export interface AudienceCommunicationObservation {
  readonly communicationId: string;
  readonly kind: AudienceCommunicationKind | "recruitment";
  readonly customerPath: boolean;
  readonly outcome: "delivered" | "failed" | "scheduled" | "suppressed";
  readonly atEpochMs: number;
  readonly triggerAtEpochMs: number | null;
  readonly calendarIncluded: boolean;
  readonly attendanceInformationIncluded: boolean;
  /** Actual rendered occurrences; an empty array explicitly means no displayed event times. */
  /** zoneText is the actual adjacent rendered IANA identifier, not an unverified abbreviation. */
  readonly renderedTimes: readonly Readonly<{ text: string; zoneText: string | null }>[];
  readonly renderVersion: string | null;
  readonly renderedEvidence?: ManualEvidence | null;
  /** Only an explicitly reviewed policy permission can permit post-cancellation customer sends. */
  readonly cancellationPermission: ManualEvidence | null;
}
export interface AudienceOperationalSnapshot {
  readonly snapshotId: string;
  readonly occurrenceId: string;
  readonly observedAtEpochMs: number;
  readonly participantId: string;
  readonly ruleId: RuleId;
  readonly complete: boolean;
  readonly evidence: ManualEvidence;
  readonly communications: readonly AudienceCommunicationObservation[];
  readonly materialChanges: readonly AudienceMaterialChange[];
  /** Reviewed complete recipient history. Each interval is half-open; null ends at observation. */
  readonly recipientHistory: readonly Readonly<{
    fromEpochMs: number;
    throughEpochMs: number | null;
    registrationStatus: WebinarAudienceInput["participants"][number]["registrationStatus"];
    audienceClass: WebinarAudienceInput["participants"][number]["audienceClass"];
    eventStatus: WebinarAudienceInput["event"]["operationalStatus"];
  }>[];
}
export interface AudienceConfigurationSnapshot {
  readonly snapshotId: string;
  readonly occurrenceId: string;
  readonly observedAtEpochMs: number;
  readonly complete: boolean;
  readonly evidence: ManualEvidence;
  readonly entries: readonly Readonly<{
    kind: "registration_confirmation" | "reminder_24_hour" | "reminder_1_hour";
    communicationId: string;
    disposition: "configured" | "omitted";
    immediate: boolean;
    /** Explicit nominal cadence instant; never an authorization to send. */
    nominalAtEpochMs: number | null;
  }>[];
  readonly prerequisiteResults: readonly RuleEvaluationResult[];
}
export interface AudienceEvaluationContext {
  readonly occurrenceId: string;
  readonly input: WebinarAudienceInput;
  readonly plan: WebinarAudiencePlan;
  /** Immutable registration-time plan, retained when a current replan omits past reminders. */
  readonly registrationBasis?: Readonly<{ input: WebinarAudienceInput; plan: WebinarAudiencePlan }> | null;
  readonly evaluationStage?: string | null;
  readonly operational?: AudienceOperationalSnapshot | null;
  readonly configuration?: AudienceConfigurationSnapshot | null;
}