import type { WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import type { RuleId } from "../webinar-standard-catalog/rule-ids";
import { freezeOwned, compareText } from "../webinar-standard-readiness/safe-data";
import { planWebinarRecruitment } from "../webinar-standard-scheduling/index";
import { addBusinessDays, BUSINESS_DAY_CONVENTION } from "../webinar-standard-planning-time/business-days";
import {
  type AudienceCommunicationKind, type AudienceObligation, type AudienceParticipantInput,
  type AudienceState, type ParticipantAudiencePlan, type WebinarAudiencePlan,
} from "./types";
import { validateAudiencePlanningInput } from "./validate";

const RULE = {
  registrationConfirmation: "WEB-REG-001", calendar: "WEB-REG-002",
  reminder24: "WEB-REG-003", reminder1: "WEB-REG-004", change: "WEB-REG-005",
  eventCancellation: "WEB-REG-006", late: "WEB-REG-008", recruitmentSuppression: "WEB-REC-005",
  attended: "WEB-FU-ATT-001", absent: "WEB-FU-ABS-001", reconcile: "WEB-FU-UNK-001",
  noConflict: "WEB-FU-UNK-002", neutral: "WEB-FU-UNK-003", waitlist: "WEB-FU-WL-001",
  promotion: "WEB-FU-WL-002", closure: "WEB-FU-WL-003", cancellation: "WEB-FU-CAN-001",
  cancellationSuppress: "WEB-FU-CAN-002", internal: "WEB-FU-INT-001", qa: "WEB-FU-INT-002",
  distinct: "WEB-FU-VAR-001",
} as const satisfies Record<string, RuleId>;

export function communicationId(participant: AudienceParticipantInput, kind: AudienceCommunicationKind): string {
  return participant.communicationIds?.[kind] ?? JSON.stringify(["audience", participant.participantId, kind]);
}
/** Nominal planner-owned reminder instant, not proof of scheduling or delivery. */
export function registrantReminderInstant(
  startsAtEpochMs: number,
  kind: "reminder_24_hour" | "reminder_1_hour",
): number {
  return startsAtEpochMs - (kind === "reminder_24_hour" ? 86_400_000 : 3_600_000);
}
function obligation(
  participant: AudienceParticipantInput, kind: AudienceCommunicationKind,
  disposition: AudienceObligation["disposition"], dueAtEpochMs: number | null,
  calculation: number, reason: string, ruleIds: readonly RuleId[],
  options: {
    customerPath?: boolean; variant?: AudienceObligation["variant"]; assetId?: string | null;
    deadline?: ReturnType<typeof addBusinessDays>;
  } = {},
): AudienceObligation {
  const deadline = options.deadline;
  return {
    kind, communicationId: communicationId(participant, kind), disposition, dueAtEpochMs,
    timingKind: disposition === "required" ? "deadline" : disposition === "eligible" ? "eligibility" : "none",
    overdue: disposition === "required" && dueAtEpochMs !== null && dueAtEpochMs < calculation,
    reason, customerPath: options.customerPath ?? true, variant: options.variant ?? null,
    assetId: options.assetId ?? null, canonicalRuleIds: [...ruleIds],
    deadlineLocal: deadline ? {
      date: deadline.localDate, time: deadline.localTime, offset: deadline.offset,
      disambiguation: deadline.disambiguation, requestedLocalDateTime: deadline.requestedLocalDateTime,
    } : null,
  };
}
export function stateFor(participant: AudienceParticipantInput, eventStatus: string): AudienceState {
  if (participant.audienceClass !== "customer") return "internal_or_test";
  if (participant.registrationStatus === "cancelled") return "cancelled";
  if (participant.registrationStatus === "waitlisted") return "waitlisted";
  if (participant.registrationStatus === "not_registered") return "eligible_non_registrant";
  if (eventStatus === "completed") {
    if (participant.attendanceState === "attended") return "attended";
    if (participant.attendanceState === "absent") return "registered_absent";
    return "attendance_unknown";
  }
  return "registered";
}

export function planWebinarAudience(
  catalog: WebinarStandardCatalog,
  input: unknown,
): WebinarAudiencePlan {
  const value = validateAudiencePlanningInput(catalog, input);
  const participants = [...value.participants]
    .sort((left, right) => compareText(left.participantId, right.participantId))
    .map((participant): ParticipantAudiencePlan => {
      const state = stateFor(participant, value.event.operationalStatus);
      const suppressions: string[] = [];
      const warnings: string[] = [];
      const obligations: AudienceObligation[] = [];
      const recruitmentStatusActive = value.event.operationalStatus === "draft"
        || value.event.operationalStatus === "open_for_registration"
        || value.event.operationalStatus === "scheduled";
      const canRecruit = state === "eligible_non_registrant"
        && participant.recruitmentEligible && participant.contactable && !participant.optedOut
        && !participant.invalidAddress && !participant.governedExclusion
        && recruitmentStatusActive
        && value.calculationInstantEpochMs < value.event.startsAtEpochMs;

      let recruitmentPlan: ReturnType<typeof planWebinarRecruitment> | null = null;
      if (canRecruit) {
        recruitmentPlan = planWebinarRecruitment(catalog, {
          calculationInstantEpochMs: value.calculationInstantEpochMs,
          webinarStartEpochMs: value.event.startsAtEpochMs,
          timeZone: value.timeZone,
          eventStatus: value.event.operationalStatus,
          standardId: value.standardId,
          standardVersion: value.standardVersion,
          touches: value.recruitmentTouches,
        });
      } else {
        if (state !== "eligible_non_registrant") suppressions.push("participant_state_suppresses_recruitment");
        if (!participant.recruitmentEligible) suppressions.push("not_recruitment_eligible");
        if (!participant.contactable) suppressions.push("not_contactable");
        if (participant.optedOut) suppressions.push("opted_out");
        if (participant.invalidAddress) suppressions.push("invalid_address");
        if (participant.governedExclusion) suppressions.push("governed_exclusion");
        if (!recruitmentStatusActive) suppressions.push("event_inactive_for_recruitment");
        if (value.event.operationalStatus === "cancelled") suppressions.push("event_cancelled");
        if (value.calculationInstantEpochMs >= value.event.startsAtEpochMs) suppressions.push("event_started");
      }

      if (state === "internal_or_test") {
        suppressions.push("excluded_from_customer_communications", "excluded_from_customer_reporting");
        if (participant.qaTestSendRequested) {
          obligations.push(obligation(participant, "qa_test_send", "eligible", value.calculationInstantEpochMs,
            value.calculationInstantEpochMs, "Explicitly labelled QA planning only; never a customer path.",
            [RULE.qa], { customerPath: false, variant: "qa_test" }));
        }
      } else if (state === "cancelled") {
        suppressions.push("all_future_customer_paths");
        obligations.push(obligation(participant, "participant_cancellation_confirmation", "required",
          participant.participantCancellationTriggeredAtEpochMs, value.calculationInstantEpochMs,
          "Participant cancellation confirmation is due at the supplied trigger.", [RULE.cancellation]));
      } else if (state === "waitlisted") {
        obligations.push(obligation(participant, "waitlist_confirmation", "required", participant.waitlistedAtEpochMs,
          value.calculationInstantEpochMs, "Waitlist confirmation is immediate.", [RULE.waitlist]));
        if (participant.waitlistPromotionTriggeredAtEpochMs !== null) {
          obligations.push(obligation(participant, "waitlist_promotion", "required", participant.waitlistPromotionTriggeredAtEpochMs,
            value.calculationInstantEpochMs, "Promotion confirmation is due at the supplied trigger.", [RULE.promotion]));
        }
        const closureTrigger = participant.waitlistClosureTriggeredAtEpochMs
          ?? (value.event.operationalStatus === "cancelled" ? value.event.cancellationTriggeredAtEpochMs : null);
        if (closureTrigger !== null) {
          obligations.push(obligation(participant, "waitlist_closure", "required", closureTrigger,
            value.calculationInstantEpochMs,
            participant.waitlistClosureTriggeredAtEpochMs !== null
              ? "Non-admission notice is due at the supplied closure trigger."
              : "Event cancellation closes the waitlist and requires a non-admission notice.",
            [RULE.closure]));
        }
        suppressions.push("waitlist_suppresses_recruitment");
        if (value.event.operationalStatus === "cancelled") suppressions.push("all_future_customer_paths");
      } else if (state !== "eligible_non_registrant") {
        suppressions.push("registration_suppresses_recruitment");
        addRegistrantObligations(obligations, participant, value);
        if (value.event.operationalStatus === "completed") {
          addFollowUpObligations(obligations, warnings, participant, state, value);
        } else if (value.event.operationalStatus === "cancelled") {
          suppressions.push("event_cancellation_suppresses_reminders_and_follow_up");
        }
      }

      obligations.sort((left, right) =>
        (left.dueAtEpochMs ?? Number.MAX_SAFE_INTEGER) - (right.dueAtEpochMs ?? Number.MAX_SAFE_INTEGER)
        || compareText(left.kind, right.kind));
      return {
        participantId: participant.participantId, state, recruitmentEligible: canRecruit,
        customerReportingIncluded: participant.audienceClass === "customer" && state !== "cancelled",
        suppressions: [...new Set(suppressions)].sort(compareText), warnings: warnings.sort(compareText),
        obligations, recruitmentPlan,
      };
    });
  return freezeOwned({
    mode: "planning_only", sendAuthorized: false, standardId: value.standardId,
    standardVersion: value.standardVersion, eventId: value.event.eventId,
    calculationInstantEpochMs: value.calculationInstantEpochMs, timeZone: value.timeZone,
    authority: { readinessOverride: false, exceptionOverride: false, sendingAuthority: false },
    businessDayConvention: {
      days: "Monday-Friday", holidayCalendar: false, timeZone: value.timeZone,
      limitation: `Monday through Friday in the supplied IANA time zone; no holiday calendar (${BUSINESS_DAY_CONVENTION.timeZoneBasis}).`,
    },
    participants,
  });
}

function addRegistrantObligations(
  obligations: AudienceObligation[], participant: AudienceParticipantInput,
  input: ReturnType<typeof validateAudiencePlanningInput>,
): void {
  const registrationAt = participant.registrationAtEpochMs!;
  obligations.push(obligation(participant, "registration_confirmation", "required", registrationAt,
    input.calculationInstantEpochMs, "Immediate at registration; retained as overdue when replanned late.",
    [RULE.registrationConfirmation]));
  obligations.push(obligation(participant, "calendar_information", "required", registrationAt,
    input.calculationInstantEpochMs, "Calendar and attendance information is immediate with confirmation.",
    [RULE.calendar]));
  const cancelled = input.event.operationalStatus === "cancelled";
  for (const reminder of [
    { kind: "reminder_24_hour" as const, rule: RULE.reminder24 },
    { kind: "reminder_1_hour" as const, rule: RULE.reminder1 },
  ]) {
    const due = registrantReminderInstant(input.event.startsAtEpochMs, reminder.kind);
    const future = due > input.calculationInstantEpochMs && due >= registrationAt && !cancelled;
    obligations.push(obligation(participant, reminder.kind, future ? "required" : "omitted",
      future ? due : null, input.calculationInstantEpochMs,
      cancelled ? "Event cancellation suppresses reminders."
        : due < registrationAt ? "Registration occurred after this nominal reminder."
        : "Nominal reminder is not in the future; no backdating.", [reminder.rule, RULE.late]));
  }
  if (input.event.materialChangeTriggeredAtEpochMs !== null && !cancelled
    && registrationAt <= input.event.materialChangeTriggeredAtEpochMs) {
    obligations.push(obligation(participant, "event_change_notice", "required",
      input.event.materialChangeTriggeredAtEpochMs, input.calculationInstantEpochMs,
      "Material event change notice is due at the supplied trigger.", [RULE.change]));
  }
  if (input.event.cancellationTriggeredAtEpochMs !== null) {
    obligations.push(obligation(participant, "event_cancellation_notice", "required",
      input.event.cancellationTriggeredAtEpochMs, input.calculationInstantEpochMs,
      "Event cancellation notice is due at the supplied trigger.", [RULE.eventCancellation]));
  }
}

function addFollowUpObligations(
  obligations: AudienceObligation[], warnings: string[], participant: AudienceParticipantInput,
  state: AudienceState, input: ReturnType<typeof validateAudiencePlanningInput>,
): void {
  const actualEnd = input.event.actualEndsAtEpochMs!;
  if (state === "attended") {
    const deadline = addBusinessDays(actualEnd, input.timeZone, 1);
    obligations.push(obligation(participant, "attended_follow_up", "required", deadline.epochMs,
      input.calculationInstantEpochMs, "Attended follow-up is due within one business day.",
      [RULE.attended, RULE.distinct], { variant: "attended", assetId: participant.followUpAssetId, deadline }));
  } else if (state === "registered_absent") {
    // Attendance processing is observational latency, not a new clock anchor.
    // Both attendance outcomes use the actual event completion instant.
    const deadline = addBusinessDays(actualEnd, input.timeZone, 1);
    obligations.push(obligation(participant, "absent_follow_up", "required", deadline.epochMs,
      input.calculationInstantEpochMs, "Absent follow-up is due within one business day of actual event completion.",
      [RULE.absent, RULE.distinct], { variant: "absent", assetId: participant.followUpAssetId, deadline }));
  } else if (state === "attendance_unknown") {
    obligations.push(obligation(participant, "attendance_reconciliation", "required", actualEnd,
      input.calculationInstantEpochMs, "Reconciliation precedes any follow-up treatment.",
      [RULE.reconcile, RULE.noConflict]));
    const threshold = addBusinessDays(actualEnd, input.timeZone, 2);
    if (input.calculationInstantEpochMs >= threshold.epochMs && participant.neutralVariantApproved) {
      obligations.push(obligation(participant, "neutral_follow_up", "eligible", threshold.epochMs,
        input.calculationInstantEpochMs, "Approved neutral variant is eligible after two business days; this is not send authorization.",
        [RULE.neutral, RULE.noConflict], { variant: "neutral", assetId: participant.followUpAssetId, deadline: threshold }));
    } else {
      warnings.push(input.calculationInstantEpochMs < threshold.epochMs
        ? "neutral_variant_not_yet_eligible" : "neutral_variant_requires_explicit_approval");
    }
  }
}