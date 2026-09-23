import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/loader";
import {
  AudiencePlanningInputError, planWebinarAudience,
  type AudienceParticipantInput, type WebinarAudienceInput,
} from "../../src/lib/webinar-standard-audience/index";

const catalog = await loadWebinarStandardCatalog();
const start = Date.parse("2031-03-20T15:00:00Z");
const observed = start - 3 * 86_400_000;
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[]
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function person(id = "p-1"): AudienceParticipantInput {
  return {
    participantId: id, eventId: "e-1", registrationStatus: "registered",
    attendanceState: "unknown", audienceClass: "customer", recruitmentEligible: true,
    contactable: true, optedOut: false, invalidAddress: false, governedExclusion: false,
    registrationAtEpochMs: observed - 1, attendanceAvailableAtEpochMs: null,
    waitlistedAtEpochMs: null, waitlistPromotionTriggeredAtEpochMs: null,
    waitlistClosureTriggeredAtEpochMs: null, participantCancellationTriggeredAtEpochMs: null,
    neutralVariantApproved: false, qaTestSendRequested: false, followUpAssetId: null,
  };
}
function valid(): Mutable<WebinarAudienceInput> {
  return {
    calculationInstantEpochMs: observed, timeZone: "Europe/London",
    standardId: "WEB-STANDARD-001", standardVersion: "1.0-pilot-rc1",
    event: {
      eventId: "e-1", operationalStatus: "scheduled", startsAtEpochMs: start,
      endsAtEpochMs: start + 3_600_000, actualEndsAtEpochMs: null, observedAtEpochMs: observed,
      materialChangeTriggeredAtEpochMs: null, cancellationTriggeredAtEpochMs: null,
    },
    recruitmentTouches: [
      { identity: "recruitment_1", communicationId: "r-1" },
      { identity: "recruitment_2", communicationId: "r-2" },
      { identity: "recruitment_3", communicationId: "r-3" },
      { identity: "final_recruitment", communicationId: "r-4" },
    ],
    participants: [person()],
  } as Mutable<WebinarAudienceInput>;
}
function rejects(source: unknown): void {
  assert.throws(() => planWebinarAudience(catalog, source), AudiencePlanningInputError);
}

test("duplicate participant identity is rejected", () => {
  const source = valid();
  source.participants = [person(), person()];
  rejects(source);
});

test("duplicate supplied communication identity is rejected even on noneligible participants", () => {
  const source = valid();
  source.participants = [
    { ...person("a"), optedOut: true, communicationIds: { qa_test_send: "same" } },
    { ...person("b"), optedOut: true, communicationIds: { attended_follow_up: "same" } },
  ];
  rejects(source);
});

test("communication identity colliding with a recruitment touch is rejected", () => {
  const source = valid();
  source.participants = [{ ...person(), communicationIds: { calendar_information: "r-1" } }];
  rejects(source);
});

test("duplicate recruitment touch identity is rejected", () => {
  const source = valid();
  source.recruitmentTouches[1] = { identity: "recruitment_1", communicationId: "other" };
  rejects(source);
});

test("missing completed actual end is rejected", () => {
  const source = valid();
  source.event.operationalStatus = "completed";
  rejects(source);
});

test("completed actual end after observation is rejected", () => {
  const source = valid();
  source.event.operationalStatus = "completed";
  source.event.actualEndsAtEpochMs = observed + 1;
  rejects(source);
});

test("scheduled event cannot carry an event-cancellation trigger", () => {
  const source = valid();
  source.event.cancellationTriggeredAtEpochMs = observed - 1;
  rejects(source);
});

test("completed event cannot carry an event-cancellation trigger", () => {
  const source = valid();
  source.event.operationalStatus = "completed";
  source.event.startsAtEpochMs = observed - 2 * 3_600_000;
  source.event.endsAtEpochMs = observed - 3_600_000;
  source.event.actualEndsAtEpochMs = observed - 3_600_000;
  source.event.cancellationTriggeredAtEpochMs = observed - 1;
  source.participants[0]!.registrationAtEpochMs = observed - 86_400_000;
  rejects(source);
});

test("registration after event cancellation is rejected", () => {
  const source = valid();
  source.event.operationalStatus = "cancelled";
  source.event.cancellationTriggeredAtEpochMs = observed - 10;
  source.participants[0]!.registrationAtEpochMs = observed - 1;
  rejects(source);
});

test("waitlisting after event cancellation is rejected", () => {
  const source = valid();
  source.event.operationalStatus = "cancelled";
  source.event.cancellationTriggeredAtEpochMs = observed - 10;
  source.participants = [{
    ...person(), registrationStatus: "waitlisted", registrationAtEpochMs: null,
    waitlistedAtEpochMs: observed - 1,
  }];
  rejects(source);
});

