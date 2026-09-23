import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Temporal } from "@js-temporal/polyfill";
import { validateWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/index";
import {
  planWebinarRecruitment,
  RecruitmentPlanningValidationError,
  type RecruitmentPlanningInput,
  type RecruitmentTouchIdentity,
} from "../../src/lib/webinar-standard-scheduling/index";

const catalogPath = fileURLToPath(
  new URL("../../../../docs/standards/webinar/WEB-STANDARD-001.rules.json", import.meta.url),
);
const parsedCatalog: unknown = JSON.parse(await readFile(catalogPath, "utf8"));
const checkedCatalog = validateWebinarStandardCatalog(parsedCatalog);
assert.equal(checkedCatalog.ok, true);
if (!checkedCatalog.ok) throw new Error("Canonical catalog fixture did not validate.");
const catalog = checkedCatalog.catalog;

const identities = [
  "recruitment_1", "recruitment_2", "recruitment_3", "final_recruitment",
] as const;

function instant(text: string): number {
  return Number(Temporal.Instant.from(text).epochMilliseconds);
}

function input(
  days: number,
  overrides: Partial<RecruitmentPlanningInput> = {},
): RecruitmentPlanningInput {
  const webinarStartEpochMs = instant("2025-06-30T12:00:00Z");
  return {
    calculationInstantEpochMs: webinarStartEpochMs - days * 86_400_000,
    webinarStartEpochMs,
    timeZone: "UTC",
    eventStatus: "scheduled",
    standardId: catalog.standardId,
    standardVersion: catalog.standardVersion,
    touches: identities.map((identity) => ({ identity, communicationId: `comm-${identity}` })),
    ...overrides,
  };
}

function active(plan: ReturnType<typeof planWebinarRecruitment>) {
  return plan.touches.filter((touch) => touch.scheduledAtEpochMs !== null);
}

for (const [days, band, activeIdentities] of [
  [21, "full_window", identities],
  [20, "days_14_to_20", ["recruitment_2", "recruitment_3", "final_recruitment"]],
  [14, "days_14_to_20", ["recruitment_2", "recruitment_3", "final_recruitment"]],
  [13, "days_7_to_13", ["recruitment_3", "final_recruitment"]],
  [7, "days_7_to_13", ["recruitment_3", "final_recruitment"]],
  [6, "days_2_to_6", ["recruitment_3", "final_recruitment"]],
  [2, "days_2_to_6", ["recruitment_3", "final_recruitment"]],
  [1, "days_0_to_1", ["final_recruitment"]],
  [0, "days_0_to_1", ["final_recruitment"]],
] as const) {
  test(`recruitment boundary ${days} local calendar days selects ${band}`, () => {
    const plan = planWebinarRecruitment(catalog, input(days, days === 0
      ? { calculationInstantEpochMs: instant("2025-06-30T11:59:59Z") }
      : {}));
    assert.equal(plan.selectedBand, band);
    assert.deepEqual(active(plan).map((touch) => touch.identity), activeIdentities);
    assert.equal(plan.touches.length, 4);
  });
}

test("active calculation exactly equal to webinar start is explicitly rejected", () => {
  const value = input(0);
  assert.throws(
    () => planWebinarRecruitment(catalog, value),
    (error) => error instanceof RecruitmentPlanningValidationError
      && error.code === "active_event_not_in_future",
  );
});

test("active calculation after webinar start is explicitly rejected", () => {
  const value = input(0, {
    calculationInstantEpochMs: instant("2025-06-30T12:00:00.001Z"),
  });
  assert.throws(
    () => planWebinarRecruitment(catalog, value),
    (error) => error instanceof RecruitmentPlanningValidationError
      && error.code === "active_event_not_in_future",
  );
});

for (const status of ["in_progress", "completed", "cancelled"] as const) {
  test(`${status} event visibly omits all recruitment touches`, () => {
    const plan = planWebinarRecruitment(catalog, input(0, { eventStatus: status }));
    assert.equal(plan.selectedBand, "inactive_event");
    assert.equal(active(plan).length, 0);
    assert.deepEqual(plan.touches.map((touch) => touch.identity), identities);
    assert.ok(plan.touches.every((touch) => touch.disposition === "omitted"));
  });
}

test("nominal touch just earlier than calculation is omitted rather than moved", () => {
  const value = input(21, {
    calculationInstantEpochMs: instant("2025-06-09T12:00:00.001Z"),
  });
  const plan = planWebinarRecruitment(catalog, value);
  const first = plan.touches.find((touch) => touch.identity === "recruitment_1");
  assert.equal(first?.reason, "nominal_instant_precedes_calculation");
  assert.equal(first?.scheduledAtEpochMs, null);
});

test("2-to-6 band retains final touch at exactly 24 elapsed hours", () => {
  const plan = planWebinarRecruitment(catalog, input(2));
  assert.equal(
    plan.touches.find((touch) => touch.identity === "final_recruitment")?.disposition,
    "scheduled",
  );
});

test("2-to-6 band omits final touch just under 24 elapsed hours", () => {
  const plan = planWebinarRecruitment(catalog, input(2, {
    calculationInstantEpochMs: instant("2025-06-28T12:00:00.001Z"),
  }));
  assert.equal(
    plan.touches.find((touch) => touch.identity === "final_recruitment")?.reason,
    "insufficient_24_hour_separation",
  );
});

test("2-to-6 band retains final touch just over 24 elapsed hours", () => {
  const plan = planWebinarRecruitment(catalog, input(2, {
    calculationInstantEpochMs: instant("2025-06-28T11:59:59.999Z"),
  }));
  assert.equal(
    plan.touches.find((touch) => touch.identity === "final_recruitment")?.disposition,
    "scheduled",
  );
});

test("spring gap shifts forward and exposes requested local time", () => {
  const start = instant("2024-04-21T00:30:00Z"); // 02:30 Europe/Paris
  const plan = planWebinarRecruitment(catalog, input(21, {
    calculationInstantEpochMs: instant("2024-03-01T00:00:00Z"),
    webinarStartEpochMs: start,
    timeZone: "Europe/Paris",
  }));
  const first = plan.touches.find((touch) => touch.identity === "recruitment_1");
  assert.equal(first?.timeAdjustment.disambiguation, "gap_forward");
  assert.equal(first?.eventLocalTime?.startsWith("03:30"), true);
  assert.equal(first?.timeAdjustment.requestedLocalDateTime?.startsWith("2024-03-31T02:30"), true);
});

test("past nominal spring-gap touch remains omitted with gap metadata and warning", () => {
  const plan = planWebinarRecruitment(catalog, input(21, {
    calculationInstantEpochMs: instant("2024-03-31T01:31:00Z"), // 03:31 Europe/Paris
    webinarStartEpochMs: instant("2024-04-21T00:30:00Z"), // 02:30 Europe/Paris
    timeZone: "Europe/Paris",
  }));
  const first = plan.touches.find((touch) => touch.identity === "recruitment_1");
  assert.equal(first?.disposition, "omitted");
  assert.equal(first?.reason, "nominal_instant_precedes_calculation");
  assert.equal(first?.timeAdjustment.disambiguation, "gap_forward");
  assert.equal(first?.timeAdjustment.requestedLocalDateTime?.startsWith("2024-03-31T02:30"), true);
  assert.ok(first?.warnings.includes("dst_gap_forward"));
});

test("skipped-date nominal touch moved to event start is omitted with gap metadata", () => {
  const plan = planWebinarRecruitment(catalog, input(21, {
    calculationInstantEpochMs: instant("2011-12-01T00:00:00Z"),
    webinarStartEpochMs: instant("2011-12-30T22:00:00Z"), // Dec 31 12:00 Pacific/Apia
    timeZone: "Pacific/Apia",
  }));
  const final = plan.touches.find((touch) => touch.identity === "final_recruitment");
  assert.equal(final?.disposition, "omitted");
  assert.equal(final?.scheduledAtEpochMs, null);
  assert.equal(final?.reason, "nominal_instant_not_before_start");
  assert.equal(final?.timeAdjustment.disambiguation, "gap_forward");
  assert.equal(final?.timeAdjustment.requestedLocalDateTime?.startsWith("2011-12-30T12:00"), true);
  assert.ok(final?.warnings.includes("dst_gap_forward"));
});

test("fall overlap selects earlier occurrence and exposes disambiguation", () => {
  const start = instant("2024-11-17T01:30:00Z"); // 02:30 Europe/Paris
  const plan = planWebinarRecruitment(catalog, input(21, {
    calculationInstantEpochMs: instant("2024-10-01T00:00:00Z"),
    webinarStartEpochMs: start,
    timeZone: "Europe/Paris",
  }));
  const first = plan.touches.find((touch) => touch.identity === "recruitment_1");
  assert.equal(first?.timeAdjustment.disambiguation, "overlap_earlier");
  assert.equal(first?.eventLocalOffset, "+02:00");
});

test("calendar shifts preserve wall-clock time across DST and are not fixed 24-hour days", () => {
  const start = instant("2024-03-31T10:00:00Z"); // 12:00 Europe/Paris on spring transition day
  const plan = planWebinarRecruitment(catalog, input(21, {
    calculationInstantEpochMs: instant("2024-03-01T00:00:00Z"),
    webinarStartEpochMs: start,
    timeZone: "Europe/Paris",
  }));
  const final = plan.touches.find((touch) => touch.identity === "final_recruitment");
  assert.equal(final?.eventLocalTime?.startsWith("12:00"), true);
  assert.equal(start - final!.scheduledAtEpochMs!, 23 * 60 * 60 * 1000);
});

test("a no-DST zone uses local calendar dates and preserved wall time", () => {
  const plan = planWebinarRecruitment(catalog, input(21, { timeZone: "Asia/Kolkata" }));
  assert.ok(active(plan).every((touch) => touch.timeAdjustment.disambiguation === "none"));
  assert.equal(active(plan)[0]?.eventLocalTime, "17:30:00");
});

test("invalid zone is explicitly rejected without an environment fallback", () => {
  assert.throws(
    () => planWebinarRecruitment(catalog, input(21, { timeZone: "Not/A_Zone" })),
    (error) => error instanceof RecruitmentPlanningValidationError
      && error.code === "invalid_time_zone",
  );
});

test("duplicate identities are explicitly rejected", () => {
  const value = input(21);
  const touches = value.touches.map((touch) => ({ ...touch }));
  touches[1]!.identity = "recruitment_1" as RecruitmentTouchIdentity;
  assert.throws(
    () => planWebinarRecruitment(catalog, { ...value, touches }),
    (error) => error instanceof RecruitmentPlanningValidationError
      && error.code === "duplicate_touch_identity",
  );
});

test("duplicate communication IDs are explicitly rejected", () => {
  const value = input(21);
  const touches = value.touches.map((touch) => ({ ...touch }));
  touches[1]!.communicationId = touches[0]!.communicationId;
  assert.throws(
    () => planWebinarRecruitment(catalog, { ...value, touches }),
    (error) => error instanceof RecruitmentPlanningValidationError
      && error.code === "duplicate_communication_id",
  );
});

test("missing and extra input fields are explicitly rejected", () => {
  const { timeZone: _omitted, ...missing } = input(21);
  assert.throws(() => planWebinarRecruitment(catalog, missing), RecruitmentPlanningValidationError);
  assert.throws(
    () => planWebinarRecruitment(catalog, { ...input(21), extra: true }),
    RecruitmentPlanningValidationError,
  );
});

test("unsupported event status and standard mismatch are explicitly rejected", () => {
  assert.throws(
    () => planWebinarRecruitment(catalog, { ...input(21), eventStatus: "paused" }),
    RecruitmentPlanningValidationError,
  );
  assert.throws(
    () => planWebinarRecruitment(catalog, { ...input(21), standardVersion: "other" }),
    RecruitmentPlanningValidationError,
  );
});

test("input remains mutable while every owned output level is frozen", () => {
  const value = input(21);
  const plan = planWebinarRecruitment(catalog, value);
  assert.equal(Object.isFrozen(value), false);
  assert.equal(Object.isFrozen(value.touches), false);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.authority), true);
  assert.equal(Object.isFrozen(plan.touches), true);
  assert.ok(plan.touches.every((touch) => Object.isFrozen(touch)
    && Object.isFrozen(touch.warnings)
    && Object.isFrozen(touch.ruleIds)
    && Object.isFrozen(touch.timeAdjustment)));
});

test("caller touch ordering does not affect deterministic output ordering", () => {
  const value = input(20);
  const reversed = { ...value, touches: [...value.touches].reverse() };
  assert.deepEqual(
    planWebinarRecruitment(catalog, reversed),
    planWebinarRecruitment(catalog, value),
  );
});

test("scheduled output is chronological, unique, and strictly before event start", () => {
  const plan = planWebinarRecruitment(catalog, input(30));
  const instants = active(plan).map((touch) => touch.scheduledAtEpochMs!);
  assert.deepEqual(instants, [...instants].sort((left, right) => left - right));
  assert.equal(new Set(instants).size, instants.length);
  assert.ok(instants.every((value) => value >= plan.calculationInstantEpochMs));
  assert.ok(instants.every((value) => value < plan.webinarStartEpochMs));
});

test("plan expressly grants no send, readiness, exception, or suppression authority", () => {
  const plan = planWebinarRecruitment(catalog, input(21));
  assert.equal(plan.planningOnly, true);
  assert.equal(plan.sendAuthorized, false);
  assert.deepEqual(plan.authority, {
    readinessOverride: false,
    exceptionOverride: false,
    suppressionOverride: false,
  });
});