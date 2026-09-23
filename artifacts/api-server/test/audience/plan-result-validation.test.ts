import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/loader";
import {
  planWebinarAudience, registrantReminderInstant, validateWebinarAudiencePlanResult,
  type WebinarAudienceInput, type WebinarAudiencePlan,
} from "../../src/lib/webinar-standard-audience/index";

const catalog = await loadWebinarStandardCatalog();
const start = Date.parse("2030-01-10T12:00:00Z");
const now = start - 2 * 86_400_000;
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[]
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function input(): Mutable<WebinarAudienceInput> {
  return {
    standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    timeZone: "America/New_York", calculationInstantEpochMs: now,
    event: {
      eventId: "event", operationalStatus: "scheduled", startsAtEpochMs: start,
      endsAtEpochMs: start + 3_600_000, actualEndsAtEpochMs: null, observedAtEpochMs: now,
      materialChangeTriggeredAtEpochMs: null, cancellationTriggeredAtEpochMs: null,
    },
    recruitmentTouches: ["recruitment_1", "recruitment_2", "recruitment_3", "final_recruitment"]
      .map((identity, i) => ({ identity, communicationId: `rec-${i}` })) as Mutable<WebinarAudienceInput>["recruitmentTouches"],
    participants: [{
      participantId: "participant", eventId: "event", registrationStatus: "registered",
      attendanceState: "unknown", audienceClass: "customer", recruitmentEligible: true,
      contactable: true, optedOut: false, invalidAddress: false, governedExclusion: false,
      registrationAtEpochMs: now - 1, attendanceAvailableAtEpochMs: null, waitlistedAtEpochMs: null,
      waitlistPromotionTriggeredAtEpochMs: null, waitlistClosureTriggeredAtEpochMs: null,
      participantCancellationTriggeredAtEpochMs: null, neutralVariantApproved: false,
      qaTestSendRequested: false, followUpAssetId: "shared-asset",
    }],
  };
}
function plan(source = input()): Mutable<WebinarAudiencePlan> {
  return structuredClone(planWebinarAudience(catalog, source)) as Mutable<WebinarAudiencePlan>;
}
const states = ["eligible_non_registrant", "registered", "attended", "registered_absent",
  "attendance_unknown", "waitlisted", "cancelled", "internal_or_test"] as const;
