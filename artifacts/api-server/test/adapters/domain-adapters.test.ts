import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleEvaluationInput, adaptParticipant, adaptPlannedCommunication, localScheduledInstant, instant, INPUT_CLASSIFICATIONS } from "../../src/lib/webinar-domain-adapters";
import type { AssemblySource, ParticipantSource } from "../../src/lib/webinar-domain-adapters";
import { adaptEvidence, adaptException } from "../../src/lib/webinar-domain-adapters";
import type { ManualEvidence, EvidenceValidationContext } from "../../src/lib/webinar-standard-evidence";
import type { WebinarException } from "../../src/lib/webinar-standard-exceptions";
import { catalog, referenceTime } from "../evaluation/fixtures";

const source = (): AssemblySource => ({
  campaign: { id: "campaign-a" },
  activity: { id: "activity-a", campaignId: "campaign-a", activityType: "webinar" },
  occurrence: { id: "occurrence-a", activityId: "activity-a", campaignId: "campaign-a", sessionDate: "2026-06-01", startTime: "12:00:00", timezone: "America/New_York", durationMinutes: 60, platform: "", name: "" },
  binding: { standardId: "WEB-STANDARD-001", standardVersion: "1.0-pilot-rc1" },
  calculationInstant: 0, eventStatus: "scheduled",
});
const person = (): ParticipantSource => ({
  participantId: "synthetic-a", eventId: "occurrence-a", isSynthetic: true,
  registrationStatus: "registered", audienceClass: "customer",
  includedInAttendance: null, includedInReporting: false,
});

test("all 26 input classifications are explicit and unique", () => {
  assert.equal(INPUT_CLASSIFICATIONS.length, 26);
  assert.equal(new Set(INPUT_CLASSIFICATIONS.map(row => row.field)).size, 26);
  for (const row of INPUT_CLASSIFICATIONS) assert.ok(row.classification);
});
test("hierarchy, exact version and source references remain distinct", () => {
  const result = assembleEvaluationInput(source());
  assert.equal(result.context?.event.eventId, "occurrence-a");
  assert.equal(result.sourceReferences.length, 3);
  assert.equal(assembleEvaluationInput({ ...source(), binding: { standardId: "WEB-STANDARD-001", standardVersion: "default_5" } }).context, null);
  assert.equal(assembleEvaluationInput({ ...source(), activity: { ...source().activity, campaignId: "other" } }).mappingErrors[0]?.code, "SCOPE_MISMATCH");
  assert.equal(assembleEvaluationInput({ ...source(), activity: { ...source().activity, activityType: "journey" } }).context, null);
});
test("missing event status is not invented from planning; explicit statuses retained", () => {
  const missing = assembleEvaluationInput({ ...source(), eventStatus: null });
  assert.equal(missing.context, null);
  assert.ok(missing.missingInputs.some(gap => gap.field === "eventStatus"));
  for (const eventStatus of ["draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled"] as const) {
    const result = assembleEvaluationInput({ ...source(), eventStatus, participant: person() });
    assert.equal(result.context?.event.operationalStatus, eventStatus);
    assert.equal(result.context?.participant?.attendanceState, "unknown");
  }
});
test("zero false empty null and missing remain distinguishable", () => {
  const result = assembleEvaluationInput({ ...source(), communications: [], baseFacts: { consent: { required: false, languageAttached: null, confirmation: null } } });
  assert.equal(result.context?.observedAtEpochMs, 0);
  assert.equal(result.context?.setup?.platform, "");
  assert.equal(result.context?.consent.required, false);
  assert.equal(result.context?.consent.languageAttached, null);
  assert.ok(!result.missingInputs.some(gap => gap.field === "communications"));
  assert.ok(assembleEvaluationInput(source()).missingInputs.some(gap => gap.field === "communications"));
});
test("participant status, per-registrant attendance, synthetic-only and exclusions", () => {
  for (const registrationStatus of ["registered", "waitlisted", "cancelled", "not_registered"] as const) {
    const result = adaptParticipant({ ...person(), registrationStatus }, "occurrence-a");
    assert.equal(result.value?.registrationStatus, registrationStatus);
    assert.equal(result.value?.attendanceState, "unknown");
  }
  for (const attendanceState of ["attended", "absent", "unknown"] as const) assert.equal(adaptParticipant({ ...person(), attendanceState }, "occurrence-a").value?.attendanceState, attendanceState);
  assert.equal(adaptParticipant({ ...person(), isSynthetic: false }, "occurrence-a").value, null);
  assert.equal(adaptParticipant(person(), "other-occurrence").value, null);
  assert.equal(adaptParticipant({ ...person(), registrationStatus: "cancelled", attendanceState: "absent" }, "occurrence-a").value, null);
  for (const audienceClass of ["internal", "test"] as const) assert.equal(adaptParticipant({ ...person(), audienceClass, includedInReporting: true }, "occurrence-a").value?.includedInReporting, false);
  assert.equal(adaptParticipant({ ...person(), suppressed: true, includedInAttendance: true }, "occurrence-a").value?.includedInAttendance, false);
});
test("plans never become execution facts; neutral follow-up remains distinct", () => {
  for (const [key, variant] of [["attendee_followup", "attended"], ["no_show_followup", "absent"], ["neutral_followup", "neutral"]]) {
    const result = adaptPlannedCommunication({ id: "plan-a", sessionId: "occurrence-a", key: key!, scheduledAt: 0, utmRequired: false }, "occurrence-a");
    assert.equal(result.value?.variant, variant);
    assert.equal(result.value?.state, "planned");
    assert.equal(result.value?.scheduledAtEpochMs, 0);
    assert.equal(result.value?.recordedAtEpochMs, null);
    assert.equal(result.value?.utmRequired, false);
  }
  assert.equal(adaptPlannedCommunication({ id: "x", sessionId: "occurrence-a", key: "unknown" }, "occurrence-a").value, null);
});
test("DST gaps and overlaps rejected; offsets and zones deterministic", () => {
  assert.throws(() => localScheduledInstant("2026-03-08", "02:30", "America/New_York"));
  assert.throws(() => localScheduledInstant("2026-11-01", "01:30", "America/New_York"));
  assert.equal(localScheduledInstant("2026-06-01", "12:00", "America/New_York"), instant("2026-06-01T16:00:00Z"));
  assert.equal(localScheduledInstant("2026-06-01", "17:00", "Europe/London"), instant("2026-06-01T16:00:00Z"));
  assert.throws(() => instant("2026-06-01T12:00:00"));
  assert.throws(() => localScheduledInstant("2026-02-30", "12:00", "UTC"));
  assert.equal(assembleEvaluationInput({ ...source(), occurrence: { ...source().occurrence, sessionDate: "2026-11-01", startTime: "01:30" } }).context, null);
});
test("Foundation remains unavailable; manual free text not accepted as governed evidence", () => {
  assert.equal(assembleEvaluationInput(source()).unavailableInputs.length, 3);
  assert.equal(assembleEvaluationInput({ ...source(), baseFacts: { governance: { internalName: { value: "manual", source: "manual", verified: true }, campaignCode: null, taxonomyValues: null } } }).context, null);
});
test("subcontexts reject foreign occurrence and preserve partial snapshots", () => {
  const setup = { eventId: "occurrence-a", snapshotId: "snapshot-a", complete: false, activityType: "webinar", platformEnforcesCapacity: false, capacity: 0 };
  assert.equal(assembleEvaluationInput({ ...source(), subcontexts: { setup } }).context?.setup?.capacity, 0);
  assert.equal(assembleEvaluationInput({ ...source(), subcontexts: { setup: { ...setup, eventId: "other" } } }).context, null);
});
test("deterministic ordering and deep immutability without freezing caller", () => {
  const input = source();
  const before = structuredClone(input);
  const a = { id: "a", sessionId: "occurrence-a", key: "recruitment_1" };
  const b = { id: "b", sessionId: "occurrence-a", key: "recruitment_2" };
  assert.deepEqual(assembleEvaluationInput({ ...input, communications: [b, a] }), assembleEvaluationInput({ ...input, communications: [a, b] }));
  const result = assembleEvaluationInput(input);
  assert.ok(Object.isFrozen(result.context?.setup));
  assert.ok(!Object.isFrozen(input.occurrence));
  assert.deepEqual(input, before);
});

