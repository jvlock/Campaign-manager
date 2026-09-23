import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addBusinessDays,
  BUSINESS_DAY_CONVENTION,
} from "../../src/lib/webinar-standard-planning-time";

test("Friday plus one business day is Monday", () => {
  const result = addBusinessDays(Date.parse("2025-01-03T14:00:00Z"), "America/New_York", 1);
  assert.equal(result.localDate, "2025-01-06");
  assert.equal(result.localTime, "09:00:00");
});

test("Saturday plus one business day is Monday", () => {
  const result = addBusinessDays(Date.parse("2025-01-04T14:00:00Z"), "America/New_York", 1);
  assert.equal(result.localDate, "2025-01-06");
  assert.equal(result.localTime, "09:00:00");
});

test("Sunday plus one business day is Monday", () => {
  const result = addBusinessDays(Date.parse("2025-01-05T14:00:00Z"), "America/New_York", 1);
  assert.equal(result.localDate, "2025-01-06");
  assert.equal(result.localTime, "09:00:00");
});

test("zero business days preserves a weekend instant", () => {
  const epochMs = Date.parse("2025-01-04T14:00:00Z");
  assert.equal(addBusinessDays(epochMs, "America/New_York", 0).epochMs, epochMs);
});

test("two business days cross a weekend without treating a date as a holiday", () => {
  const result = addBusinessDays(Date.parse("2025-07-03T13:00:00Z"), "America/New_York", 2);
  assert.equal(result.localDate, "2025-07-07");
  assert.equal(result.localTime, "09:00:00");
});

test("business-day convention explicitly has no holiday calendar", () => {
  assert.equal(BUSINESS_DAY_CONVENTION.noHolidayCalendar, true);
  assert.deepEqual(BUSINESS_DAY_CONVENTION.weekdays, [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
  ]);
});

test("spring deadline golden instant preserves wall clock across DST", () => {
  const result = addBusinessDays(Date.parse("2025-03-07T14:00:00Z"), "America/New_York", 1);
  assert.equal(result.epochMs, Date.parse("2025-03-10T13:00:00Z"));
  assert.equal(result.localTime, "09:00:00");
});

test("fall deadline golden instant preserves wall clock across DST", () => {
  const result = addBusinessDays(Date.parse("2025-10-31T13:00:00Z"), "America/New_York", 1);
  assert.equal(result.epochMs, Date.parse("2025-11-03T14:00:00Z"));
  assert.equal(result.localTime, "09:00:00");
});

test("two-business-day attendance deadline has an exact golden instant", () => {
  const result = addBusinessDays(Date.parse("2025-03-07T22:15:00Z"), "America/New_York", 2);
  assert.equal(result.epochMs, Date.parse("2025-03-11T21:15:00Z"));
  assert.equal(result.localDate, "2025-03-11");
  assert.equal(result.localTime, "17:15:00");
});