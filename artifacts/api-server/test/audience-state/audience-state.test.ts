import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/loader";
import {
  planWebinarAudience, type AudienceParticipantInput, type WebinarAudienceInput,
} from "../../src/lib/webinar-standard-audience/index";

const catalog = await loadWebinarStandardCatalog();
const hour = 3_600_000;
const start = Date.parse("2030-01-10T12:00:00Z");
const calculation = Date.parse("2030-01-08T10:00:00Z");
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[]
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

function participant(overrides: Partial<AudienceParticipantInput> = {}): AudienceParticipantInput {
  return {
    participantId: "p-1", eventId: "event-1", registrationStatus: "registered",
    attendanceState: "unknown", audienceClass: "customer", recruitmentEligible: true,
    contactable: true, optedOut: false, invalidAddress: false, governedExclusion: false,
    registrationAtEpochMs: calculation - hour, attendanceAvailableAtEpochMs: null,
    waitlistedAtEpochMs: null, waitlistPromotionTriggeredAtEpochMs: null,
    waitlistClosureTriggeredAtEpochMs: null, participantCancellationTriggeredAtEpochMs: null,
    neutralVariantApproved: false, qaTestSendRequested: false, followUpAssetId: null,
    ...overrides,
  };
}

function input(
  participantOverrides: Partial<AudienceParticipantInput> = {},
  rootOverrides: Partial<WebinarAudienceInput> = {},
): Mutable<WebinarAudienceInput> {
  const observed = rootOverrides.calculationInstantEpochMs ?? calculation;
  return {
    calculationInstantEpochMs: observed, timeZone: "America/New_York",
    standardId: "WEB-STANDARD-001", standardVersion: "1.0-pilot-rc1",
    event: {
      eventId: "event-1", operationalStatus: "scheduled", startsAtEpochMs: start,
      endsAtEpochMs: start + hour, actualEndsAtEpochMs: null, observedAtEpochMs: observed,
      materialChangeTriggeredAtEpochMs: null, cancellationTriggeredAtEpochMs: null,
    },
    recruitmentTouches: [
      { identity: "recruitment_1", communicationId: "rec-1" },
      { identity: "recruitment_2", communicationId: "rec-2" },
      { identity: "recruitment_3", communicationId: "rec-3" },
      { identity: "final_recruitment", communicationId: "rec-4" },
    ],
    participants: [participant(participantOverrides)],
    ...rootOverrides,
  } as Mutable<WebinarAudienceInput>;
}

function kinds(plan: ReturnType<typeof planWebinarAudience>, disposition?: string): string[] {
  return plan.participants[0]!.obligations
    .filter((entry) => disposition === undefined || entry.disposition === disposition)
    .map((entry) => entry.kind);
}

test("registration suppresses recruitment", () => {
  const result = planWebinarAudience(catalog, input());
  assert.equal(result.participants[0]!.recruitmentPlan, null);
  assert.ok(result.participants[0]!.suppressions.includes("registration_suppresses_recruitment"));
});

test("registration confirmation is due at the exact registration instant", () => {
  const source = input();
  const result = planWebinarAudience(catalog, source);
  const confirmation = result.participants[0]!.obligations.find((item) => item.kind === "registration_confirmation")!;
  assert.equal(confirmation.dueAtEpochMs, source.participants[0]!.registrationAtEpochMs);
  assert.equal(confirmation.overdue, true);
});

test("calendar information is immediate with registration", () => {
  const source = input();
  const calendar = planWebinarAudience(catalog, source).participants[0]!.obligations
    .find((item) => item.kind === "calendar_information")!;
  assert.equal(calendar.dueAtEpochMs, source.participants[0]!.registrationAtEpochMs);
});

test("future 24-hour reminder is retained", () => {
  const source = input({}, { calculationInstantEpochMs: start - 25 * hour });
  source.event.observedAtEpochMs = start - 25 * hour;
  const reminder = planWebinarAudience(catalog, source).participants[0]!.obligations
    .find((item) => item.kind === "reminder_24_hour")!;
  assert.equal(reminder.disposition, "required");
  assert.equal(reminder.dueAtEpochMs, start - 24 * hour);
});

