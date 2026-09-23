import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/loader";
import {
  planWebinarAudience, type AudienceParticipantInput, type WebinarAudienceInput,
} from "../../src/lib/webinar-standard-audience/index";

const catalog = await loadWebinarStandardCatalog();
const hour = 3_600_000;
const actualEnd = Date.parse("2030-01-04T18:00:00Z"); // Friday
const observed = Date.parse("2030-01-08T20:00:00Z"); // Tuesday
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[]
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

function completedParticipant(overrides: Partial<AudienceParticipantInput> = {}): AudienceParticipantInput {
  return {
    participantId: "p-1", eventId: "event-1", registrationStatus: "registered",
    attendanceState: "attended", audienceClass: "customer", recruitmentEligible: true,
    contactable: true, optedOut: false, invalidAddress: false, governedExclusion: false,
    registrationAtEpochMs: actualEnd - 7 * 86_400_000, attendanceAvailableAtEpochMs: actualEnd + hour,
    waitlistedAtEpochMs: null, waitlistPromotionTriggeredAtEpochMs: null,
    waitlistClosureTriggeredAtEpochMs: null, participantCancellationTriggeredAtEpochMs: null,
    neutralVariantApproved: false, qaTestSendRequested: false, followUpAssetId: "shared-recording",
    ...overrides,
  };
}
function completed(participants: readonly AudienceParticipantInput[]): Mutable<WebinarAudienceInput> {
  return {
    calculationInstantEpochMs: observed, timeZone: "America/New_York",
    standardId: "WEB-STANDARD-001", standardVersion: "1.0-pilot-rc1",
    event: {
      eventId: "event-1", operationalStatus: "completed", startsAtEpochMs: actualEnd - hour,
      endsAtEpochMs: actualEnd, actualEndsAtEpochMs: actualEnd, observedAtEpochMs: observed,
      materialChangeTriggeredAtEpochMs: null, cancellationTriggeredAtEpochMs: null,
    },
    recruitmentTouches: [
      { identity: "recruitment_1", communicationId: "r1" },
      { identity: "recruitment_2", communicationId: "r2" },
      { identity: "recruitment_3", communicationId: "r3" },
      { identity: "final_recruitment", communicationId: "r4" },
    ],
    participants,
  } as Mutable<WebinarAudienceInput>;
}

test("attended state creates only the attended follow-up variant", () => {
  const followUps = planWebinarAudience(catalog, completed([completedParticipant()]))
    .participants[0]!.obligations.filter((item) => item.variant !== null);
  assert.deepEqual(followUps.map((item) => item.variant), ["attended"]);
});

test("registered-absent state creates only the absent follow-up variant", () => {
  const result = planWebinarAudience(catalog, completed([completedParticipant({ attendanceState: "absent" })]));
  assert.equal(result.participants[0]!.state, "registered_absent");
  assert.deepEqual(result.participants[0]!.obligations.filter((item) => item.variant).map((item) => item.variant), ["absent"]);
});

test("follow-up deadline skips a weekend using Monday-Friday only", () => {
  const followUp = planWebinarAudience(catalog, completed([completedParticipant()]))
    .participants[0]!.obligations.find((item) => item.kind === "attended_follow_up")!;
  assert.equal(followUp.deadlineLocal?.date, "2030-01-07");
  assert.equal(followUp.deadlineLocal?.time, "13:00:00");
});

test("absent deadline is anchored to attendance availability rather than event end", () => {
  const available = actualEnd + 2 * hour;
  const followUp = planWebinarAudience(catalog, completed([
    completedParticipant({ attendanceState: "absent", attendanceAvailableAtEpochMs: available }),
  ])).participants[0]!.obligations.find((item) => item.kind === "absent_follow_up")!;
  assert.equal(followUp.dueAtEpochMs! > available, true);
});

test("attendance unknown creates reconciliation first and no attended or absent variant", () => {
  const result = planWebinarAudience(catalog, completed([
    completedParticipant({ attendanceState: "unknown", attendanceAvailableAtEpochMs: null }),
  ]));
  assert.equal(result.participants[0]!.state, "attendance_unknown");
  assert.ok(result.participants[0]!.obligations.some((item) => item.kind === "attendance_reconciliation"));
  assert.ok(result.participants[0]!.obligations.every((item) => item.variant !== "attended" && item.variant !== "absent"));
});

