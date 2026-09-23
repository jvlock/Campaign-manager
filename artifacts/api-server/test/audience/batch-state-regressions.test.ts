import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/loader";
import {
  planWebinarAudience, type AudienceParticipantInput, type WebinarAudienceInput,
} from "../../src/lib/webinar-standard-audience/index";

const catalog = await loadWebinarStandardCatalog();
const hour = 3_600_000;
const day = 86_400_000;
const actualEnd = Date.parse("2030-01-04T18:00:00Z"); // Friday, 13:00 America/New_York
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[]
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

function participant(overrides: Partial<AudienceParticipantInput> = {}): AudienceParticipantInput {
  return {
    participantId: "participant-1", eventId: "event-1", registrationStatus: "registered",
    attendanceState: "unknown", audienceClass: "customer", recruitmentEligible: true,
    contactable: true, optedOut: false, invalidAddress: false, governedExclusion: false,
    registrationAtEpochMs: actualEnd - 7 * day, attendanceAvailableAtEpochMs: null,
    waitlistedAtEpochMs: null, waitlistPromotionTriggeredAtEpochMs: null,
    waitlistClosureTriggeredAtEpochMs: null, participantCancellationTriggeredAtEpochMs: null,
    neutralVariantApproved: false, qaTestSendRequested: false, followUpAssetId: "recording-1",
    ...overrides,
  };
}

function source(
  participants: readonly AudienceParticipantInput[],
  overrides: Partial<WebinarAudienceInput> = {},
): Mutable<WebinarAudienceInput> {
  const calculation = overrides.calculationInstantEpochMs ?? actualEnd + 4 * day;
  return {
    calculationInstantEpochMs: calculation, timeZone: "America/New_York",
    standardId: "WEB-STANDARD-001", standardVersion: "1.0-pilot-rc1",
    event: {
      eventId: "event-1", operationalStatus: "completed", startsAtEpochMs: actualEnd - hour,
      endsAtEpochMs: actualEnd, actualEndsAtEpochMs: actualEnd, observedAtEpochMs: calculation,
      materialChangeTriggeredAtEpochMs: null, cancellationTriggeredAtEpochMs: null,
    },
    recruitmentTouches: [
      { identity: "recruitment_1", communicationId: "recruitment-1" },
      { identity: "recruitment_2", communicationId: "recruitment-2" },
      { identity: "recruitment_3", communicationId: "recruitment-3" },
      { identity: "final_recruitment", communicationId: "recruitment-4" },
    ],
    participants,
    ...overrides,
  } as Mutable<WebinarAudienceInput>;
}

function scheduled(
  person: AudienceParticipantInput,
  calculation = actualEnd - 2 * day,
): Mutable<WebinarAudienceInput> {
  const value = source([person], { calculationInstantEpochMs: calculation });
  value.event = {
    ...value.event, operationalStatus: "scheduled", startsAtEpochMs: actualEnd,
    endsAtEpochMs: actualEnd + hour, actualEndsAtEpochMs: null, observedAtEpochMs: calculation,
  };
  return value;
}

test("eligible non-registrant remains the recruitment audience state", () => {
  const plan = planWebinarAudience(catalog, scheduled(participant({
    registrationStatus: "not_registered", registrationAtEpochMs: null,
  })));
  assert.equal(plan.participants[0]!.state, "eligible_non_registrant");
  assert.equal(plan.participants[0]!.recruitmentPlan?.planningOnly, true);
});

test("registered remains distinct and immediately suppresses every future recruitment touch", () => {
  const plan = planWebinarAudience(catalog, scheduled(participant()));
  assert.equal(plan.participants[0]!.state, "registered");
  assert.equal(plan.participants[0]!.recruitmentPlan, null);
  assert.ok(plan.participants[0]!.suppressions.includes("registration_suppresses_recruitment"));
});

test("attended remains a per-participant completed-event audience state", () => {
  const plan = planWebinarAudience(catalog, source([participant({
    attendanceState: "attended", attendanceAvailableAtEpochMs: actualEnd + hour,
  })]));
  assert.equal(plan.participants[0]!.state, "attended");
});

test("registered but absent remains distinct from attended", () => {
  const plan = planWebinarAudience(catalog, source([participant({
    attendanceState: "absent", attendanceAvailableAtEpochMs: actualEnd + hour,
  })]));
  assert.equal(plan.participants[0]!.state, "registered_absent");
});