test("future 1-hour reminder is retained", () => {
  const reminder = planWebinarAudience(catalog, input()).participants[0]!.obligations
    .find((item) => item.kind === "reminder_1_hour")!;
  assert.equal(reminder.disposition, "required");
  assert.equal(reminder.dueAtEpochMs, start - hour);
});

test("registration after nominal 24-hour reminder explicitly omits it", () => {
  const source = input({ registrationAtEpochMs: start - 20 * hour }, { calculationInstantEpochMs: start - 19 * hour });
  source.event.observedAtEpochMs = start - 19 * hour;
  const reminder = planWebinarAudience(catalog, source).participants[0]!.obligations
    .find((item) => item.kind === "reminder_24_hour")!;
  assert.equal(reminder.disposition, "omitted");
  assert.equal(reminder.dueAtEpochMs, null);
});

test("late registration explicitly omits both reminders without backdating", () => {
  const source = input({ registrationAtEpochMs: start - 30 * 60_000 }, { calculationInstantEpochMs: start - 20 * 60_000 });
  source.event.observedAtEpochMs = start - 20 * 60_000;
  const reminders = planWebinarAudience(catalog, source).participants[0]!.obligations
    .filter((item) => item.kind.startsWith("reminder_"));
  assert.deepEqual(reminders.map((item) => item.disposition), ["omitted", "omitted"]);
  assert.ok(reminders.every((item) => item.dueAtEpochMs === null));
});

test("material event change creates a notice only when triggered", () => {
  const changed = input();
  changed.event.materialChangeTriggeredAtEpochMs = calculation - 1;
  assert.ok(kinds(planWebinarAudience(catalog, changed)).includes("event_change_notice"));
  assert.ok(!kinds(planWebinarAudience(catalog, input())).includes("event_change_notice"));
});

test("material change before registration does not create a change notice", () => {
  const source = input({ registrationAtEpochMs: calculation - 1 });
  source.event.materialChangeTriggeredAtEpochMs = calculation - hour;
  assert.ok(!kinds(planWebinarAudience(catalog, source)).includes("event_change_notice"));
});

test("material change at the registration instant creates a change notice", () => {
  const trigger = calculation - hour;
  const source = input({ registrationAtEpochMs: trigger });
  source.event.materialChangeTriggeredAtEpochMs = trigger;
  assert.ok(kinds(planWebinarAudience(catalog, source)).includes("event_change_notice"));
});

test("material change after registration creates a change notice", () => {
  const source = input({ registrationAtEpochMs: calculation - hour });
  source.event.materialChangeTriggeredAtEpochMs = calculation - 1;
  assert.ok(kinds(planWebinarAudience(catalog, source)).includes("event_change_notice"));
});

test("event cancellation creates notice and suppresses reminders and follow-up", () => {
  const cancelled = input({}, {
    event: {
      eventId: "event-1", operationalStatus: "cancelled", startsAtEpochMs: start,
      endsAtEpochMs: start + hour, actualEndsAtEpochMs: null, observedAtEpochMs: calculation,
      materialChangeTriggeredAtEpochMs: null, cancellationTriggeredAtEpochMs: calculation - 1,
    },
  });
  const result = planWebinarAudience(catalog, cancelled);
  assert.ok(kinds(result, "required").includes("event_cancellation_notice"));
  assert.ok(result.participants[0]!.obligations
    .filter((item) => item.kind.startsWith("reminder_")).every((item) => item.disposition === "omitted"));
});

test("cancelled participant receives cancellation confirmation and no later customer path", () => {
  const result = planWebinarAudience(catalog, input({
    registrationStatus: "cancelled", registrationAtEpochMs: calculation - hour,
    participantCancellationTriggeredAtEpochMs: calculation - 1,
  }));
  assert.deepEqual(kinds(result), ["participant_cancellation_confirmation"]);
  assert.ok(result.participants[0]!.suppressions.includes("all_future_customer_paths"));
});

