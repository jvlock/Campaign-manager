import { Temporal } from "@js-temporal/polyfill";
import type { WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { isRecord, snapshotData } from "../webinar-standard-readiness/safe-data";
import { assertInstant, localTime } from "../webinar-standard-planning-time/time";
import { BUSINESS_DAY_CONVENTION } from "../webinar-standard-planning-time/business-days";
import { validateRecruitmentPlanResult } from "../webinar-standard-scheduling/validate-result";
import { communicationId, stateFor } from "./plan";
import { validateAudiencePlanningInput } from "./validate";
import { AUDIENCE_COMMUNICATION_KINDS, type AudienceCommunicationKind, type WebinarAudienceInput, type WebinarAudiencePlan } from "./types";

const RULES: Record<AudienceCommunicationKind, readonly string[]> = {
  registration_confirmation: ["WEB-REG-001"], calendar_information: ["WEB-REG-002"],
  reminder_24_hour: ["WEB-REG-003", "WEB-REG-008"], reminder_1_hour: ["WEB-REG-004", "WEB-REG-008"],
  event_change_notice: ["WEB-REG-005"], event_cancellation_notice: ["WEB-REG-006"],
  attended_follow_up: ["WEB-FU-ATT-001", "WEB-FU-VAR-001"],
  absent_follow_up: ["WEB-FU-ABS-001", "WEB-FU-VAR-001"],
  attendance_reconciliation: ["WEB-FU-UNK-001", "WEB-FU-UNK-002"],
  neutral_follow_up: ["WEB-FU-UNK-003", "WEB-FU-UNK-002"],
  waitlist_confirmation: ["WEB-FU-WL-001"], waitlist_promotion: ["WEB-FU-WL-002"],
  waitlist_closure: ["WEB-FU-WL-003"], participant_cancellation_confirmation: ["WEB-FU-CAN-001"],
  qa_test_send: ["WEB-FU-INT-002"],
};
// Descriptive result vocabulary, not scheduling policy. In particular the notice
// wording describes obligation creation, not proof of delivery or an operational SLA.
const REASONS: Record<AudienceCommunicationKind, readonly string[]> = {
  registration_confirmation: ["Immediate at registration; retained as overdue when replanned late."],
  calendar_information: ["Calendar and attendance information is immediate with confirmation."],
  reminder_24_hour: ["Event cancellation suppresses reminders.", "Registration occurred after this nominal reminder.", "Nominal reminder is not in the future; no backdating."],
  reminder_1_hour: ["Event cancellation suppresses reminders.", "Registration occurred after this nominal reminder.", "Nominal reminder is not in the future; no backdating."],
  event_change_notice: ["Material event change notice is due at the supplied trigger."],
  event_cancellation_notice: ["Event cancellation notice is due at the supplied trigger."],
  attended_follow_up: ["Attended follow-up is due within one business day."],
  absent_follow_up: ["Absent follow-up is due within one business day of actual event completion."],
  attendance_reconciliation: ["Reconciliation precedes any follow-up treatment."],
  neutral_follow_up: ["Approved neutral variant is eligible after two business days; this is not send authorization."],
  waitlist_confirmation: ["Waitlist confirmation is immediate."],
  waitlist_promotion: ["Promotion confirmation is due at the supplied trigger."],
  waitlist_closure: ["Non-admission notice is due at the supplied closure trigger.", "Event cancellation closes the waitlist and requires a non-admission notice."],
  participant_cancellation_confirmation: ["Participant cancellation confirmation is due at the supplied trigger."],
  qa_test_send: ["Explicitly labelled QA planning only; never a customer path."],
};
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function exact(value: unknown, fields: readonly string[]): void {
  requireValue(isRecord(value) && Object.keys(value).length === fields.length
    && fields.every(field => Object.hasOwn(value, field)), "Result has missing or extraneous fields.");
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function strings(value: unknown): asserts value is string[] {
  requireValue(Array.isArray(value) && value.every(text) && new Set(value).size === value.length,
    "Result has malformed or duplicate string metadata.");
}
function same(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * A data-only, version/scope/completeness boundary. This does not regenerate a
 * plan, calculate reminder offsets, business-day deadlines, or resolve DST.
 * Validity proves neither execution nor authorization to send.
 */
export function validateWebinarAudiencePlanResult(
  suppliedPlan: unknown, input: WebinarAudienceInput, catalog: WebinarStandardCatalog,
): string | null {
  try {
    const expected = validateAudiencePlanningInput(catalog, input);
    const snapshot = snapshotData(suppliedPlan);
    requireValue(snapshot.ok, "Audience result must be finite acyclic plain data without accessors.");
    exact(snapshot.value, ["mode", "sendAuthorized", "standardId", "standardVersion", "eventId",
      "calculationInstantEpochMs", "timeZone", "authority", "businessDayConvention", "participants"]);
    const plan = snapshot.value as WebinarAudiencePlan;
    requireValue(plan.standardId === expected.standardId && plan.standardVersion === expected.standardVersion
      && plan.eventId === expected.event.eventId && plan.timeZone === expected.timeZone
      && plan.calculationInstantEpochMs === expected.calculationInstantEpochMs, "Audience result scope or version conflicts with input.");
    exact(plan.authority, ["readinessOverride", "exceptionOverride", "sendingAuthority"]);
    requireValue(plan.mode === "planning_only" && plan.sendAuthorized === false
      && Object.values(plan.authority).every(value => value === false), "Audience result claims unauthorized authority.");
    exact(plan.businessDayConvention, ["days", "holidayCalendar", "timeZone", "limitation"]);
    requireValue(plan.businessDayConvention.days === "Monday-Friday"
      && plan.businessDayConvention.holidayCalendar === false && plan.businessDayConvention.timeZone === expected.timeZone
      && plan.businessDayConvention.limitation === `Monday through Friday in the supplied IANA time zone; no holiday calendar (${BUSINESS_DAY_CONVENTION.timeZoneBasis}).`,
    "Audience result has invalid business-day convention.");
    requireValue(Array.isArray(plan.participants) && plan.participants.length === expected.participants.length,
      "Audience result is missing participants.");
    const participantIds = new Set<string>();
    const communicationIds = new Set(expected.recruitmentTouches.map(touch => touch.communicationId));
    for (const result of plan.participants as WebinarAudiencePlan["participants"]) {
      exact(result, ["participantId", "state", "recruitmentEligible", "customerReportingIncluded",
        "suppressions", "warnings", "obligations", "recruitmentPlan"]);
      const participant = expected.participants.find(item => item.participantId === result.participantId);
      requireValue(participant && !participantIds.has(result.participantId), "Audience result has unknown or duplicate participant.");
      participantIds.add(result.participantId);
      const state = stateFor(participant, expected.event.operationalStatus);
      requireValue(result.state === state, "Audience result state conflicts with input.");
      requireValue(result.customerReportingIncluded === (participant.audienceClass === "customer" && state !== "cancelled"),
        "Audience result reporting inclusion conflicts with participant.");
      strings(result.suppressions);
      strings(result.warnings);
      const canRecruit = state === "eligible_non_registrant" && participant.recruitmentEligible
        && participant.contactable && !participant.optedOut && !participant.invalidAddress && !participant.governedExclusion
        && ["draft", "open_for_registration", "scheduled"].includes(expected.event.operationalStatus)
        && expected.calculationInstantEpochMs < expected.event.startsAtEpochMs;
      requireValue(result.recruitmentEligible === canRecruit, "Audience result recruitment eligibility conflicts with input.");
      if (canRecruit) {
        const error = validateRecruitmentPlanResult(result.recruitmentPlan, {
          standardId: expected.standardId, standardVersion: expected.standardVersion,
          calculationInstantEpochMs: expected.calculationInstantEpochMs, webinarStartEpochMs: expected.event.startsAtEpochMs,
          timeZone: expected.timeZone, eventStatus: expected.event.operationalStatus,
        });
        requireValue(error === null, error ?? "Invalid recruitment result.");
        requireValue(result.recruitmentPlan!.touches.every(touch =>
          expected.recruitmentTouches.some(source => source.identity === touch.identity && source.communicationId === touch.communicationId)),
        "Nested recruitment identities conflict with input.");
      } else requireValue(result.recruitmentPlan === null, "Suppressed recruitment must not contain a plan.");

      const required: AudienceCommunicationKind[] = [];
      const allowed: AudienceCommunicationKind[] = [];
      const suppressions: string[] = [];
      if (!canRecruit) {
        if (state !== "eligible_non_registrant") suppressions.push("participant_state_suppresses_recruitment");
        if (!participant.recruitmentEligible) suppressions.push("not_recruitment_eligible");
        if (!participant.contactable) suppressions.push("not_contactable");
        if (participant.optedOut) suppressions.push("opted_out");
        if (participant.invalidAddress) suppressions.push("invalid_address");
        if (participant.governedExclusion) suppressions.push("governed_exclusion");
        if (!["draft", "open_for_registration", "scheduled"].includes(expected.event.operationalStatus)) suppressions.push("event_inactive_for_recruitment");
        if (expected.event.operationalStatus === "cancelled") suppressions.push("event_cancelled");
        if (expected.calculationInstantEpochMs >= expected.event.startsAtEpochMs) suppressions.push("event_started");
      }
      if (state === "internal_or_test") {
        suppressions.push("excluded_from_customer_communications", "excluded_from_customer_reporting");
        if (participant.qaTestSendRequested) required.push("qa_test_send");
      } else if (state === "cancelled") {
        required.push("participant_cancellation_confirmation");
        suppressions.push("all_future_customer_paths");
      } else if (state === "waitlisted") {
        required.push("waitlist_confirmation");
        suppressions.push("waitlist_suppresses_recruitment");
        if (participant.waitlistPromotionTriggeredAtEpochMs !== null) required.push("waitlist_promotion");
        if (participant.waitlistClosureTriggeredAtEpochMs !== null || expected.event.operationalStatus === "cancelled") required.push("waitlist_closure");
        if (expected.event.operationalStatus === "cancelled") suppressions.push("all_future_customer_paths");
      } else if (state !== "eligible_non_registrant") {
        required.push("registration_confirmation", "calendar_information", "reminder_24_hour", "reminder_1_hour");
        suppressions.push("registration_suppresses_recruitment");
        if (expected.event.materialChangeTriggeredAtEpochMs !== null && expected.event.operationalStatus !== "cancelled"
          && participant.registrationAtEpochMs! <= expected.event.materialChangeTriggeredAtEpochMs) required.push("event_change_notice");
        if (expected.event.cancellationTriggeredAtEpochMs !== null) {
          required.push("event_cancellation_notice");
          suppressions.push("event_cancellation_suppresses_reminders_and_follow_up");
        }
        if (state === "attended") required.push("attended_follow_up");
        if (state === "registered_absent") required.push("absent_follow_up");
        if (state === "attendance_unknown") {
          required.push("attendance_reconciliation");
          if (participant.neutralVariantApproved) allowed.push("neutral_follow_up");
        }
      }
      requireValue(same([...result.suppressions].sort(), suppressions.sort()), "Audience result suppression metadata is incoherent.");
      requireValue(Array.isArray(result.obligations), "Audience obligations must be an array.");
      const kinds = new Set<AudienceCommunicationKind>();
      for (const obligation of result.obligations as WebinarAudiencePlan["participants"][number]["obligations"]) {
        exact(obligation, ["kind", "communicationId", "disposition", "timingKind", "dueAtEpochMs", "overdue",
          "reason", "customerPath", "variant", "assetId", "canonicalRuleIds", "deadlineLocal"]);
        const kind = obligation.kind;
        requireValue(AUDIENCE_COMMUNICATION_KINDS.includes(kind) && !kinds.has(kind)
          && [...required, ...allowed].includes(kind), "Audience obligation kind is duplicate or incompatible with state.");
        kinds.add(kind);
        requireValue(obligation.communicationId === communicationId(participant, kind)
          && !communicationIds.has(obligation.communicationId), "Audience communication identity is duplicate or mis-scoped.");
        communicationIds.add(obligation.communicationId);
        strings(obligation.canonicalRuleIds);
        requireValue(same(obligation.canonicalRuleIds, RULES[kind]), "Audience obligation has noncanonical rule references.");
        requireValue(text(obligation.reason) && REASONS[kind].includes(obligation.reason),
          "Audience obligation requires a canonical reason.");
        const reminder = kind === "reminder_24_hour" || kind === "reminder_1_hour";
        const eligible = kind === "qa_test_send" || kind === "neutral_follow_up";
        const omitted = obligation.disposition === "omitted";
        if (reminder) requireValue((obligation.reason === "Event cancellation suppresses reminders.")
          === (expected.event.operationalStatus === "cancelled"), "Audience reminder reason conflicts with event status.");
        if (kind === "waitlist_closure") requireValue(obligation.reason === REASONS.waitlist_closure[
          participant.waitlistClosureTriggeredAtEpochMs !== null ? 0 : 1], "Waitlist closure reason conflicts with trigger.");
        requireValue(obligation.disposition === (eligible ? "eligible" : omitted && reminder ? "omitted" : "required"),
          "Audience obligation disposition is incoherent.");
        requireValue(obligation.timingKind === (omitted ? "none" : eligible ? "eligibility" : "deadline"),
          "Audience obligation timing kind is incoherent.");
        if (omitted) requireValue(obligation.dueAtEpochMs === null, "Omitted obligation must not have an instant.");
        else assertInstant(obligation.dueAtEpochMs, "obligation.dueAtEpochMs");
        // Bind directly supplied instants only; derived deadlines remain planner-owned.
        const suppliedInstants: Partial<Record<AudienceCommunicationKind, number | null>> = {
          registration_confirmation: participant.registrationAtEpochMs,
          calendar_information: participant.registrationAtEpochMs,
          event_change_notice: expected.event.materialChangeTriggeredAtEpochMs,
          event_cancellation_notice: expected.event.cancellationTriggeredAtEpochMs,
          attendance_reconciliation: expected.event.actualEndsAtEpochMs,
          waitlist_confirmation: participant.waitlistedAtEpochMs,
          waitlist_promotion: participant.waitlistPromotionTriggeredAtEpochMs,
          waitlist_closure: participant.waitlistClosureTriggeredAtEpochMs ?? expected.event.cancellationTriggeredAtEpochMs,
          participant_cancellation_confirmation: participant.participantCancellationTriggeredAtEpochMs,
          qa_test_send: expected.calculationInstantEpochMs,
        };
        if (Object.hasOwn(suppliedInstants, kind)) requireValue(obligation.dueAtEpochMs === suppliedInstants[kind],
          "Audience obligation instant conflicts with its supplied trigger.");
        requireValue(obligation.overdue === (!omitted && !eligible && obligation.dueAtEpochMs! < expected.calculationInstantEpochMs),
          "Audience obligation overdue metadata is incoherent.");
        if (reminder && !omitted) requireValue(expected.event.operationalStatus !== "cancelled"
          && obligation.dueAtEpochMs! > expected.calculationInstantEpochMs
          && obligation.dueAtEpochMs! >= participant.registrationAtEpochMs!
          && obligation.dueAtEpochMs! < expected.event.startsAtEpochMs, "Reminder is suppressed or not future.");
        const variant = kind === "attended_follow_up" ? "attended" : kind === "absent_follow_up" ? "absent"
          : kind === "neutral_follow_up" ? "neutral" : kind === "qa_test_send" ? "qa_test" : null;
        const followUp = variant !== null && variant !== "qa_test";
        requireValue(obligation.variant === variant && obligation.customerPath === (kind !== "qa_test_send")
          && obligation.assetId === (followUp ? participant.followUpAssetId : null), "Audience variant, asset or customer path is incoherent.");
        if (followUp) {
          const anchor = expected.event.actualEndsAtEpochMs;
          requireValue(anchor !== null && obligation.dueAtEpochMs! > anchor,
            "Audience follow-up deadline must follow its supplied anchor.");
          exact(obligation.deadlineLocal, ["date", "time", "offset", "disambiguation", "requestedLocalDateTime"]);
          const metadata = obligation.deadlineLocal!;
          const local = localTime(obligation.dueAtEpochMs!, expected.timeZone);
          requireValue(metadata.date === local.date && metadata.time === local.time && metadata.offset === local.offset
            && ["none", "gap_forward", "overlap_earlier"].includes(metadata.disambiguation)
            && text(metadata.requestedLocalDateTime)
            && Temporal.PlainDateTime.from(metadata.requestedLocalDateTime, { overflow: "reject" }).toString() === metadata.requestedLocalDateTime,
          "Audience deadline local metadata does not identify its instant.");
          if (metadata.disambiguation === "none" || metadata.disambiguation === "overlap_earlier") {
            requireValue(metadata.requestedLocalDateTime === `${metadata.date}T${metadata.time}`,
              "Audience requested local metadata is incoherent.");
          }
          if (kind === "neutral_follow_up") requireValue(obligation.dueAtEpochMs! <= expected.calculationInstantEpochMs,
            "Neutral variant is not yet eligible.");
        } else requireValue(obligation.deadlineLocal === null, "Unexpected local deadline metadata.");
      }
      requireValue(required.every(kind => kinds.has(kind)), "Audience result is missing an obligation.");
      if (state === "attendance_unknown" && !kinds.has("neutral_follow_up")) {
        requireValue(result.warnings.length === 1 && ["neutral_variant_not_yet_eligible", "neutral_variant_requires_explicit_approval"].includes(result.warnings[0]!),
          "Unknown attendance requires explicit neutral eligibility warning.");
        requireValue(!participant.neutralVariantApproved || result.warnings[0] !== "neutral_variant_requires_explicit_approval",
          "Neutral approval warning conflicts with input.");
      } else requireValue(result.warnings.length === 0, "Audience result has unexpected warnings.");
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Malformed audience result.";
  }
}