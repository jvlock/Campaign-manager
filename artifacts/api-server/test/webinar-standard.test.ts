import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateStandardSchedule,
  contentValidation,
} from "../src/lib/webinar-standard";
import { DEFAULT_WEBINAR_STANDARD_LIMITS } from "@workspace/db";

const session = (sessionDate: string, startTime: string, timezone: string) => ({
  sessionDate,
  startTime,
  timezone,
  recruitmentLaunchAt: null,
});

test("calendar recruitment reminders roll backward to Friday", () => {
  const schedule = calculateStandardSchedule(session("2026-11-15", "14:00", "America/New_York"), "final_recruitment");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(schedule.effective).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  assert.equal(`${parts.year}-${parts.month}-${parts.day}`, "2026-11-13");
});

test("five-message invites use 14 and 7 calendar days with weekend rollback", () => {
  const schedule = calculateStandardSchedule(
    session("2026-11-15", "14:00", "America/New_York"),
    "recruitment_1",
    "default_5",
  );
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(schedule.effective).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  assert.equal(`${parts.year}-${parts.month}-${parts.day}`, "2026-10-30");
  assert.equal(schedule.effective.toISOString(), "2026-10-30T18:00:00.000Z");
});

test("five-message attendee thank-you rolls one calendar day forward", () => {
  const schedule = calculateStandardSchedule(
    session("2026-11-14", "14:00", "America/New_York"),
    "attendee_followup",
    "default_5",
  );
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(schedule.effective).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  assert.equal(`${parts.year}-${parts.month}-${parts.day}`, "2026-11-16");
});

test("elapsed-hour reminders subtract elapsed time through DST", () => {
  const schedule = calculateStandardSchedule(session("2026-11-02", "01:30", "America/New_York"), "final_reminder");
  assert.equal(schedule.effective.toISOString(), "2026-11-02T05:30:00.000Z");
});

test("draft content can exceed limits but active validation reports it", () => {
  const content = {
    subject: "x".repeat(DEFAULT_WEBINAR_STANDARD_LIMITS.subject + 1),
    preheader: "",
    hero: "",
    body: "",
    ctaLabel: "",
    ctaUrl: "",
    internalAssetName: "",
  };
  const validation = contentValidation(content, DEFAULT_WEBINAR_STANDARD_LIMITS, false);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.field === "subject"));
  assert.equal(content.subject.length, DEFAULT_WEBINAR_STANDARD_LIMITS.subject + 1);
});