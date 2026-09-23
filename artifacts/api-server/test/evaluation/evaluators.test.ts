import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuleId } from "../../src/lib/webinar-standard-catalog/types";
import type { EvaluationContext, EvaluationStatus } from "../../src/lib/webinar-standard-evaluation/types";
import { makeCommunication, makeContext, makeParticipant, referenceTime, registry } from "./fixtures";

function expectStatus(ruleId: RuleId, context: EvaluationContext, status: EvaluationStatus) {
  const result = registry.evaluate(ruleId, context);
  assert.equal(result.status, status, `${ruleId}: ${result.reason}: ${result.evidence.join("; ")}`);
  assert.equal(result.mode, "descriptive_only");
}

test("REC-005 suppresses every remaining planned recruitment, including overdue", () => {
  const context = makeContext();
  expectStatus("WEB-REC-005", context, "pass");
  for (const scheduledAtEpochMs of [referenceTime - 1, referenceTime, referenceTime + 1]) {
    expectStatus("WEB-REC-005", { ...context, communications: [makeCommunication({ scheduledAtEpochMs })] }, "fail");
  }
  for (const state of ["recorded", "omitted"] as const) {
    expectStatus("WEB-REC-005", { ...context, communications: [makeCommunication({ state })] }, "pass");
  }
  for (const registrationStatus of ["not_registered", "waitlisted", "cancelled"] as const) {
    expectStatus("WEB-REC-005", { ...context, participant: makeParticipant({ registrationStatus }), communications: [makeCommunication()] }, "not_applicable");
  }
  expectStatus("WEB-REC-005", { ...context, participant: null }, "evidence_unavailable");
  expectStatus("WEB-REC-005", { ...context, communications: [
    makeCommunication({ communicationId: "recruitment-other-participant", recipientIds: ["other-person"] }),
    makeCommunication({ communicationId: "registrant-confirmation", kind: "registrant" }),
  ] }, "pass");

  const registered = makeParticipant();
  const eligible = makeParticipant({ participantId: "eligible-participant", registrationStatus: "not_registered" });
  // The caller's snapshot is after registration. Recorded recruitment is history,
  // not a remaining send; the evaluator does not infer a registration timestamp.
  const historical = makeCommunication({
    communicationId: "recruitment-before-registration",
    state: "recorded",
    recipientIds: [registered.participantId, eligible.participantId],
    createdAtEpochMs: referenceTime - 120_000,
    scheduledAtEpochMs: referenceTime - 60_000,
    recordedAtEpochMs: referenceTime - 60_000,
  });
  const future = makeCommunication({
    communicationId: "recruitment-after-registration",
    recipientIds: [registered.participantId, eligible.participantId],
    scheduledAtEpochMs: referenceTime + 60_000,
  });
  const snapshot = { ...context, participant: registered, communications: [historical, future] };
  const original = structuredClone(snapshot);
  const result = registry.evaluate("WEB-REC-005", snapshot);
  assert.equal(result.status, "fail");
  assert.equal(result.reason, "violation");
  assert.equal(result.participantId, registered.participantId);
  assert.equal(result.evidence.length, 1);
  assert.ok(result.evidence[0]!.includes(`${future.communicationId}:`));
  assert.ok(result.evidence.every((entry) => !entry.includes(historical.communicationId)));
  expectStatus("WEB-REC-005", { ...snapshot, communications: [historical] }, "pass");

  const otherResult = registry.evaluate("WEB-REC-005", { ...snapshot, participant: eligible });
  assert.equal(otherResult.status, "not_applicable");
  assert.equal(otherResult.reason, "condition_not_met");
  assert.equal(otherResult.participantId, eligible.participantId);

  // Supply the required suppression as recipient evidence, rather than asking
  // this pure evaluator to modify recipients or suppress an entire communication.
  const suppressed = {
    ...snapshot,
    communications: [historical, { ...future, recipientIds: [eligible.participantId] }],
  };
  expectStatus("WEB-REC-005", suppressed, "pass");
  expectStatus("WEB-REC-005", { ...suppressed, participant: eligible }, "not_applicable");
  assert.deepEqual(suppressed.communications[0], historical);
  assert.equal(suppressed.communications[0]!.state, "recorded");
  assert.ok(suppressed.communications[0]!.recipientIds.includes(registered.participantId));
  assert.equal(suppressed.communications[1]!.state, "planned");
  assert.deepEqual(suppressed.communications[1]!.recipientIds, [eligible.participantId]);
  const expectedIds = ["recruitment-before-registration", "recruitment-after-registration"];
  assert.deepEqual(snapshot.communications.map((communication) => communication.communicationId), expectedIds);
  assert.deepEqual(suppressed.communications.map((communication) => communication.communicationId), expectedIds);
  assert.equal(new Set(expectedIds).size, 2);
  assert.deepEqual(snapshot, original);
});