test("registration after a completed event actual end is rejected", () => {
  const source = valid();
  source.event.operationalStatus = "completed";
  source.event.startsAtEpochMs = observed - 2 * 3_600_000;
  source.event.endsAtEpochMs = observed - 3_600_000;
  source.event.actualEndsAtEpochMs = observed - 3_600_000;
  source.participants[0]!.registrationAtEpochMs = observed - 1;
  rejects(source);
});

test("attendance availability before registration is rejected", () => {
  const source = valid();
  source.participants[0]!.attendanceAvailableAtEpochMs = source.participants[0]!.registrationAtEpochMs! - 1;
  rejects(source);
});

test("waitlist promotion on a cancelled event is rejected", () => {
  const source = valid();
  source.event.operationalStatus = "cancelled";
  source.event.cancellationTriggeredAtEpochMs = observed - 1;
  source.participants = [{
    ...person(), registrationStatus: "waitlisted", registrationAtEpochMs: null,
    waitlistedAtEpochMs: observed - 100, waitlistPromotionTriggeredAtEpochMs: observed - 2,
  }];
  rejects(source);
});

test("attendance at event level is rejected as an unknown schema field", () => {
  const source = valid();
  rejects({ ...source, event: { ...source.event, attendanceState: "attended" } });
});

test("attended state on an unregistered participant is rejected", () => {
  const source = valid();
  source.participants = [{ ...person(), registrationStatus: "not_registered", registrationAtEpochMs: null, attendanceState: "attended" }];
  rejects(source);
});

test("attended state before event completion is rejected", () => {
  const source = valid();
  source.participants = [{ ...person(), attendanceState: "attended", attendanceAvailableAtEpochMs: observed }];
  rejects(source);
});

test("waitlist promotion and closure triggers are mutually exclusive", () => {
  const source = valid();
  source.participants = [{
    ...person(), registrationStatus: "waitlisted", registrationAtEpochMs: null,
    waitlistedAtEpochMs: observed - 3, waitlistPromotionTriggeredAtEpochMs: observed - 2,
    waitlistClosureTriggeredAtEpochMs: observed - 1,
  }];
  rejects(source);
});

test("customer record cannot request QA test-send planning", () => {
  const source = valid();
  source.participants = [{ ...person(), qaTestSendRequested: true }];
  rejects(source);
});

test("invalid IANA time zone is rejected without a default", () => {
  const source = valid();
  source.timeZone = "not/a-zone";
  assert.throws(() => planWebinarAudience(catalog, source));
});

test("observation time must equal the explicit calculation instant", () => {
  const source = valid();
  source.event.observedAtEpochMs -= 1;
  rejects(source);
});

test("unknown input fields are rejected", () => {
  rejects({ ...valid(), computedPlan: { sendAuthorized: true } });
});

test("caller-supplied computed plan cannot bypass planner invariants", () => {
  const source = { ...valid(), participants: [{ ...person(), computedPlan: { state: "attended" } }] };
  rejects(source);
});

test("input remains deeply unchanged", () => {
  const source = valid();
  const before = structuredClone(source);
  planWebinarAudience(catalog, source);
  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(source), false);
});

test("result is deeply immutable", () => {
  const result = planWebinarAudience(catalog, valid());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.participants), true);
  assert.equal(Object.isFrozen(result.participants[0]!.obligations), true);
});

test("planning is deterministic", () => {
  assert.deepEqual(planWebinarAudience(catalog, valid()), planWebinarAudience(catalog, valid()));
});

test("participant input order does not affect canonical output order", () => {
  const left = valid();
  left.participants = [person("z"), person("a")];
  const right = valid();
  right.participants = [person("a"), person("z")];
  assert.deepEqual(planWebinarAudience(catalog, left), planWebinarAudience(catalog, right));
});

test("obligations are chronologically ordered", () => {
  const obligations = planWebinarAudience(catalog, valid()).participants[0]!.obligations;
  const instants = obligations.map((entry) => entry.dueAtEpochMs ?? Number.MAX_SAFE_INTEGER);
  assert.deepEqual(instants, [...instants].sort((a, b) => a - b));
});

test("output grants no readiness, exception, or sending authority", () => {
  const result = planWebinarAudience(catalog, valid());
  assert.deepEqual(result.authority, {
    readinessOverride: false, exceptionOverride: false, sendingAuthority: false,
  });
  assert.equal(result.mode, "planning_only");
  assert.equal(result.sendAuthorized, false);
});

test("module source exposes no send, route, database, publishing, or deployment capability", async () => {
  const exports = await import("../../src/lib/webinar-standard-audience/index");
  assert.deepEqual(Object.keys(exports).sort(), [
    "AUDIENCE_COMMUNICATION_KINDS", "AudiencePlanningInputError",
    "planWebinarAudience", "validateAudiencePlanningInput",
  ]);
});