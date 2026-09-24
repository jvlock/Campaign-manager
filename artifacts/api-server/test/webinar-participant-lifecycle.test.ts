import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSyntheticTransition, decideSyntheticSuppression } from "../src/lib/webinar-participant-lifecycle";
import type { WebinarAudiencePlan } from "../src/lib/webinar-standard-audience";

test("registration, waitlist promotion, cancellation and explicit re-registration stay separate", () => {
  assert.equal(checkSyntheticTransition("register", "open_for_registration", "not_registered", "unknown"), "registered");
  assert.equal(checkSyntheticTransition("waitlist", "open_for_registration", "not_registered", "unknown"), "waitlisted");
  assert.equal(checkSyntheticTransition("promote", "scheduled", "waitlisted", "unknown"), "registered");
  assert.equal(checkSyntheticTransition("cancel-registration", "scheduled", "registered", "unknown"), "cancelled");
  assert.equal(checkSyntheticTransition("register", "scheduled", "cancelled", "unknown"), "registered");
  assert.throws(() => checkSyntheticTransition("register", "scheduled", "waitlisted", "unknown"));
  assert.throws(() => checkSyntheticTransition("promote", "completed", "waitlisted", "unknown"));
  assert.throws(() => checkSyntheticTransition("cancel-registration", "completed", "registered", "attended"));
});

test("event cancellation is not participant cancellation or absence", () => {
  assert.equal(checkSyntheticTransition("cancel-occurrence", "scheduled", "registered", "unknown"), null);
  assert.throws(() => checkSyntheticTransition("record-attendance", "cancelled", "registered", "unknown"));
  assert.throws(() => checkSyntheticTransition("waitlist", "cancelled", "not_registered", "unknown"));
  assert.throws(() => checkSyntheticTransition("record-attendance", "completed", "waitlisted", "unknown"));
  assert.equal(checkSyntheticTransition("record-attendance", "completed", "registered", "unknown"), null);
});

test("all synthetic decisions remain fail-closed before any provider handoff", () => {
  const plan = { eventId: "occurrence", participants: [{
    participantId: "participant", state: "registered", recruitmentEligible: false,
    suppressions: ["registration_suppresses_recruitment"], obligations: [{
      communicationId: "reminder", disposition: "required",
    }],
  }] } as unknown as WebinarAudiencePlan;
  const recruitment = decideSyntheticSuppression(plan, "participant", "recruitment:occurrence:participant:recruitment_1", "2026-01-01T00:00:00.000Z", "digest");
  assert.equal(recruitment.allowed, false);
  assert.equal(recruitment.reasonCode, "registration_suppresses_recruitment");
  assert.equal(decideSyntheticSuppression(plan, "participant", "reminder", "2026-01-01T00:00:00.000Z", "digest").reasonCode,
    "governed_exclusion_observation_unavailable");
  assert.equal(decideSyntheticSuppression(plan, "elsewhere", "reminder", "2026-01-01T00:00:00.000Z", "digest").reasonCode,
    "occurrence_mismatch");
});

test("every transition denies prohibited registration, attendance and occurrence states", () => {
  const statuses = ["draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled"] as const;
  const registrations = ["not_registered", "registered", "waitlisted", "cancelled"] as const;
  const attendance = ["unknown", "attended", "absent"] as const;
  const permitted: Record<string, (s: typeof statuses[number], r: typeof registrations[number],
    a: typeof attendance[number]) => boolean> = {
    register: (s, r) => ["open_for_registration", "scheduled"].includes(s) && ["not_registered", "cancelled"].includes(r),
    waitlist: (s, r) => ["open_for_registration", "scheduled"].includes(s) && r === "not_registered",
    promote: (s, r) => ["open_for_registration", "scheduled"].includes(s) && r === "waitlisted",
    "cancel-registration": (s, r, a) => ["open_for_registration", "scheduled"].includes(s)
      && r === "registered" && a === "unknown",
    "record-attendance": (s, r) => s === "completed" && r === "registered",
    "reconcile-attendance": (s, r) => s === "completed" && r === "registered",
    "seed-executed-history": (s, r) => s !== "cancelled" && r === "registered",
    reschedule: s => ["draft", "open_for_registration", "scheduled"].includes(s),
    "complete-occurrence": s => ["scheduled", "in_progress"].includes(s),
    "cancel-occurrence": s => s !== "completed" && s !== "cancelled",
  };
  for (const [action, allowed] of Object.entries(permitted)) {
    for (const s of statuses) for (const r of registrations) for (const a of attendance) {
      if (allowed(s, r, a)) assert.doesNotThrow(() =>
        checkSyntheticTransition(action as Parameters<typeof checkSyntheticTransition>[0], s, r, a),
      `${action}:${s}:${r}:${a}`);
      else assert.throws(() =>
        checkSyntheticTransition(action as Parameters<typeof checkSyntheticTransition>[0], s, r, a),
      `${action}:${s}:${r}:${a}`);
    }
  }
});