test("attendance unknown remains unresolved rather than inferred", () => {
  const plan = planWebinarAudience(catalog, source([participant()]));
  assert.equal(plan.participants[0]!.state, "attendance_unknown");
  assert.ok(plan.participants[0]!.obligations.some((item) => item.kind === "attendance_reconciliation"));
});

test("waitlisted remains distinct and suppresses recruitment", () => {
  const plan = planWebinarAudience(catalog, scheduled(participant({
    registrationStatus: "waitlisted", registrationAtEpochMs: null,
    waitlistedAtEpochMs: actualEnd - 3 * day,
  })));
  assert.equal(plan.participants[0]!.state, "waitlisted");
  assert.ok(plan.participants[0]!.suppressions.includes("waitlist_suppresses_recruitment"));
});

test("cancelled participant remains distinct from event cancellation", () => {
  const value = scheduled(participant({
    registrationStatus: "cancelled", participantCancellationTriggeredAtEpochMs: actualEnd - 3 * day,
  }));
  const plan = planWebinarAudience(catalog, value);
  assert.equal(value.event.operationalStatus, "scheduled");
  assert.equal(plan.participants[0]!.state, "cancelled");
  assert.deepEqual(plan.participants[0]!.obligations.map((item) => item.kind),
    ["participant_cancellation_confirmation"]);
});

test("internal or test remains non-customer audience state", () => {
  const plan = planWebinarAudience(catalog, scheduled(participant({ audienceClass: "internal" })));
  assert.equal(plan.participants[0]!.state, "internal_or_test");
  assert.equal(plan.participants[0]!.customerReportingIncluded, false);
});

test("registration creates immediate confirmation and calendar obligations", () => {
  const registration = actualEnd - 3 * day;
  const plan = planWebinarAudience(catalog, scheduled(participant({ registrationAtEpochMs: registration })));
  for (const kind of ["registration_confirmation", "calendar_information"] as const) {
    const obligation = plan.participants[0]!.obligations.find((item) => item.kind === kind)!;
    assert.equal(obligation.disposition, "required");
    assert.equal(obligation.dueAtEpochMs, registration);
  }
});

test("late registration never backdates either nominal reminder", () => {
  const calculation = actualEnd - 20 * 60_000;
  const plan = planWebinarAudience(catalog, scheduled(participant({
    registrationAtEpochMs: actualEnd - 30 * 60_000,
  }), calculation));
  const reminders = plan.participants[0]!.obligations.filter((item) => item.kind.startsWith("reminder_"));
  assert.equal(reminders.length, 2);
  assert.ok(reminders.every((item) => item.disposition === "omitted" && item.dueAtEpochMs === null));
});

test("attended deadline uses actual completion and attendance import does not reset it", () => {
  const plan = planWebinarAudience(catalog, source([participant({
    attendanceState: "attended", attendanceAvailableAtEpochMs: actualEnd + 4 * day,
  })]));
  const followUp = plan.participants[0]!.obligations.find((item) => item.kind === "attended_follow_up")!;
  assert.equal(followUp.deadlineLocal?.date, "2030-01-07");
  assert.equal(followUp.deadlineLocal?.time, "13:00:00");
  assert.ok(followUp.dueAtEpochMs! < actualEnd + 4 * day);
});

test("neutral variant is ineligible immediately before two business days", () => {
  const threshold = Date.parse("2030-01-08T18:00:00Z");
  const plan = planWebinarAudience(catalog, source([participant({
    neutralVariantApproved: true,
  })], { calculationInstantEpochMs: threshold - 1 }));
  assert.ok(!plan.participants[0]!.obligations.some((item) => item.kind === "neutral_follow_up"));
});

test("neutral variant becomes eligible at exactly two business days across a weekend", () => {
  const threshold = Date.parse("2030-01-08T18:00:00Z");
  const plan = planWebinarAudience(catalog, source([participant({
    neutralVariantApproved: true,
  })], { calculationInstantEpochMs: threshold }));
  const neutral = plan.participants[0]!.obligations.find((item) => item.kind === "neutral_follow_up")!;
  assert.equal(neutral.dueAtEpochMs, threshold);
  assert.equal(neutral.deadlineLocal?.date, "2030-01-08");
  assert.equal(neutral.deadlineLocal?.time, "13:00:00");
});

