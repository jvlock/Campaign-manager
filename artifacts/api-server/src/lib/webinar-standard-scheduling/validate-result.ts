import { Temporal } from "@js-temporal/polyfill";
import type { StandardId, StandardVersion } from "../webinar-standard-catalog/types";
import type { EventOperationalStatus } from "../webinar-standard-evaluation/types";
import {
  assertInstant,
  assertTimeZone,
  localTime,
} from "../webinar-standard-planning-time/time";
import {
  RECRUITMENT_TOUCH_IDENTITIES,
  type RecruitmentPlan,
  type RecruitmentTouchIdentity,
  type RecruitmentTouchReason,
  type RecruitmentWarning,
  type RecruitmentWindowBand,
} from "./types";
import {
  RECRUITMENT_BAND_RULES,
  RECRUITMENT_OFFSETS,
  RECRUITMENT_TOUCH_RULES,
  recruitmentApplicabilityForBand,
} from "./plan";

export interface RecruitmentPlanResultExpectation {
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly calculationInstantEpochMs: number;
  readonly webinarStartEpochMs: number;
  readonly timeZone: string;
  readonly eventStatus: EventOperationalStatus;
}

const PLAN_FIELDS = [
  "planningOnly", "sendAuthorized", "authority", "standardId", "standardVersion",
  "selectedBand", "localCalendarDaysRemaining", "calculationInstantEpochMs",
  "webinarStartEpochMs", "timeZone", "eventStatus", "touches", "warnings", "ruleIds",
] as const;
const AUTHORITY_FIELDS = ["readinessOverride", "exceptionOverride", "suppressionOverride"] as const;
const TOUCH_FIELDS = [
  "identity", "communicationId", "disposition", "scheduledAtEpochMs", "eventLocalDate",
  "eventLocalTime", "eventLocalOffset", "originalOffsetDays", "reason", "warnings",
  "ruleIds", "timeAdjustment",
] as const;
const ADJUSTMENT_FIELDS = ["disambiguation", "requestedLocalDateTime"] as const;
const EXPECTATION_FIELDS = [
  "standardId", "standardVersion", "calculationInstantEpochMs", "webinarStartEpochMs",
  "timeZone", "eventStatus",
] as const;

const ACTIVE_STATUSES = new Set<EventOperationalStatus>(["draft", "open_for_registration", "scheduled"]);
const STATUSES = new Set<EventOperationalStatus>([
  "draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled",
]);
const BANDS = new Set<RecruitmentWindowBand>([
  "full_window", "days_14_to_20", "days_7_to_13", "days_2_to_6", "days_0_to_1",
  "inactive_event",
]);
const WARNINGS = new Set<RecruitmentWarning>([
  "compressed_window", "dst_gap_forward", "dst_overlap_earlier", "nominal_touch_past_due",
  "insufficient_24_hour_separation", "duplicate_scheduled_instant", "recruitment_inactive",
]);
const REASONS = new Set<RecruitmentTouchReason>([
  "standard_offset", "shortened_window_immediate", "shortened_window_omission",
  "nominal_instant_precedes_calculation", "nominal_instant_not_before_start",
  "insufficient_24_hour_separation", "duplicate_scheduled_instant", "event_in_progress",
  "event_completed", "event_cancelled",
]);
function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length
    && fields.every((field) => Object.hasOwn(value, field))
    && keys.every((key) => fields.includes(key));
}