test("internal participant is excluded from customer communication and reporting", () => {
  const result = planWebinarAudience(catalog, input({ audienceClass: "internal" }));
  assert.equal(result.participants[0]!.state, "internal_or_test");
  assert.equal(result.participants[0]!.customerReportingIncluded, false);
  assert.deepEqual(result.participants[0]!.obligations, []);
});

test("explicitly labelled QA planning is optional and never a customer path", () => {
  const qa = planWebinarAudience(catalog, input({ audienceClass: "test", qaTestSendRequested: true }))
    .participants[0]!.obligations[0]!;
  assert.equal(qa.kind, "qa_test_send");
  assert.equal(qa.disposition, "eligible");
  assert.equal(qa.customerPath, false);
  assert.equal(qa.variant, "qa_test");
});

test("eligible non-registrant alone receives a recruitment plan", () => {
  const result = planWebinarAudience(catalog, input({
    registrationStatus: "not_registered", registrationAtEpochMs: null,
  }));
  assert.equal(result.participants[0]!.state, "eligible_non_registrant");
  assert.equal(result.participants[0]!.recruitmentPlan?.planningOnly, true);
  assert.deepEqual(result.participants[0]!.obligations, []);
});

test("ineligible non-registrant is suppressed without calling through to a schedule", () => {
  const result = planWebinarAudience(catalog, input({
    registrationStatus: "not_registered", registrationAtEpochMs: null, optedOut: true,
  }));
  assert.equal(result.participants[0]!.recruitmentPlan, null);
  assert.ok(result.participants[0]!.suppressions.includes("opted_out"));
});

test("cancelled event closes a waitlist at the event cancellation trigger", () => {
  const source = input({
    registrationStatus: "waitlisted", registrationAtEpochMs: null,
    waitlistedAtEpochMs: calculation - hour,
  }, {
    event: {
      eventId: "event-1", operationalStatus: "cancelled", startsAtEpochMs: start,
      endsAtEpochMs: start + hour, actualEndsAtEpochMs: null, observedAtEpochMs: calculation,
      materialChangeTriggeredAtEpochMs: null, cancellationTriggeredAtEpochMs: calculation - 1,
    },
  });
  const participantPlan = planWebinarAudience(catalog, source).participants[0]!;
  const closure = participantPlan.obligations.find((item) => item.kind === "waitlist_closure")!;
  assert.equal(closure.dueAtEpochMs, calculation - 1);
  assert.ok(participantPlan.suppressions.includes("all_future_customer_paths"));
});

test("explicit waitlist closure trigger takes precedence on a cancelled event", () => {
  const explicitClosure = calculation - 10;
  const source = input({
    registrationStatus: "waitlisted", registrationAtEpochMs: null,
    waitlistedAtEpochMs: calculation - hour, waitlistClosureTriggeredAtEpochMs: explicitClosure,
  }, {
    event: {
      eventId: "event-1", operationalStatus: "cancelled", startsAtEpochMs: start,
      endsAtEpochMs: start + hour, actualEndsAtEpochMs: null, observedAtEpochMs: calculation,
      materialChangeTriggeredAtEpochMs: null, cancellationTriggeredAtEpochMs: calculation - 1,
    },
  });
  const closure = planWebinarAudience(catalog, source).participants[0]!.obligations
    .find((item) => item.kind === "waitlist_closure")!;
  assert.equal(closure.dueAtEpochMs, explicitClosure);
});

test("obligation timing kind distinguishes deadlines, eligibility, and omissions", () => {
  const source = input({}, { calculationInstantEpochMs: start - 30 * 60_000 });
  source.event.observedAtEpochMs = source.calculationInstantEpochMs;
  source.participants[0]!.registrationAtEpochMs = start - 40 * 60_000;
  const obligations = planWebinarAudience(catalog, source).participants[0]!.obligations;
  assert.equal(obligations.find((item) => item.kind === "registration_confirmation")!.timingKind, "deadline");
  assert.equal(obligations.find((item) => item.kind === "reminder_1_hour")!.timingKind, "none");

  const qa = planWebinarAudience(catalog, input({ audienceClass: "test", qaTestSendRequested: true }))
    .participants[0]!.obligations[0]!;
  assert.equal(qa.timingKind, "eligibility");
});