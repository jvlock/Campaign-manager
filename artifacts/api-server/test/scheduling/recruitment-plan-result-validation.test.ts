import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Temporal } from "@js-temporal/polyfill";
import { validateWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/index";
import {
  planWebinarRecruitment,
  validateRecruitmentPlanResult,
  type RecruitmentPlan,
  type RecruitmentPlanningInput,
} from "../../src/lib/webinar-standard-scheduling/index";

const catalogPath = fileURLToPath(
  new URL("../../../../docs/standards/webinar/WEB-STANDARD-001.rules.json", import.meta.url),
);
const parsedCatalog: unknown = JSON.parse(await readFile(catalogPath, "utf8"));
const checkedCatalog = validateWebinarStandardCatalog(parsedCatalog);
assert.equal(checkedCatalog.ok, true);
if (!checkedCatalog.ok) throw new Error("Canonical catalog fixture did not validate.");
const catalog = checkedCatalog.catalog;
const ids = ["recruitment_1", "recruitment_2", "recruitment_3", "final_recruitment"] as const;
const instant = (value: string) => Number(Temporal.Instant.from(value).epochMilliseconds);

function makeInput(
  calculationInstantEpochMs = instant("2025-06-01T12:00:00Z"),
  webinarStartEpochMs = instant("2025-06-30T12:00:00Z"),
  overrides: Partial<RecruitmentPlanningInput> = {},
): RecruitmentPlanningInput {
  return {
    calculationInstantEpochMs,
    webinarStartEpochMs,
    timeZone: "UTC",
    eventStatus: "scheduled",
    standardId: catalog.standardId,
    standardVersion: catalog.standardVersion,
    touches: ids.map((identity) => ({ identity, communicationId: `comm-${identity}` })),
    ...overrides,
  };
}

function expected(input: RecruitmentPlanningInput) {
  return {
    standardId: input.standardId,
    standardVersion: input.standardVersion,
    calculationInstantEpochMs: input.calculationInstantEpochMs,
    webinarStartEpochMs: input.webinarStartEpochMs,
    timeZone: input.timeZone,
    eventStatus: input.eventStatus,
  };
}

function mutable(plan: RecruitmentPlan): RecruitmentPlan {
  return structuredClone(plan);
}

for (const [name, input] of [
  ["full band", makeInput()],
  ["14-to-20 band", makeInput(instant("2025-06-15T12:00:00Z"))],
  ["7-to-13 band", makeInput(instant("2025-06-20T12:00:00Z"))],
  ["2-to-6 band", makeInput(instant("2025-06-26T12:00:00Z"))],
  ["0-to-1 band", makeInput(instant("2025-06-29T12:00:00Z"))],
  ["inactive event", makeInput(undefined, undefined, { eventStatus: "completed" })],
  ["DST gap output", makeInput(instant("2024-03-01T00:00:00Z"), instant("2024-04-21T00:30:00Z"), {
    timeZone: "Europe/Paris",
  })],
] as const) {
  test(`validator accepts real planner ${name} output`, () => {
    const plan = planWebinarRecruitment(catalog, input);
    assert.equal(validateRecruitmentPlanResult(plan, expected(input)), null);
  });
}

test("validator rejects instant changed without matching local metadata", () => {
  const input = makeInput();
  const plan = mutable(planWebinarRecruitment(catalog, input));
  const touch = plan.touches[0] as { scheduledAtEpochMs: number };
  touch.scheduledAtEpochMs += 1;
  assert.notEqual(validateRecruitmentPlanResult(plan, expected(input)), null);
});

test("validator rejects forged full-window adjusted immediate touch", () => {
  const input = makeInput();
  const plan = mutable(planWebinarRecruitment(catalog, input));
  const touch = plan.touches[0] as {
    disposition: string; reason: string; scheduledAtEpochMs: number;
    eventLocalDate: string; eventLocalTime: string; eventLocalOffset: string;
    timeAdjustment: { requestedLocalDateTime: string | null };
  };
  touch.disposition = "adjusted";
  touch.reason = "shortened_window_immediate";
  touch.scheduledAtEpochMs = input.calculationInstantEpochMs;
  touch.eventLocalDate = "2025-06-01";
  touch.eventLocalTime = "12:00:00";
  touch.eventLocalOffset = "+00:00";
  touch.timeAdjustment.requestedLocalDateTime = null;
  assert.notEqual(validateRecruitmentPlanResult(plan, expected(input)), null);
});

test("validator rejects full-window retained touch forged as shortened-window omission", () => {
  const input = makeInput();
  const plan = mutable(planWebinarRecruitment(catalog, input));
  const touch = plan.touches.find(({ identity }) => identity === "final_recruitment") as unknown as {
    disposition: string;
    scheduledAtEpochMs: number | null;
    eventLocalDate: string | null;
    eventLocalTime: string | null;
    eventLocalOffset: string | null;
    reason: string;
    ruleIds: string[];
    timeAdjustment: { disambiguation: string; requestedLocalDateTime: string | null };
  };
  touch.disposition = "omitted";
  touch.scheduledAtEpochMs = null;
  touch.eventLocalDate = null;
  touch.eventLocalTime = null;
  touch.eventLocalOffset = null;
  touch.reason = "shortened_window_omission";
  touch.ruleIds = ["WEB-REC-004", "WEB-WIN-001", "WEB-WIN-007", "WEB-REC-011"];
  touch.timeAdjustment = { disambiguation: "none", requestedLocalDateTime: null };
  assert.notEqual(validateRecruitmentPlanResult(plan, expected(input)), null);
});

test("validator rejects arbitrary reason and skipped adjustment warning", () => {
  const input = makeInput(instant("2024-03-01T00:00:00Z"), instant("2024-04-21T00:30:00Z"), {
    timeZone: "Europe/Paris",
  });
  const plan = mutable(planWebinarRecruitment(catalog, input));
  (plan.touches[0] as { reason: string }).reason = "anything";
  assert.notEqual(validateRecruitmentPlanResult(plan, expected(input)), null);
  const warningPlan = mutable(planWebinarRecruitment(catalog, input));
  (warningPlan.touches[0] as unknown as { warnings: string[] }).warnings = [];
  assert.notEqual(validateRecruitmentPlanResult(warningPlan, expected(input)), null);
});

test("validator rejects a non-date-time requested adjustment value", () => {
  const input = makeInput();
  const plan = mutable(planWebinarRecruitment(catalog, input));
  (plan.touches[0] as {
    timeAdjustment: { requestedLocalDateTime: string | null };
  }).timeAdjustment.requestedLocalDateTime = "arbitrary text";
  assert.notEqual(validateRecruitmentPlanResult(plan, expected(input)), null);
});

test("validator rejects invalid zones, authority flags, extras, duplicates, and malformed unknown", () => {
  const input = makeInput();
  const base = planWebinarRecruitment(catalog, input);
  const invalidZone = { ...mutable(base), timeZone: "Not/A_Zone" };
  assert.notEqual(validateRecruitmentPlanResult(invalidZone, { ...expected(input), timeZone: "Not/A_Zone" }), null);
  const authority = mutable(base);
  (authority.authority as { readinessOverride: boolean }).readinessOverride = true;
  assert.notEqual(validateRecruitmentPlanResult(authority, expected(input)), null);
  assert.notEqual(validateRecruitmentPlanResult({ ...base, execute: true }, expected(input)), null);
  const duplicate = mutable(base);
  (duplicate.touches[1] as { identity: string }).identity = duplicate.touches[0]!.identity;
  assert.notEqual(validateRecruitmentPlanResult(duplicate, expected(input)), null);
  assert.notEqual(validateRecruitmentPlanResult(null, expected(input)), null);
  assert.notEqual(validateRecruitmentPlanResult({ touches: "wrong" }, expected(input)), null);
});