test("REC-005 rejects duplicate communication IDs before evaluating suppression", () => {
  const context = makeContext();
  // Neither communication requires suppression. Only their duplicate identity
  // makes this context invalid, even though they describe different messages.
  const recruitment = makeCommunication({ communicationId: "duplicate-communication", recipientIds: ["other-person"] });
  const registrant = makeCommunication({ communicationId: "duplicate-communication", kind: "registrant" });
  expectStatus("WEB-REC-005", { ...context, communications: [recruitment] }, "pass");
  expectStatus("WEB-REC-005", { ...context, communications: [registrant] }, "pass");
  const result = registry.evaluate("WEB-REC-005", { ...context, communications: [recruitment, registrant] });
  assert.equal(result.status, "fail");
  assert.equal(result.reason, "invalid_context");
  assert.deepEqual(result.evidence, ["Duplicate communication ID: duplicate-communication."]);
});

for (const audienceClass of ["internal", "test"] as const) {
  test(`REC-008 and FU-INT-001 exclude ${audienceClass} non-omitted recruitment`, () => {
    const context = { ...makeContext(), participant: makeParticipant({ audienceClass }) };
    for (const id of ["WEB-REC-008", "WEB-FU-INT-001"] as const) {
      expectStatus(id, context, "pass");
      for (const state of ["planned", "recorded"] as const) {
        expectStatus(id, { ...context, communications: [makeCommunication({ state })] }, "fail");
      }
      expectStatus(id, { ...context, communications: [makeCommunication({ state: "omitted" })] }, "pass");
      expectStatus(id, { ...context, participant: null }, "evidence_unavailable");
      expectStatus(id, makeContext(), "not_applicable");
    }
  });
  test(`FU-INT-001 excludes ${audienceClass} follow-up, attendance and reporting`, () => {
    const context = { ...makeContext(), participant: makeParticipant({ audienceClass }) };
    for (const state of ["planned", "recorded"] as const) {
      expectStatus("WEB-FU-INT-001", { ...context, communications: [makeCommunication({ kind: "follow_up", state })] }, "fail");
    }
    expectStatus("WEB-FU-INT-001", { ...context, communications: [makeCommunication({ kind: "follow_up", state: "omitted" })] }, "pass");
    for (const field of ["includedInAttendance", "includedInReporting"] as const) {
      for (const value of [true, null]) {
        expectStatus("WEB-FU-INT-001", { ...context, participant: makeParticipant({ audienceClass, [field]: value }) }, value === null ? "evidence_unavailable" : "fail");
      }
    }
  });
}

test("REC-011 compares planned timestamps with the caller's observation", () => {
  const context = makeContext();
  for (const kind of ["recruitment", "registrant", "follow_up"] as const) {
    for (const scheduledAtEpochMs of [referenceTime, referenceTime + 1]) {
      expectStatus("WEB-REC-011", { ...context, communications: [makeCommunication({ kind, scheduledAtEpochMs })] }, "pass");
    }
    for (const scheduledAtEpochMs of [referenceTime - 1, null, NaN, Infinity, -Infinity]) {
      expectStatus("WEB-REC-011", { ...context, communications: [makeCommunication({ kind, scheduledAtEpochMs })] }, scheduledAtEpochMs === null ? "evidence_unavailable" : "fail");
    }
  }
});

test("REC-011 evaluates recorded history against recordedAt, not now, and ignores omitted", () => {
  const context = makeContext();
  const communication = makeCommunication({ state: "recorded", recordedAtEpochMs: referenceTime - 200, scheduledAtEpochMs: referenceTime - 100 });
  expectStatus("WEB-REC-011", { ...context, communications: [communication] }, "pass");
  expectStatus("WEB-REC-011", { ...context, communications: [{ ...communication, scheduledAtEpochMs: referenceTime - 201 }] }, "fail");
  for (const recordedAtEpochMs of [null, NaN, Infinity]) {
    expectStatus("WEB-REC-011", { ...context, communications: [{ ...communication, recordedAtEpochMs }] }, recordedAtEpochMs === null ? "evidence_unavailable" : "fail");
  }
  expectStatus("WEB-REC-011", { ...context, communications: [makeCommunication({ state: "omitted", scheduledAtEpochMs: null })] }, "pass");
});