test("evidence and exceptions remain separate documentary types with unverified attribution", () => {
  const rule = catalog.rules.find(rule => rule.exceptionEligible)!;
  const validation: EvidenceValidationContext = {
    catalog, nowEpochMs: referenceTime, expectedRuleId: rule.ruleId,
    expectedScope: { eventId: "occurrence-a", sessionIds: [], participantIds: [], communicationIds: [], deliverableIds: [] },
    expectedInputSnapshotVersion: "v1", expectedArtifactVersion: null, referenceRequired: false,
  };
  const evidence: ManualEvidence = {
    evidenceId: "e1", ruleId: rule.ruleId, standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    evidenceStatus: "confirmed", evidenceDescription: "Synthetic documentary observation",
    suppliedBy: { nameOrPilotIdentifier: "development author", identityVerified: false },
    suppliedAtEpochMs: referenceTime - 1000, sourceReference: null, attachmentReference: null,
    validFromEpochMs: referenceTime - 1000, expiresAtEpochMs: null, notes: "Synthetic metadata only",
    scope: validation.expectedScope,
    binding: { inputSnapshotVersion: "v1", artifactVersion: null, reviewedAtEpochMs: referenceTime - 1000, snapshotCompleteness: "complete", observationFromEpochMs: null, observationThroughEpochMs: null },
  };
  const exception: WebinarException = {
    exceptionId: "x1", ruleId: rule.ruleId, standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    requirementOverridden: rule.expectedBehavior, businessJustification: "Synthetic review only", requestor: "development requestor", reviewer: "development reviewer",
    reviewerVerificationStatus: "unverified", decision: "approved", decisionAtEpochMs: referenceTime - 100,
    expiresAtEpochMs: referenceTime + 1000, expirationRequired: true, compensatingAction: "Synthetic manual review", compensatingActionRequired: true,
    createdAtEpochMs: referenceTime - 200, pilotAudit: { pilotReference: "p1", auditReference: "a1" },
  };
  assert.equal(adaptEvidence(evidence, validation).value?.suppliedBy.identityVerified, false);
  assert.equal(adaptException(exception, catalog, referenceTime, rule.ruleId).value?.reviewerVerificationStatus, "unverified");
  assert.equal(adaptEvidence(exception as unknown as ManualEvidence, validation).value, null);
  assert.equal(adaptException(evidence as unknown as WebinarException, catalog, referenceTime, rule.ruleId).value, null);
  assert.equal(adaptException({ ...exception, expiresAtEpochMs: referenceTime - 1 }, catalog, referenceTime, rule.ruleId).value, null);
});