test("neutral variant is withheld before two business days", () => {
  const source = completed([completedParticipant({
    attendanceState: "unknown", attendanceAvailableAtEpochMs: null, neutralVariantApproved: true,
  })]);
  source.calculationInstantEpochMs = Date.parse("2030-01-07T17:00:00Z");
  source.event.observedAtEpochMs = source.calculationInstantEpochMs;
  const result = planWebinarAudience(catalog, source);
  assert.ok(!result.participants[0]!.obligations.some((item) => item.kind === "neutral_follow_up"));
});

test("neutral variant becomes eligible only after two Monday-Friday business days", () => {
  const result = planWebinarAudience(catalog, completed([completedParticipant({
    attendanceState: "unknown", attendanceAvailableAtEpochMs: null, neutralVariantApproved: true,
  })]));
  const neutral = result.participants[0]!.obligations.find((item) => item.kind === "neutral_follow_up")!;
  assert.equal(neutral.variant, "neutral");
  assert.equal(neutral.disposition, "eligible");
  assert.equal(neutral.deadlineLocal?.date, "2030-01-08");
});

test("neutral eligibility remains documentary and carries no send authorization", () => {
  const result = planWebinarAudience(catalog, completed([completedParticipant({
    attendanceState: "unknown", attendanceAvailableAtEpochMs: null, neutralVariantApproved: true,
  })]));
  assert.equal(result.sendAuthorized, false);
  assert.equal(result.authority.sendingAuthority, false);
});

test("unapproved neutral variant remains withheld after two business days", () => {
  const result = planWebinarAudience(catalog, completed([completedParticipant({
    attendanceState: "unknown", attendanceAvailableAtEpochMs: null, neutralVariantApproved: false,
  })]));
  assert.ok(result.participants[0]!.warnings.includes("neutral_variant_requires_explicit_approval"));
  assert.ok(!result.participants[0]!.obligations.some((item) => item.kind === "neutral_follow_up"));
});

test("waitlist confirmation is immediate", () => {
  const waitlistedAt = observed - hour;
  const result = planWebinarAudience(catalog, completed([completedParticipant({
    registrationStatus: "waitlisted", attendanceState: "unknown", registrationAtEpochMs: null,
    attendanceAvailableAtEpochMs: null, waitlistedAtEpochMs: waitlistedAt,
  })]));
  assert.equal(result.participants[0]!.obligations[0]!.dueAtEpochMs, waitlistedAt);
});

test("waitlist promotion trigger creates promotion confirmation", () => {
  const result = planWebinarAudience(catalog, completed([completedParticipant({
    registrationStatus: "waitlisted", attendanceState: "unknown", registrationAtEpochMs: null,
    attendanceAvailableAtEpochMs: null, waitlistedAtEpochMs: observed - 2 * hour,
    waitlistPromotionTriggeredAtEpochMs: observed - hour,
  })]));
  assert.ok(result.participants[0]!.obligations.some((item) => item.kind === "waitlist_promotion"));
});

test("waitlist closure trigger creates non-admission notice", () => {
  const result = planWebinarAudience(catalog, completed([completedParticipant({
    registrationStatus: "waitlisted", attendanceState: "unknown", registrationAtEpochMs: null,
    attendanceAvailableAtEpochMs: null, waitlistedAtEpochMs: observed - 2 * hour,
    waitlistClosureTriggeredAtEpochMs: observed - hour,
  })]));
  assert.ok(result.participants[0]!.obligations.some((item) => item.kind === "waitlist_closure"));
});

test("shared asset identifier does not collapse attended and absent variant identities", () => {
  const result = planWebinarAudience(catalog, completed([
    completedParticipant({ participantId: "attended" }),
    completedParticipant({ participantId: "absent", attendanceState: "absent" }),
  ]));
  const followUps = result.participants.flatMap((entry) => entry.obligations).filter((item) => item.variant);
  assert.deepEqual(new Set(followUps.map((item) => item.assetId)), new Set(["shared-recording"]));
  assert.deepEqual(new Set(followUps.map((item) => item.variant)), new Set(["attended", "absent"]));
  assert.notEqual(followUps[0]!.communicationId, followUps[1]!.communicationId);
});

test("business-day metadata explicitly excludes holiday behavior", () => {
  const metadata = planWebinarAudience(catalog, completed([completedParticipant()])).businessDayConvention;
  assert.equal(metadata.holidayCalendar, false);
  assert.match(metadata.limitation, /no holiday calendar/);
});