test("two-business-day neutral threshold uses the supplied event-local time zone", () => {
  const threshold = Date.parse("2030-01-08T18:00:00Z");
  const value = source([participant({ neutralVariantApproved: true })], {
    calculationInstantEpochMs: threshold, timeZone: "America/Los_Angeles",
  });
  value.event.observedAtEpochMs = threshold;
  const neutral = planWebinarAudience(catalog, value).participants[0]!.obligations
    .find((item) => item.kind === "neutral_follow_up")!;
  assert.equal(neutral.deadlineLocal?.date, "2030-01-08");
  assert.equal(neutral.deadlineLocal?.time, "10:00:00");
});

test("unknown attendance never produces both attended and absent variants", () => {
  const plan = planWebinarAudience(catalog, source([participant({ neutralVariantApproved: true })]));
  const variants = plan.participants[0]!.obligations.map((item) => item.variant);
  assert.ok(!variants.includes("attended"));
  assert.ok(!variants.includes("absent"));
});

test("shared follow-up asset does not collapse attended and absent communication identities", () => {
  const plan = planWebinarAudience(catalog, source([
    participant({
      participantId: "attended", attendanceState: "attended",
      attendanceAvailableAtEpochMs: actualEnd + hour, followUpAssetId: "shared",
    }),
    participant({
      participantId: "absent", attendanceState: "absent",
      attendanceAvailableAtEpochMs: actualEnd + hour, followUpAssetId: "shared",
    }),
  ]));
  const followUps = plan.participants.flatMap((entry) => entry.obligations)
    .filter((item) => item.variant === "attended" || item.variant === "absent");
  assert.deepEqual(new Set(followUps.map((item) => item.assetId)), new Set(["shared"]));
  assert.deepEqual(new Set(followUps.map((item) => item.variant)), new Set(["attended", "absent"]));
  assert.equal(new Set(followUps.map((item) => item.communicationId)).size, 2);
});

test("waitlist promotion and closure require their distinct explicit triggers", () => {
  const base = {
    registrationStatus: "waitlisted" as const, registrationAtEpochMs: null,
    waitlistedAtEpochMs: actualEnd - 3 * day,
  };
  const none = planWebinarAudience(catalog, scheduled(participant(base))).participants[0]!;
  assert.ok(!none.obligations.some((item) =>
    item.kind === "waitlist_promotion" || item.kind === "waitlist_closure"));
  const promotion = planWebinarAudience(catalog, scheduled(participant({
    ...base, waitlistPromotionTriggeredAtEpochMs: actualEnd - 2 * day,
  }))).participants[0]!;
  const closure = planWebinarAudience(catalog, scheduled(participant({
    ...base, waitlistClosureTriggeredAtEpochMs: actualEnd - 2 * day,
  }))).participants[0]!;
  assert.ok(promotion.obligations.some((item) => item.kind === "waitlist_promotion"));
  assert.ok(!promotion.obligations.some((item) => item.kind === "waitlist_closure"));
  assert.ok(closure.obligations.some((item) => item.kind === "waitlist_closure"));
  assert.ok(!closure.obligations.some((item) => item.kind === "waitlist_promotion"));
});

test("labelled QA planning remains non-customer and excluded from reporting", () => {
  const plan = planWebinarAudience(catalog, scheduled(participant({
    audienceClass: "test", qaTestSendRequested: true,
  })));
  const qa = plan.participants[0]!.obligations.find((item) => item.kind === "qa_test_send")!;
  assert.equal(plan.participants[0]!.customerReportingIncluded, false);
  assert.equal(qa.customerPath, false);
  assert.equal(qa.variant, "qa_test");
  assert.equal(plan.sendAuthorized, false);
});

test("event records expose no attendance fields; attendance belongs to each participant", () => {
  const value = source([
    participant({ participantId: "attended", attendanceState: "attended", attendanceAvailableAtEpochMs: actualEnd }),
    participant({ participantId: "absent", attendanceState: "absent", attendanceAvailableAtEpochMs: actualEnd }),
  ]);
  assert.equal(Object.keys(value.event).some((key) => /attendance|attended|absent/i.test(key)), false);
  assert.deepEqual(value.participants.map((item) => item.attendanceState), ["attended", "absent"]);
});