function stateInput(state: typeof states[number]): Mutable<WebinarAudienceInput> {
  const source = input();
  const p = source.participants[0]!;
  if (state === "eligible_non_registrant") {
    p.registrationStatus = "not_registered"; p.registrationAtEpochMs = null;
  }
  if (["attended", "registered_absent", "attendance_unknown"].includes(state)) {
    source.calculationInstantEpochMs = start + 6 * 86_400_000;
    source.event.observedAtEpochMs = source.calculationInstantEpochMs;
    source.event.operationalStatus = "completed";
    source.event.actualEndsAtEpochMs = start + 3_600_000;
    if (state !== "attendance_unknown") {
      p.attendanceState = state === "attended" ? "attended" : "absent";
      p.attendanceAvailableAtEpochMs = start + 3_600_001;
    }
  }
  if (state === "waitlisted") { p.registrationStatus = "waitlisted"; p.waitlistedAtEpochMs = now - 1; }
  if (state === "cancelled") { p.registrationStatus = "cancelled"; p.participantCancellationTriggeredAtEpochMs = now; }
  if (state === "internal_or_test") { p.audienceClass = "test"; p.qaTestSendRequested = true; }
  return source;
}
for (const state of states) test(`audience result accepts verified ${state} output`, () => {
  const source = stateInput(state);
  assert.equal(validateWebinarAudiencePlanResult(plan(source), source, catalog), null);
});
test("audience result accepts approved neutral variant with local deadline", () => {
  const source = stateInput("attendance_unknown");
  source.participants[0]!.neutralVariantApproved = true;
  assert.equal(validateWebinarAudiencePlanResult(plan(source), source, catalog), null);
});
test("audience result accepts unknown attendance before neutral eligibility", () => {
  const source = stateInput("attendance_unknown");
  source.calculationInstantEpochMs = source.event.actualEndsAtEpochMs!;
  source.event.observedAtEpochMs = source.calculationInstantEpochMs;
  assert.equal(validateWebinarAudiencePlanResult(plan(source), source, catalog), null);
});
test("audience result accepts event cancellation and visibly omitted reminders", () => {
  const source = input();
  source.event.operationalStatus = "cancelled";
  source.event.cancellationTriggeredAtEpochMs = now;
  assert.equal(validateWebinarAudiencePlanResult(plan(source), source, catalog), null);
});
const corruptions: [string, (result: Mutable<WebinarAudiencePlan>) => void][] = [
  ["wrong standard", result => { (result as unknown as Record<string, unknown>).standardId = "other"; }],
  ["wrong version", result => { (result as unknown as Record<string, unknown>).standardVersion = "other"; }],
  ["wrong event", result => { result.eventId = "other"; }],
  ["wrong instant", result => { result.calculationInstantEpochMs++; }],
  ["missing participants", result => { result.participants = []; }],
  ["duplicate participants", result => { result.participants.push(result.participants[0]!); }],
  ["forged authority", result => { (result.authority as unknown as Record<string, unknown>).sendingAuthority = true; }],
  ["forged reporting inclusion", result => { result.participants[0]!.customerReportingIncluded = false; }],
  ["incoherent state", result => { result.participants[0]!.state = "attended"; }],
  ["missing obligation", result => { result.participants[0]!.obligations.pop(); }],
  ["duplicate obligation kind", result => { result.participants[0]!.obligations.push(result.participants[0]!.obligations[0]!); }],
  ["wrong communication identity", result => { result.participants[0]!.obligations[0]!.communicationId = "other"; }],
  ["duplicate communication identity", result => { result.participants[0]!.obligations[1]!.communicationId = result.participants[0]!.obligations[0]!.communicationId; }],
  ["invalid instant", result => { result.participants[0]!.obligations[0]!.dueAtEpochMs = 0.5; }],
  ["wrong trigger instant", result => { result.participants[0]!.obligations[0]!.dueAtEpochMs = now - 10; }],
  ["wrong timing kind", result => { result.participants[0]!.obligations[0]!.timingKind = "none"; }],
  ["empty reason", result => { result.participants[0]!.obligations[0]!.reason = ""; }],
  ["forged reason", result => { result.participants[0]!.obligations[0]!.reason = "Already delivered."; }],
  ["wrong canonical rule", result => { result.participants[0]!.obligations[0]!.canonicalRuleIds = ["WEB-REG-006"]; }],
  ["missing suppression", result => { result.participants[0]!.suppressions = []; }],
  ["wrong business convention", result => { result.businessDayConvention.timeZone = "UTC"; }],
  ["extra fields", result => { Object.assign(result, { attendance: "attended" }); }],
];
for (const [name, mutate] of corruptions) test(`audience result rejects ${name}`, () => {
  const source = input(); const result = plan(source); mutate(result);
  assert.equal(typeof validateWebinarAudiencePlanResult(result, source, catalog), "string");
});
for (const [name, value] of [
  ["null", null], ["array", []], ["class instance", new Date(0)], ["nonfinite", { value: Infinity }],
  ["sparse array", new Array(3)], ["undefined", undefined],
] as const) test(`audience result rejects malformed ${name}`, () => {
  assert.equal(typeof validateWebinarAudiencePlanResult(value, input(), catalog), "string");
});
test("audience result rejects accessors without invoking them", () => {
  let invoked = false;
  const result = Object.defineProperty({}, "mode", { get() { invoked = true; throw new Error("getter"); } });
  assert.equal(typeof validateWebinarAudiencePlanResult(result, input(), catalog), "string");
  assert.equal(invoked, false);
});
test("audience result rejects cycles", () => {
  const result: Record<string, unknown> = {}; result.self = result;
  assert.equal(typeof validateWebinarAudiencePlanResult(result, input(), catalog), "string");
});
test("audience result rejects malformed expected input", () => {
  const source = input(); source.event.eventId = "other";
  assert.equal(typeof validateWebinarAudiencePlanResult(plan(), source, catalog), "string");
});
test("audience result rejects invalid local instant metadata", () => {
  const source = stateInput("attended"); const result = plan(source);
  result.participants[0]!.obligations.find(item => item.kind === "attended_follow_up")!.deadlineLocal!.offset = "+14:00";
  assert.equal(typeof validateWebinarAudiencePlanResult(result, source, catalog), "string");
});
test("audience result validates nested recruitment and its bound communication identities", () => {
  const source = stateInput("eligible_non_registrant"); const result = plan(source);
  result.participants[0]!.recruitmentPlan!.touches[0]!.communicationId = "foreign";
  assert.equal(typeof validateWebinarAudiencePlanResult(result, source, catalog), "string");
});
test("audience result never mutates caller input or output", () => {
  const source = input(); const result = planWebinarAudience(catalog, source);
  const before = JSON.stringify(source);
  assert.equal(validateWebinarAudiencePlanResult(result, source, catalog), null);
  assert.equal(JSON.stringify(source), before);
});
for (const [kind, offset] of [["reminder_24_hour", 86_400_000], ["reminder_1_hour", 3_600_000]] as const) {
  test(`shared ${kind} nominal instant preserves exact future boundary`, () => {
    const nominal = registrantReminderInstant(start, kind);
    assert.equal(nominal, start - offset);
    for (const delta of [-1, 0, 1]) {
      const source = input();
      source.calculationInstantEpochMs = nominal + delta;
      source.event.observedAtEpochMs = source.calculationInstantEpochMs;
      const reminder = plan(source).participants[0]!.obligations.find(item => item.kind === kind)!;
      assert.equal(reminder.disposition, delta < 0 ? "required" : "omitted");
      assert.equal(reminder.dueAtEpochMs, delta < 0 ? nominal : null);
    }
  });
}