test("WIN-006 prohibits planned recruitment once time or operational state says started", () => {
  const context = makeContext();
  expectStatus("WEB-WIN-006", { ...context, communications: [makeCommunication()] }, "not_applicable");
  for (const event of [
    { ...context.event, operationalStatus: "in_progress" as const },
    { ...context.event, operationalStatus: "completed" as const },
    { ...context.event, startsAtEpochMs: referenceTime },
    { ...context.event, startsAtEpochMs: referenceTime - 1 },
  ]) {
    expectStatus("WEB-WIN-006", { ...context, event }, "pass");
    expectStatus("WEB-WIN-006", { ...context, event, communications: [makeCommunication()] }, "fail");
    expectStatus("WEB-WIN-006", { ...context, event, communications: [makeCommunication({ state: "omitted" })] }, "pass");
  }
});

test("WIN-006 permits pre-start history but not recorded recruitment created at/after start", () => {
  const context = makeContext();
  const event = { ...context.event, operationalStatus: "completed" as const, startsAtEpochMs: referenceTime - 100 };
  for (const createdAtEpochMs of [referenceTime - 100, referenceTime, null, NaN, Infinity]) {
    expectStatus("WEB-WIN-006", { ...context, event, communications: [makeCommunication({ state: "recorded", createdAtEpochMs })] }, createdAtEpochMs === null ? "evidence_unavailable" : "fail");
  }
  expectStatus("WEB-WIN-006", { ...context, event, communications: [makeCommunication({ state: "recorded", createdAtEpochMs: referenceTime - 101 })] }, "pass");
  expectStatus("WEB-WIN-006", { ...context, event: { ...context.event, startsAtEpochMs: null } }, "evidence_unavailable");
});

test("FU-VAR-001 requires distinct IDs, content and positive human evidence; shared destination is valid", () => {
  const context = makeContext();
  const { attended, absent } = context.followUp;
  assert.ok(attended && absent);
  assert.equal(attended.destinationId, absent.destinationId);
  expectStatus("WEB-FU-VAR-001", context, "pass");
  for (const changed of [
    { ...absent, variantId: attended.variantId },
    { ...absent, messageContent: attended.messageContent },
    { ...absent, messageContent: " " },
    { ...absent, variantId: "" },
  ]) {
    expectStatus("WEB-FU-VAR-001", { ...context, followUp: { ...context.followUp, absent: changed } }, !changed.variantId.trim() || !changed.messageContent.trim() ? "evidence_unavailable" : "fail");
  }
  for (const distinctContentConfirmation of [null, { confirmed: false, evidence: "Not distinct." }, { confirmed: true, evidence: " " }]) {
    expectStatus("WEB-FU-VAR-001", { ...context, followUp: { ...context.followUp, distinctContentConfirmation } }, !distinctContentConfirmation?.evidence.trim() ? "evidence_unavailable" : "fail");
  }
  for (const followUp of [{ ...context.followUp, attended: null }, { ...context.followUp, absent: null }]) {
    expectStatus("WEB-FU-VAR-001", { ...context, followUp }, "not_applicable");
  }
});

test("FU-UNK-002 checks only the selected unknown participant, not unrelated people", () => {
  const context = makeContext();
  const attended = makeCommunication({ kind: "follow_up", variant: "attended" });
  const absent = makeCommunication({ communicationId: "absent-message", kind: "follow_up", variant: "absent" });
  expectStatus("WEB-FU-UNK-002", context, "pass");
  expectStatus("WEB-FU-UNK-002", { ...context, communications: [attended] }, "pass");
  for (const state of ["planned", "recorded"] as const) {
    expectStatus("WEB-FU-UNK-002", { ...context, communications: [{ ...attended, state }, { ...absent, state }] }, "fail");
  }
  expectStatus("WEB-FU-UNK-002", { ...context, communications: [attended, { ...absent, recipientIds: ["someone-else"] }] }, "pass");
  expectStatus("WEB-FU-UNK-002", { ...context, communications: [attended, { ...absent, state: "omitted" }] }, "pass");
  for (const attendanceState of ["attended", "absent"] as const) {
    expectStatus("WEB-FU-UNK-002", { ...context, participant: makeParticipant({ attendanceState }), communications: [attended, absent] }, "not_applicable");
  }
  expectStatus("WEB-FU-UNK-002", { ...context, participant: null }, "evidence_unavailable");
});

for (const [ruleId, field] of [
  ["WEB-QA-003", "registrationFlowTest"],
  ["WEB-RDY-REC-002", "registrationFlowTest"],
  ["WEB-QA-004", "joinLinkOrVenueTest"],
  ["WEB-RDY-RUN-001", "joinLinkOrVenueTest"],
] as const) {
  test(`${ruleId} requires affirmative human confirmation with nonempty evidence`, () => {
    const context = makeContext();
    expectStatus(ruleId, context, "pass");
    for (const confirmation of [null, { confirmed: false, evidence: "Test failed." }, { confirmed: true, evidence: "" }, { confirmed: true, evidence: " \n " }]) {
      expectStatus(ruleId, { ...context, [field]: confirmation }, !confirmation?.evidence.trim() ? "evidence_unavailable" : "fail");
    }
  });
}

