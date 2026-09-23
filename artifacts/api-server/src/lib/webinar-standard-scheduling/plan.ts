import { validateWebinarStandardCatalog } from "../webinar-standard-catalog/validate";
import type { RuleId, WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import type { EventOperationalStatus } from "../webinar-standard-evaluation/types";
import { freezeOwned, isRecord, snapshotData } from "../webinar-standard-readiness/safe-data";
import {
  assertInstant,
  assertTimeZone,
  calendarDaysBetween,
  localTime,
  shiftCalendarDays,
} from "../webinar-standard-planning-time/time";
import {
  RECRUITMENT_TOUCH_IDENTITIES,
  RecruitmentPlanningValidationError,
  type PlannedRecruitmentTouch,
  type RecruitmentPlan,
  type RecruitmentTouchIdentity,
  type RecruitmentTouchReason,
  type RecruitmentWarning,
  type RecruitmentWindowBand,
} from "./types";

const INPUT_FIELDS = Object.freeze([
  "calculationInstantEpochMs", "webinarStartEpochMs", "timeZone", "eventStatus",
  "standardId", "standardVersion", "touches",
] as const);
const TOUCH_FIELDS = Object.freeze(["identity", "communicationId"] as const);
const ACTIVE_STATUSES = new Set<EventOperationalStatus>([
  "draft", "open_for_registration", "scheduled",
]);
const EVENT_STATUSES = new Set<EventOperationalStatus>([
  "draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled",
]);
const OFFSETS: Readonly<Record<RecruitmentTouchIdentity, 21 | 14 | 7 | 1>> = Object.freeze({
  recruitment_1: 21,
  recruitment_2: 14,
  recruitment_3: 7,
  final_recruitment: 1,
});
const TOUCH_RULES: Readonly<Record<RecruitmentTouchIdentity, RuleId>> = Object.freeze({
  recruitment_1: "WEB-REC-001",
  recruitment_2: "WEB-REC-002",
  recruitment_3: "WEB-REC-003",
  final_recruitment: "WEB-REC-004",
});
const BAND_RULES: Readonly<Record<RecruitmentWindowBand, RuleId>> = Object.freeze({
  full_window: "WEB-WIN-001",
  days_14_to_20: "WEB-WIN-002",
  days_7_to_13: "WEB-WIN-003",
  days_2_to_6: "WEB-WIN-004",
  days_0_to_1: "WEB-WIN-005",
  inactive_event: "WEB-WIN-006",
});

function fail(
  code: ConstructorParameters<typeof RecruitmentPlanningValidationError>[0],
  field: string,
  message: string,
): never {
  throw new RecruitmentPlanningValidationError(code, field, message);
}

function exactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) fail("missing_field", `${field}.${key}`, "Required field is missing.");
  }
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) fail("unknown_field", `${field}.${key}`, "Unknown field is not permitted.");
  }
}

function checkedInstant(value: unknown, field: string): number {
  try {
    return assertInstant(value, field);
  } catch {
    return fail("invalid_instant", field, "Expected a finite valid epoch-millisecond instant.");
  }
}

function checkedZone(value: unknown): string {
  try {
    return assertTimeZone(value);
  } catch {
    return fail("invalid_time_zone", "timeZone", "Expected a valid IANA time zone.");
  }
}

function selectBand(days: number): Exclude<RecruitmentWindowBand, "inactive_event"> {
  if (days >= 21) return "full_window";
  if (days >= 14) return "days_14_to_20";
  if (days >= 7) return "days_7_to_13";
  if (days >= 2) return "days_2_to_6";
  return "days_0_to_1";
}

function inactiveReason(status: EventOperationalStatus): RecruitmentTouchReason {
  if (status === "completed") return "event_completed";
  if (status === "cancelled") return "event_cancelled";
  return "event_in_progress";
}

function applicableIdentities(band: RecruitmentWindowBand): {
  readonly immediate: RecruitmentTouchIdentity | null;
  readonly retained: readonly RecruitmentTouchIdentity[];
} {
  switch (band) {
    case "full_window":
      return { immediate: null, retained: RECRUITMENT_TOUCH_IDENTITIES };
    case "days_14_to_20":
      return { immediate: "recruitment_2", retained: ["recruitment_3", "final_recruitment"] };
    case "days_7_to_13":
      return { immediate: "recruitment_3", retained: ["final_recruitment"] };
    case "days_2_to_6":
      return { immediate: "recruitment_3", retained: ["final_recruitment"] };
    case "days_0_to_1":
      return { immediate: "final_recruitment", retained: [] };
    case "inactive_event":
      return { immediate: null, retained: [] };
  }
}