function exactArray(value: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && expected.every((entry, index) => value[index] === entry);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function canonicalLocalDateTime(value: unknown): value is string {
  if (!nonempty(value)) return false;
  try {
    return Temporal.PlainDateTime.from(value, { overflow: "reject" }).toString() === value;
  } catch {
    return false;
  }
}

function expectedInactiveReason(status: EventOperationalStatus): RecruitmentTouchReason {
  if (status === "completed") return "event_completed";
  if (status === "cancelled") return "event_cancelled";
  return "event_in_progress";
}

/**
 * Checks that an untrusted scheduler result is the structurally coherent result
 * for the supplied occurrence. It deliberately does not re-run scheduling policy.
 */
export function validateRecruitmentPlanResult(
  suppliedPlan: unknown,
  suppliedExpected: RecruitmentPlanResultExpectation,
): string | null {
  try {
    if (!record(suppliedExpected) || !exactFields(suppliedExpected, EXPECTATION_FIELDS)) {
      return "Expected recruitment-plan scope is malformed.";
    }
    assertInstant(suppliedExpected.calculationInstantEpochMs, "calculationInstantEpochMs");
    assertInstant(suppliedExpected.webinarStartEpochMs, "webinarStartEpochMs");
    assertTimeZone(suppliedExpected.timeZone);
    if (!nonempty(suppliedExpected.standardId) || !nonempty(suppliedExpected.standardVersion)
      || !STATUSES.has(suppliedExpected.eventStatus)) {
      return "Expected recruitment-plan scope is malformed.";
    }
    if (!record(suppliedPlan) || !exactFields(suppliedPlan, PLAN_FIELDS)) {
      return "Scheduler result has missing or extraneous fields.";
    }
    const plan = suppliedPlan as unknown as RecruitmentPlan;
    assertInstant(plan.calculationInstantEpochMs, "calculationInstantEpochMs");
    assertInstant(plan.webinarStartEpochMs, "webinarStartEpochMs");
    assertTimeZone(plan.timeZone);
    if (plan.standardId !== suppliedExpected.standardId
      || plan.standardVersion !== suppliedExpected.standardVersion
      || plan.calculationInstantEpochMs !== suppliedExpected.calculationInstantEpochMs
      || plan.webinarStartEpochMs !== suppliedExpected.webinarStartEpochMs
      || plan.timeZone !== suppliedExpected.timeZone
      || plan.eventStatus !== suppliedExpected.eventStatus) {
      return "Scheduler result conflicts with the supplied occurrence.";
    }
    if (plan.planningOnly !== true || plan.sendAuthorized !== false
      || !record(plan.authority) || !exactFields(plan.authority, AUTHORITY_FIELDS)
      || plan.authority.readinessOverride !== false || plan.authority.exceptionOverride !== false
      || plan.authority.suppressionOverride !== false) {
      return "Scheduler result claims authority outside its structural contract.";
    }
    if (!BANDS.has(plan.selectedBand) || !STATUSES.has(plan.eventStatus)
      || !Number.isSafeInteger(plan.localCalendarDaysRemaining)) {
      return "Scheduler result has malformed band, status, or calendar metadata.";
    }
    const active = ACTIVE_STATUSES.has(plan.eventStatus);
    if (active === (plan.selectedBand === "inactive_event")) {
      return "Scheduler result band is incoherent with event status.";
    }
    const applicability = recruitmentApplicabilityForBand(plan.selectedBand);
    if (!Array.isArray(plan.touches) || plan.touches.length !== 4
      || !Array.isArray(plan.warnings) || !Array.isArray(plan.ruleIds)
      || plan.warnings.some((warning) => !WARNINGS.has(warning))
      || new Set(plan.warnings).size !== plan.warnings.length
      || !exactArray(plan.ruleIds, [RECRUITMENT_BAND_RULES[plan.selectedBand], "WEB-REC-011"])) {
      return "Scheduler result violates its canonical collection contract.";
    }

    const identities = new Set<RecruitmentTouchIdentity>();
    const communicationIds = new Set<string>();
    const scheduledInstants = new Set<number>();
    let lastScheduledInstant: number | null = null;
    let omissionsStarted = false;
    let lastOmittedIdentityIndex = -1;

    for (const touch of plan.touches as readonly unknown[]) {
      if (!record(touch) || !exactFields(touch, TOUCH_FIELDS)
        || typeof touch.identity !== "string"
        || !RECRUITMENT_TOUCH_IDENTITIES.includes(touch.identity as RecruitmentTouchIdentity)
        || !nonempty(touch.communicationId)
        || identities.has(touch.identity as RecruitmentTouchIdentity)
        || communicationIds.has(touch.communicationId)) {
        return "Scheduler result has missing, duplicate, or malformed canonical touches.";
      }
      const identity = touch.identity as RecruitmentTouchIdentity;
      identities.add(identity);
      communicationIds.add(touch.communicationId);
      if (touch.originalOffsetDays !== RECRUITMENT_OFFSETS[identity]
        || typeof touch.reason !== "string" || !REASONS.has(touch.reason as RecruitmentTouchReason)
        || !Array.isArray(touch.warnings)
        || touch.warnings.some((warning) => !WARNINGS.has(warning as RecruitmentWarning))
        || new Set(touch.warnings).size !== touch.warnings.length
        || !record(touch.timeAdjustment)
        || !exactFields(touch.timeAdjustment, ADJUSTMENT_FIELDS)
        || !["none", "gap_forward", "overlap_earlier"].includes(
          touch.timeAdjustment.disambiguation as string,
        )) {
        return "Scheduler result contains malformed touch metadata.";
      }
      const omitted = touch.disposition === "omitted";
      const adjusted = touch.disposition === "adjusted";
      const scheduled = touch.disposition === "scheduled";
      if (!omitted && !adjusted && !scheduled) return "Scheduler result has an invalid disposition.";
      if (active) {
        const immediate = identity === applicability.immediate;
        const retained = applicability.retained.includes(identity);
        if ((immediate && (!adjusted || touch.reason !== "shortened_window_immediate"))
          || (retained && touch.reason === "shortened_window_omission")
          || (!immediate && !retained
            && (!omitted || touch.reason !== "shortened_window_omission"))) {
          return "Scheduler result disposition is incoherent with band applicability.";
        }
      }
      const expectedRules = omitted
        ? [
          RECRUITMENT_TOUCH_RULES[identity], RECRUITMENT_BAND_RULES[plan.selectedBand],
          "WEB-WIN-007", "WEB-REC-011",
        ]
        : [
          RECRUITMENT_TOUCH_RULES[identity], RECRUITMENT_BAND_RULES[plan.selectedBand],
          "WEB-REC-011",
        ];
      if (!exactArray(touch.ruleIds, expectedRules)) {
        return "Scheduler result has non-canonical rule references.";
      }

      const disambiguation = touch.timeAdjustment.disambiguation;
      const requested = touch.timeAdjustment.requestedLocalDateTime;
      const hasGap = touch.warnings.includes("dst_gap_forward");
      const hasOverlap = touch.warnings.includes("dst_overlap_earlier");
      if (hasGap !== (disambiguation === "gap_forward")
        || hasOverlap !== (disambiguation === "overlap_earlier")
        || (requested !== null && !canonicalLocalDateTime(requested))
        || (disambiguation !== "none" && requested === null)) {
        return "Scheduler result has incoherent warning or adjustment metadata.";
      }

      if (omitted) {
        omissionsStarted = true;
        const identityIndex = RECRUITMENT_TOUCH_IDENTITIES.indexOf(identity);
        if (identityIndex <= lastOmittedIdentityIndex) {
          return "Scheduler result touches are not in canonical order.";
        }
        lastOmittedIdentityIndex = identityIndex;
        if (touch.scheduledAtEpochMs !== null || touch.eventLocalDate !== null
          || touch.eventLocalTime !== null || touch.eventLocalOffset !== null
          || ["standard_offset", "shortened_window_immediate"].includes(touch.reason as string)) {
          return "Scheduler result has an incoherent omission.";
        }
        const shiftedOmission = [
          "nominal_instant_precedes_calculation", "nominal_instant_not_before_start",
          "insufficient_24_hour_separation", "duplicate_scheduled_instant",
        ].includes(touch.reason as string);
        if ((shiftedOmission && !nonempty(requested))
          || (!shiftedOmission && (disambiguation !== "none" || requested !== null))
          || (touch.reason === "nominal_instant_precedes_calculation")
            !== touch.warnings.includes("nominal_touch_past_due")
          || (touch.reason === "insufficient_24_hour_separation")
            !== touch.warnings.includes("insufficient_24_hour_separation")
          || (touch.reason === "duplicate_scheduled_instant")
            !== touch.warnings.includes("duplicate_scheduled_instant")) {
          return "Scheduler result has incoherent omission reason metadata.";
        }
      } else {
        if (omissionsStarted) return "Scheduler result touches are not in canonical order.";
        assertInstant(touch.scheduledAtEpochMs, "touch.scheduledAtEpochMs");
        if (scheduledInstants.has(touch.scheduledAtEpochMs as number)
          || (lastScheduledInstant !== null && (touch.scheduledAtEpochMs as number) < lastScheduledInstant)) {
          return "Scheduler result contains duplicate or unordered scheduled instants.";
        }
        scheduledInstants.add(touch.scheduledAtEpochMs as number);
        lastScheduledInstant = touch.scheduledAtEpochMs as number;
        if ((touch.scheduledAtEpochMs as number) < plan.calculationInstantEpochMs
          || (touch.scheduledAtEpochMs as number) >= plan.webinarStartEpochMs
          || (scheduled && touch.reason !== "standard_offset")
          || (adjusted && (touch.reason !== "shortened_window_immediate"
            || touch.scheduledAtEpochMs !== plan.calculationInstantEpochMs
            || identity !== applicability.immediate))
          || (scheduled && !nonempty(requested))
          || (adjusted && (disambiguation !== "none" || requested !== null))) {
          return "Scheduler result has an incoherent scheduled touch.";
        }
        const local = localTime(touch.scheduledAtEpochMs as number, plan.timeZone);
        if (touch.eventLocalDate !== local.date || touch.eventLocalTime !== local.time
          || touch.eventLocalOffset !== local.offset) {
          return "Scheduler result local metadata does not identify its scheduled instant.";
        }
      }
    }
    if (RECRUITMENT_TOUCH_IDENTITIES.some((identity) => !identities.has(identity))) {
      return "Scheduler result is missing a canonical touch.";
    }
    if (!active) {
      const inactiveReason = expectedInactiveReason(plan.eventStatus);
      if (plan.touches.some((touch) => touch.disposition !== "omitted"
        || touch.reason !== inactiveReason
        || !exactArray(touch.warnings, ["recruitment_inactive"]))) {
        return "Inactive event recruitment result is incoherent.";
      }
    } else if (plan.touches.some((touch) => [
      "event_in_progress", "event_completed", "event_cancelled",
    ].includes(touch.reason))) {
      return "Active event recruitment result uses an inactive-event reason.";
    }
    const aggregateWarnings = [
      ...(plan.selectedBand === "days_0_to_1" ? ["compressed_window" as const] : []),
      ...new Set(plan.touches.flatMap((touch) => touch.warnings)),
    ];
    if (!exactArray(plan.warnings, aggregateWarnings)) {
      return "Scheduler result warning aggregate is incoherent.";
    }
    return null;
  } catch {
    return "Scheduler result is malformed.";
  }
}