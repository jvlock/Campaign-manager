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
  expectStatus("WEB-REC-005", { ...context, participant: null }, "fail");
  expectStatus("WEB-REC-005", { ...context, communications: [makeCommunication({ recipientIds: ["other-person"] }), makeCommunication({ kind: "registrant" })] }, "pass");
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
      expectStatus(id, { ...context, participant: null }, "fail");
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
        expectStatus("WEB-FU-INT-001", { ...context, participant: makeParticipant({ audienceClass, [field]: value }) }, "fail");
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
      expectStatus("WEB-REC-011", { ...context, communications: [makeCommunication({ kind, scheduledAtEpochMs })] }, "fail");
    }
  }
});

test("REC-011 evaluates recorded history against recordedAt, not now, and ignores omitted", () => {
  const context = makeContext();
  const communication = makeCommunication({ state: "recorded", recordedAtEpochMs: referenceTime - 200, scheduledAtEpochMs: referenceTime - 100 });
  expectStatus("WEB-REC-011", { ...context, communications: [communication] }, "pass");
  expectStatus("WEB-REC-011", { ...context, communications: [{ ...communication, scheduledAtEpochMs: referenceTime - 201 }] }, "fail");
  for (const recordedAtEpochMs of [null, NaN, Infinity]) {
    expectStatus("WEB-REC-011", { ...context, communications: [{ ...communication, recordedAtEpochMs }] }, "fail");
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
    expectStatus("WEB-WIN-006", { ...context, event, communications: [makeCommunication({ state: "recorded", createdAtEpochMs })] }, "fail");
  }
  expectStatus("WEB-WIN-006", { ...context, event, communications: [makeCommunication({ state: "recorded", createdAtEpochMs: referenceTime - 101 })] }, "pass");
  expectStatus("WEB-WIN-006", { ...context, event: { ...context.event, startsAtEpochMs: null } }, "fail");
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
    expectStatus("WEB-FU-VAR-001", { ...context, followUp: { ...context.followUp, absent: changed } }, "fail");
  }
  for (const distinctContentConfirmation of [null, { confirmed: false, evidence: "Not distinct." }, { confirmed: true, evidence: " " }]) {
    expectStatus("WEB-FU-VAR-001", { ...context, followUp: { ...context.followUp, distinctContentConfirmation } }, "fail");
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
  expectStatus("WEB-FU-UNK-002", { ...context, participant: null }, "fail");
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
      expectStatus(ruleId, { ...context, [field]: confirmation }, "fail");
    }
  });
}

test("SETUP-C07 handles required, not required, unknown, missing language and missing confirmation", () => {
  const context = makeContext();
  expectStatus("WEB-SETUP-C07", context, "pass");
  expectStatus("WEB-SETUP-C07", { ...context, consent: { required: false, languageAttached: null, confirmation: null } }, "not_applicable");
  expectStatus("WEB-SETUP-C07", { ...context, consent: { ...context.consent, required: null } }, "fail");
  for (const languageAttached of [false, null]) {
    expectStatus("WEB-SETUP-C07", { ...context, consent: { ...context.consent, languageAttached } }, "fail");
  }
  for (const confirmation of [null, { confirmed: false, evidence: "Rejected." }, { confirmed: true, evidence: " " }]) {
    expectStatus("WEB-SETUP-C07", { ...context, consent: { ...context.consent, confirmation } }, "fail");
  }
});

test("QA-005 requires foundation-verified nonempty UTM for every applicable communication", () => {
  const context = makeContext();
  const communication = makeCommunication();
  expectStatus("WEB-QA-005", { ...context, communications: [communication] }, "pass");
  for (const utm of [null, { value: "x", source: "manual" as const, verified: true }, { value: "x", source: "other" as const, verified: true }, { value: "x", source: "foundation" as const, verified: false }, { value: " ", source: "foundation" as const, verified: true }]) {
    expectStatus("WEB-QA-005", { ...context, communications: [communication, makeCommunication({ communicationId: "bad-utm", utm })] }, "fail");
  }
  expectStatus("WEB-QA-005", { ...context, communications: [makeCommunication({ utmRequired: null })] }, "fail");
  expectStatus("WEB-QA-005", { ...context, communications: [makeCommunication({ utmRequired: false, utm: null })] }, "pass");
});

test("QA-006 requires a foundation-generated, verified, nonempty internal name", () => {
  const context = makeContext();
  expectStatus("WEB-QA-006", context, "pass");
  for (const internalName of [null, { value: "name", source: "manual" as const, verified: true }, { value: "name", source: "other" as const, verified: true }, { value: "name", source: "foundation" as const, verified: false }, { value: " ", source: "foundation" as const, verified: true }]) {
    expectStatus("WEB-QA-006", { ...context, governance: { ...context.governance, internalName } }, "fail");
  }
});

test("RDY-REC-008 strictly requires every governed name, campaign code, taxonomy and applicable UTM", () => {
  const context = makeContext();
  expectStatus("WEB-RDY-REC-008", context, "pass");
  expectStatus("WEB-RDY-REC-008", { ...context, communications: [makeCommunication()] }, "pass");
  for (const field of ["internalName", "campaignCode"] as const) {
    for (const value of [null, { value: "x", source: "manual" as const, verified: true }, { value: "x", source: "foundation" as const, verified: false }, { value: " ", source: "foundation" as const, verified: true }]) {
      expectStatus("WEB-RDY-REC-008", { ...context, governance: { ...context.governance, [field]: value } }, "fail");
    }
  }
  for (const taxonomyValues of [null, [], [{ value: "x", source: "manual" as const, verified: true }], [{ value: "x", source: "foundation" as const, verified: false }], [{ value: "", source: "foundation" as const, verified: true }]]) {
    expectStatus("WEB-RDY-REC-008", { ...context, governance: { ...context.governance, taxonomyValues } }, "fail");
  }
  for (const communication of [makeCommunication({ utm: null }), makeCommunication({ utmRequired: null }), makeCommunication({ utm: { value: "x", source: "manual", verified: true } })]) {
    expectStatus("WEB-RDY-REC-008", { ...context, communications: [communication] }, "fail");
  }
  expectStatus("WEB-RDY-REC-008", { ...context, communications: [makeCommunication({ utmRequired: false, utm: null })] }, "pass");
});