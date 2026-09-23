import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarDaysBetween,
  localTime,
  shiftCalendarDays,
} from "../../src/lib/webinar-standard-planning-time";

test("DST gap moves a nonexistent local wall clock forward by the gap", () => {
  const shifted = shiftCalendarDays(Date.parse("2025-03-08T07:30:00Z"), "America/New_York", 1);
  assert.deepEqual(shifted, {
    epochMs: Date.parse("2025-03-09T07:30:00Z"),
    localDate: "2025-03-09",
    localTime: "03:30:00",
    offset: "-04:00",
    disambiguation: "gap_forward",
    requestedLocalDateTime: "2025-03-09T02:30:00",
  });
});

test("DST overlap chooses the earlier occurrence of a repeated local wall clock", () => {
  const shifted = shiftCalendarDays(Date.parse("2025-11-01T05:30:00Z"), "America/New_York", 1);
  assert.deepEqual(shifted, {
    epochMs: Date.parse("2025-11-02T05:30:00Z"),
    localDate: "2025-11-02",
    localTime: "01:30:00",
    offset: "-04:00",
    disambiguation: "overlap_earlier",
    requestedLocalDateTime: "2025-11-02T01:30:00",
  });
});

test("non-DST zone preserves local wall-clock time without disambiguation", () => {
  const shifted = shiftCalendarDays(Date.parse("2025-03-08T03:30:00Z"), "Asia/Kolkata", 1);
  assert.equal(shifted.epochMs, Date.parse("2025-03-09T03:30:00Z"));
  assert.equal(shifted.localTime, "09:00:00");
  assert.equal(shifted.offset, "+05:30");
  assert.equal(shifted.disambiguation, "none");
});

test("spring calendar day can span 23 elapsed hours", () => {
  const start = Date.parse("2025-03-08T17:00:00Z");
  const shifted = shiftCalendarDays(start, "America/New_York", 1);
  assert.equal(shifted.epochMs - start, 23 * 60 * 60 * 1_000);
  assert.equal(calendarDaysBetween(start, shifted.epochMs, "America/New_York"), 1);
});

test("fall calendar day can span 25 elapsed hours", () => {
  const start = Date.parse("2025-11-01T16:00:00Z");
  const shifted = shiftCalendarDays(start, "America/New_York", 1);
  assert.equal(shifted.epochMs - start, 25 * 60 * 60 * 1_000);
  assert.equal(calendarDaysBetween(start, shifted.epochMs, "America/New_York"), 1);
});

test("local time reports event-zone date, wall clock, and offset", () => {
  assert.deepEqual(localTime(Date.parse("2025-07-01T13:15:30.125Z"), "America/New_York"), {
    date: "2025-07-01",
    time: "09:15:30.125",
    offset: "-04:00",
  });
});

test("calendar-day difference is signed and based on local dates", () => {
  const earlier = Date.parse("2025-01-02T04:30:00Z");
  const later = Date.parse("2025-01-02T05:30:00Z");
  assert.equal(calendarDaysBetween(earlier, later, "America/New_York"), 1);
  assert.equal(calendarDaysBetween(later, earlier, "America/New_York"), -1);
});