import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addBusinessDays,
  assertInstant,
  assertTimeZone,
  BUSINESS_DAY_CONVENTION,
  localTime,
  shiftCalendarDays,
} from "../../src/lib/webinar-standard-planning-time";

test("invalid IANA time zone is rejected", () => {
  assert.throws(() => assertTimeZone("Not/A_Zone"), /Invalid IANA time zone/);
});

test("UTC is accepted as a named time zone", () => {
  assert.equal(assertTimeZone("UTC"), "UTC");
});

test("bare numeric time-zone offset is rejected", () => {
  assert.throws(() => assertTimeZone("+05:30"), /not a bare offset/);
});

test("non-finite instant is rejected", () => {
  assert.throws(() => assertInstant(Number.POSITIVE_INFINITY, "start"), /finite safe-integer/);
});

test("fractional epoch-millisecond instant is rejected", () => {
  assert.throws(() => assertInstant(1.5, "start"), /finite safe-integer/);
});

test("instant outside the Temporal range is rejected", () => {
  assert.throws(() => assertInstant(Number.MAX_SAFE_INTEGER, "start"), /Temporal instant range/);
});

test("fractional calendar-day offset is rejected", () => {
  assert.throws(
    () => shiftCalendarDays(Date.parse("2025-01-01T00:00:00Z"), "UTC", 1.5),
    /safe integer/,
  );
});

test("negative business-day offset is rejected", () => {
  assert.throws(
    () => addBusinessDays(Date.parse("2025-01-01T00:00:00Z"), "UTC", -1),
    /nonnegative integer/,
  );
});

test("fractional business-day offset is rejected", () => {
  assert.throws(
    () => addBusinessDays(Date.parse("2025-01-01T00:00:00Z"), "UTC", 1.5),
    /nonnegative integer/,
  );
});

test("business-day offset over the documented bound is rejected", () => {
  assert.throws(
    () => addBusinessDays(
      Date.parse("2025-01-01T00:00:00Z"),
      "UTC",
      BUSINESS_DAY_CONVENTION.maximumBusinessDays + 1,
    ),
    /no greater than/,
  );
});

test("local-time output is immutable", () => {
  assert.equal(Object.isFrozen(localTime(0, "UTC")), true);
});

test("calendar-shift output is immutable", () => {
  assert.equal(Object.isFrozen(shiftCalendarDays(0, "UTC", 1)), true);
});

test("business-day convention and nested metadata are immutable", () => {
  assert.equal(Object.isFrozen(BUSINESS_DAY_CONVENTION), true);
  assert.equal(Object.isFrozen(BUSINESS_DAY_CONVENTION.weekdays), true);
  assert.equal(Object.isFrozen(BUSINESS_DAY_CONVENTION.isoWeekdays), true);
});