test("SETUP-C07 handles required, not required, unknown, missing language and missing confirmation", () => {
  const context = makeContext();
  expectStatus("WEB-SETUP-C07", context, "pass");
  expectStatus("WEB-SETUP-C07", { ...context, consent: { required: false, languageAttached: null, confirmation: null } }, "not_applicable");
  expectStatus("WEB-SETUP-C07", { ...context, consent: { ...context.consent, required: null } }, "evidence_unavailable");
  for (const languageAttached of [false, null]) {
    expectStatus("WEB-SETUP-C07", { ...context, consent: { ...context.consent, languageAttached } }, languageAttached === null ? "evidence_unavailable" : "fail");
  }
  for (const confirmation of [null, { confirmed: false, evidence: "Rejected." }, { confirmed: true, evidence: " " }]) {
    expectStatus("WEB-SETUP-C07", { ...context, consent: { ...context.consent, confirmation } }, !confirmation?.evidence.trim() ? "evidence_unavailable" : "fail");
  }
});

test("QA-005 requires foundation-verified nonempty UTM for every applicable communication", () => {
  const context = makeContext();
  const communication = makeCommunication();
  expectStatus("WEB-QA-005", { ...context, communications: [communication] }, "pass");
  for (const utm of [null, { value: "x", source: "manual" as const, verified: true }, { value: "x", source: "other" as const, verified: true }, { value: "x", source: "foundation" as const, verified: false }, { value: " ", source: "foundation" as const, verified: true }]) {
    expectStatus("WEB-QA-005", { ...context, communications: [communication, makeCommunication({ communicationId: "bad-utm", utm })] }, !utm?.value.trim() ? "evidence_unavailable" : "fail");
  }
  expectStatus("WEB-QA-005", { ...context, communications: [makeCommunication({ utmRequired: null })] }, "evidence_unavailable");
  expectStatus("WEB-QA-005", { ...context, communications: [makeCommunication({ utmRequired: false, utm: null })] }, "pass");
});

test("QA-006 requires a foundation-generated, verified, nonempty internal name", () => {
  const context = makeContext();
  expectStatus("WEB-QA-006", context, "pass");
  for (const internalName of [null, { value: "name", source: "manual" as const, verified: true }, { value: "name", source: "other" as const, verified: true }, { value: "name", source: "foundation" as const, verified: false }, { value: " ", source: "foundation" as const, verified: true }]) {
    expectStatus("WEB-QA-006", { ...context, governance: { ...context.governance, internalName } }, !internalName?.value.trim() ? "evidence_unavailable" : "fail");
  }
});

test("RDY-REC-008 strictly requires every governed name, campaign code, taxonomy and applicable UTM", () => {
  const context = makeContext();
  expectStatus("WEB-RDY-REC-008", context, "pass");
  expectStatus("WEB-RDY-REC-008", { ...context, communications: [makeCommunication()] }, "pass");
  for (const field of ["internalName", "campaignCode"] as const) {
    for (const value of [null, { value: "x", source: "manual" as const, verified: true }, { value: "x", source: "foundation" as const, verified: false }, { value: " ", source: "foundation" as const, verified: true }]) {
      expectStatus("WEB-RDY-REC-008", { ...context, governance: { ...context.governance, [field]: value } }, !value?.value.trim() ? "evidence_unavailable" : "fail");
    }
  }
  for (const taxonomyValues of [null, [], [{ value: "x", source: "manual" as const, verified: true }], [{ value: "x", source: "foundation" as const, verified: false }], [{ value: "", source: "foundation" as const, verified: true }]]) {
    expectStatus("WEB-RDY-REC-008", { ...context, governance: { ...context.governance, taxonomyValues } }, !taxonomyValues?.[0]?.value.trim() ? "evidence_unavailable" : "fail");
  }
  for (const communication of [makeCommunication({ utm: null }), makeCommunication({ utmRequired: null }), makeCommunication({ utm: { value: "x", source: "manual", verified: true } })]) {
    expectStatus("WEB-RDY-REC-008", { ...context, communications: [communication] }, communication.utm === null || communication.utmRequired === null ? "evidence_unavailable" : "fail");
  }
  expectStatus("WEB-RDY-REC-008", { ...context, communications: [makeCommunication({ utmRequired: false, utm: null })] }, "pass");
});