export function planWebinarRecruitment(
  catalog: WebinarStandardCatalog,
  input: unknown,
): RecruitmentPlan {
  const validatedCatalog = validateWebinarStandardCatalog(catalog);
  if (!validatedCatalog.ok) fail("invalid_catalog", "catalog", "Catalog failed canonical validation.");
  const snapshot = snapshotData(input);
  if (!snapshot.ok || !isRecord(snapshot.value)) fail("invalid_input", "input", "Expected plain data object.");
  const data = snapshot.value;
  exactFields(data, INPUT_FIELDS, "input");

  const calculationInstantEpochMs = checkedInstant(
    data.calculationInstantEpochMs, "calculationInstantEpochMs",
  );
  const webinarStartEpochMs = checkedInstant(data.webinarStartEpochMs, "webinarStartEpochMs");
  const timeZone = checkedZone(data.timeZone);
  if (typeof data.eventStatus !== "string" || !EVENT_STATUSES.has(data.eventStatus as EventOperationalStatus)) {
    fail("unsupported_event_status", "eventStatus", "Unsupported event operational status.");
  }
  const eventStatus = data.eventStatus as EventOperationalStatus;
  if (data.standardId !== validatedCatalog.catalog.standardId) {
    fail("standard_mismatch", "standardId", "Must exactly match the catalog standard identifier.");
  }
  if (data.standardVersion !== validatedCatalog.catalog.standardVersion) {
    fail("standard_mismatch", "standardVersion", "Must exactly match the catalog standard version.");
  }
  if (!Array.isArray(data.touches) || data.touches.length !== 4) {
    fail("invalid_touches", "touches", "Expected exactly four canonical recruitment touches.");
  }
  const byIdentity = new Map<RecruitmentTouchIdentity, string>();
  const communicationIds = new Set<string>();
  for (let index = 0; index < data.touches.length; index++) {
    const touch = data.touches[index];
    if (!isRecord(touch)) fail("invalid_touches", `touches.${index}`, "Expected a touch object.");
    exactFields(touch, TOUCH_FIELDS, `touches.${index}`);
    if (typeof touch.identity !== "string"
      || !RECRUITMENT_TOUCH_IDENTITIES.includes(touch.identity as RecruitmentTouchIdentity)) {
      fail("invalid_touches", `touches.${index}.identity`, "Expected a canonical recruitment identity.");
    }
    const identity = touch.identity as RecruitmentTouchIdentity;
    if (byIdentity.has(identity)) {
      fail("duplicate_touch_identity", `touches.${index}.identity`, "Touch identity must be unique.");
    }
    if (typeof touch.communicationId !== "string" || touch.communicationId.length === 0) {
      fail("invalid_touches", `touches.${index}.communicationId`, "Expected a non-empty communication ID.");
    }
    if (communicationIds.has(touch.communicationId)) {
      fail("duplicate_communication_id", `touches.${index}.communicationId`, "Communication ID must be unique.");
    }
    byIdentity.set(identity, touch.communicationId);
    communicationIds.add(touch.communicationId);
  }
  for (const identity of RECRUITMENT_TOUCH_IDENTITIES) {
    if (!byIdentity.has(identity)) fail("invalid_touches", "touches", `Missing canonical touch ${identity}.`);
  }

  const active = ACTIVE_STATUSES.has(eventStatus);
  if (active && calculationInstantEpochMs >= webinarStartEpochMs) {
    fail(
      "active_event_not_in_future",
      "calculationInstantEpochMs",
      "An active recruitment plan requires calculation before webinar start.",
    );
  }
  const days = calendarDaysBetween(calculationInstantEpochMs, webinarStartEpochMs, timeZone);
  const band: RecruitmentWindowBand = active ? selectBand(days) : "inactive_event";
  const bandRule = BAND_RULES[band];
  const applicability = applicableIdentities(band);
  const candidates: PlannedRecruitmentTouch[] = [];
  const usedInstants = new Set<number>();

  function omitted(
    identity: RecruitmentTouchIdentity,
    reason: RecruitmentTouchReason,
    warnings: readonly RecruitmentWarning[] = [],
    adjustment: PlannedRecruitmentTouch["timeAdjustment"] = {
      disambiguation: "none",
      requestedLocalDateTime: null,
    },
  ): PlannedRecruitmentTouch {
    return {
      identity,
      communicationId: byIdentity.get(identity)!,
      disposition: "omitted",
      scheduledAtEpochMs: null,
      eventLocalDate: null,
      eventLocalTime: null,
      eventLocalOffset: null,
      originalOffsetDays: OFFSETS[identity],
      reason,
      warnings,
      ruleIds: [TOUCH_RULES[identity], bandRule, "WEB-WIN-007", "WEB-REC-011"],
      timeAdjustment: adjustment,
    };
  }

  function scheduled(identity: RecruitmentTouchIdentity, immediate: boolean): PlannedRecruitmentTouch {
    const shifted = immediate ? null : shiftCalendarDays(
      webinarStartEpochMs, timeZone, -OFFSETS[identity],
    );
    const epochMs = immediate ? calculationInstantEpochMs : shifted!.epochMs;
    const disambiguation = shifted?.disambiguation ?? "none";
    const adjustment = {
      disambiguation,
      requestedLocalDateTime: shifted?.requestedLocalDateTime ?? null,
    };
    const timeWarnings: RecruitmentWarning[] = [];
    if (disambiguation === "gap_forward") timeWarnings.push("dst_gap_forward");
    if (disambiguation === "overlap_earlier") timeWarnings.push("dst_overlap_earlier");
    if (epochMs < calculationInstantEpochMs) {
      return omitted(
        identity,
        "nominal_instant_precedes_calculation",
        [...timeWarnings, "nominal_touch_past_due"],
        adjustment,
      );
    }
    if (epochMs >= webinarStartEpochMs) {
      return omitted(identity, "nominal_instant_not_before_start", timeWarnings, adjustment);
    }
    if (band === "days_2_to_6" && identity === "final_recruitment"
      && epochMs - calculationInstantEpochMs < 86_400_000) {
      return omitted(
        identity,
        "insufficient_24_hour_separation",
        [...timeWarnings, "insufficient_24_hour_separation"],
        adjustment,
      );
    }
    if (usedInstants.has(epochMs)) {
      return omitted(
        identity,
        "duplicate_scheduled_instant",
        [...timeWarnings, "duplicate_scheduled_instant"],
        adjustment,
      );
    }
    usedInstants.add(epochMs);
    const local = localTime(epochMs, timeZone);
    return {
      identity,
      communicationId: byIdentity.get(identity)!,
      disposition: immediate ? "adjusted" : "scheduled",
      scheduledAtEpochMs: epochMs,
      eventLocalDate: local.date,
      eventLocalTime: local.time,
      eventLocalOffset: local.offset,
      originalOffsetDays: OFFSETS[identity],
      reason: immediate ? "shortened_window_immediate" : "standard_offset",
      warnings: timeWarnings,
      ruleIds: [TOUCH_RULES[identity], bandRule, "WEB-REC-011"],
      timeAdjustment: adjustment,
    };
  }

  if (!active) {
    for (const identity of RECRUITMENT_TOUCH_IDENTITIES) {
      candidates.push(omitted(identity, inactiveReason(eventStatus), ["recruitment_inactive"]));
    }
  } else {
    for (const identity of RECRUITMENT_TOUCH_IDENTITIES) {
      if (identity === applicability.immediate) candidates.push(scheduled(identity, true));
      else if (applicability.retained.includes(identity)) candidates.push(scheduled(identity, false));
      else candidates.push(omitted(identity, "shortened_window_omission"));
    }
  }
  candidates.sort((left, right) => {
    if (left.scheduledAtEpochMs !== null && right.scheduledAtEpochMs !== null) {
      return left.scheduledAtEpochMs - right.scheduledAtEpochMs
        || RECRUITMENT_TOUCH_IDENTITIES.indexOf(left.identity)
          - RECRUITMENT_TOUCH_IDENTITIES.indexOf(right.identity);
    }
    if (left.scheduledAtEpochMs !== null) return -1;
    if (right.scheduledAtEpochMs !== null) return 1;
    return RECRUITMENT_TOUCH_IDENTITIES.indexOf(left.identity)
      - RECRUITMENT_TOUCH_IDENTITIES.indexOf(right.identity);
  });
  const warnings = [...new Set(candidates.flatMap((touch) => touch.warnings))];
  if (band === "days_0_to_1") warnings.unshift("compressed_window");

  return freezeOwned({
    planningOnly: true,
    sendAuthorized: false,
    authority: {
      readinessOverride: false,
      exceptionOverride: false,
      suppressionOverride: false,
    },
    standardId: validatedCatalog.catalog.standardId,
    standardVersion: validatedCatalog.catalog.standardVersion,
    selectedBand: band,
    localCalendarDaysRemaining: days,
    calculationInstantEpochMs,
    webinarStartEpochMs,
    timeZone,
    eventStatus,
    touches: candidates,
    warnings,
    ruleIds: [bandRule, "WEB-REC-011" as RuleId],
  } satisfies RecruitmentPlan);
}