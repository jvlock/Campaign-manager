import assert from "node:assert/strict";
import { test } from "node:test";
import { addBusinessDays } from "../../src/lib/webinar-standard-planning-time/business-days";
import { createCompletionFollowUpEvaluators } from "../../src/lib/webinar-standard-evaluation/completion-follow-up";
import type { FollowUpCompletionContext, FollowUpSendObservation } from "../../src/lib/webinar-standard-evaluation/completion-follow-up-types";
import type { EvaluationContext } from "../../src/lib/webinar-standard-evaluation/types";
import { catalog, makeContext, makeParticipant } from "./fixtures";

const end = Date.parse("2030-01-04T17:00:00Z"); // Friday
const observed = end + 10 * 86_400_000;
const evaluators = createCompletionFollowUpEvaluators(catalog);

function follow(overrides: Partial<FollowUpCompletionContext> = {}): FollowUpCompletionContext {
  return {
    standardId: catalog.standardId, standardVersion: catalog.standardVersion, eventId: "event-1",
    occurrenceId: "occurrence-1", snapshotId: "follow-up-snapshot", observedAtEpochMs: observed,
    timeZone: "UTC", actualEventEndAtEpochMs: end, participantId: "participant-1",
    attendanceState: "attended", plannedFollowUp: null, sends: [], reconciliation: null,
    neutralVariantApproved: false, evidence: ["review-1"], ...overrides,
  };
}
function context(f: FollowUpCompletionContext, attendanceState = f.attendanceState): EvaluationContext {
  return { ...makeContext(), observedAtEpochMs: f.observedAtEpochMs,
    event: { ...makeContext().event, eventId: "event-1", operationalStatus: "completed" },
    participant: makeParticipant({ attendanceState }), completionFollowUp: Object.freeze(f) };
}
function send(variant: FollowUpSendObservation["variant"], atEpochMs: number | null,
  overrides: Partial<FollowUpSendObservation> = {}): FollowUpSendObservation {
  return { communicationId: `${variant}-communication`, participantId: "participant-1",
    variant, state: "sent", atEpochMs, evidenceId: `${variant}-evidence`, ...overrides };
}
function status(id: keyof typeof evaluators, f: FollowUpCompletionContext, state = f.attendanceState) {
  return evaluators[id](context(f, state));
}

test("ATT-001 passes exactly at the one-business-day deadline", () => {
  const due = addBusinessDays(end, "UTC", 1).epochMs;
  assert.equal(status("WEB-FU-ATT-001", follow({ sends: [send("attended", due)] })).status, "pass");
});
test("ATT-001 distinguishes just-before, just-after, and absent variant", () => {
  const due = addBusinessDays(end, "UTC", 1).epochMs;
  assert.equal(status("WEB-FU-ATT-001", follow({ sends: [send("attended", due - 1)] })).status, "pass");
  assert.equal(status("WEB-FU-ATT-001", follow({ sends: [send("attended", due + 1)] })).status, "fail");
  assert.equal(status("WEB-FU-ATT-001", follow({ sends: [send("absent", due)] })).status, "evidence_unavailable");
});
test("ABS-001 uses actual event end, not delayed attendance availability", () => {
  const due = addBusinessDays(end, "UTC", 1).epochMs;
  const f = follow({ attendanceState: "absent", sends: [send("absent", due)] });
  assert.equal(status("WEB-FU-ABS-001", f).status, "pass");
  assert.equal(status("WEB-FU-ABS-001", { ...f, sends: [send("absent", due + 86_400_000)] }).status, "fail");
});
test("follow-up deadlines honor Friday weekend and IANA DST boundaries", () => {
  const fridayDue = addBusinessDays(end, "America/New_York", 1).epochMs;
  assert.equal(status("WEB-FU-ATT-001", follow({
    timeZone: "America/New_York", sends: [send("attended", fridayDue)],
  })).status, "pass");
  const dstEnd = Date.parse("2024-03-08T17:00:00Z");
  const dstDue = addBusinessDays(dstEnd, "America/New_York", 1).epochMs;
  assert.equal(status("WEB-FU-ATT-001", follow({
    timeZone: "America/New_York", actualEventEndAtEpochMs: dstEnd,
    observedAtEpochMs: dstDue, sends: [send("attended", dstDue)],
  })).status, "pass");
});
test("ATT/ABS report unavailable when actual end or actual send evidence is missing", () => {
  assert.equal(status("WEB-FU-ATT-001", follow({ actualEventEndAtEpochMs: null })).status, "evidence_unavailable");
  assert.equal(status("WEB-FU-ABS-001", follow({ attendanceState: "absent" })).status, "evidence_unavailable");
  assert.equal(status("WEB-FU-ABS-001", follow({
    attendanceState: "absent", sends: [send("absent", null)],
  })).status, "evidence_unavailable");
});
test("follow-up observations cannot use another participant or both variants", () => {
  assert.equal(status("WEB-FU-ATT-001", follow({
    sends: [send("attended", end, { participantId: "someone-else" })],
  })).status, "fail"); // invalid scope is rejected before applicability
  assert.equal(status("WEB-FU-ATT-001", follow({
    sends: [send("attended", end), send("absent", end)],
  })).status, "fail");
});
test("UNK-001 requires reconciliation and prohibits attended/absent treatment while unknown", () => {
  assert.equal(status("WEB-FU-UNK-001", follow({
    attendanceState: "unknown", reconciliation: null,
  }), "unknown").status, "evidence_unavailable");
  assert.equal(status("WEB-FU-UNK-001", follow({
    attendanceState: "unknown",
    reconciliation: { participantId: "participant-1", attendanceState: "unknown", reconciledAtEpochMs: null, evidenceId: "reconcile-1" },
  }), "unknown").status, "pass");
  assert.equal(status("WEB-FU-UNK-001", follow({
    attendanceState: "unknown",
    reconciliation: { participantId: "participant-1", attendanceState: "unknown", reconciledAtEpochMs: null, evidenceId: "reconcile-1" },
    sends: [send("attended", end)],
  }), "unknown").status, "fail");
});
test("UNK-001 rejects an untimestamped attended reconciliation before checking contradictory variants", () => {
  const result = status("WEB-FU-UNK-001", follow({
    attendanceState: "unknown",
    reconciliation: { participantId: "participant-1", attendanceState: "attended", reconciledAtEpochMs: null, evidenceId: "reconcile-1" },
    sends: [send("attended", end), send("absent", end)],
  }), "unknown");
  assert.equal(result.status, "fail");
  assert.equal(result.reason, "violation");
});
test("UNK-003 neutral eligibility is before/at/after the two-business-day boundary", () => {
  const threshold = addBusinessDays(end, "UTC", 2).epochMs;
  const base = follow({ attendanceState: "unknown", neutralVariantApproved: true,
    reconciliation: { participantId: "participant-1", attendanceState: "unknown", reconciledAtEpochMs: null, evidenceId: "reconcile-1" } });
  assert.equal(status("WEB-FU-UNK-003", { ...base, observedAtEpochMs: threshold - 1 }, "unknown").status, "not_applicable");
  assert.equal(status("WEB-FU-UNK-003", { ...base, observedAtEpochMs: threshold }, "unknown").status, "evidence_unavailable");
  assert.equal(status("WEB-FU-UNK-003", { ...base, observedAtEpochMs: threshold + 1,
    sends: [send("neutral", threshold + 1)] }, "unknown").status, "pass");
});
test("UNK-003 suppresses neutral eligibility after historical attendance reconciliation", () => {
  const threshold = addBusinessDays(end, "UTC", 2).epochMs;
  const f = follow({ attendanceState: "unknown", observedAtEpochMs: threshold + 1,
    neutralVariantApproved: true,
    reconciliation: { participantId: "participant-1", attendanceState: "attended", reconciledAtEpochMs: threshold - 1, evidenceId: "history-1" } });
  assert.equal(status("WEB-FU-UNK-003", f, "unknown").status, "not_applicable");
});
test("UNK-003 suppresses a neutral obligation after late attended reconciliation", () => {
  const threshold = addBusinessDays(end, "UTC", 2).epochMs;
  const result = status("WEB-FU-UNK-003", follow({
    attendanceState: "unknown", observedAtEpochMs: threshold + 86_400_000,
    neutralVariantApproved: true,
    reconciliation: { participantId: "participant-1", attendanceState: "attended", reconciledAtEpochMs: threshold + 1, evidenceId: "late-reconcile" },
  }), "unknown");
  assert.equal(result.status, "not_applicable");
});
test("invalid provenance is rejected and evaluation does not mutate readonly observations", () => {
  const f = follow({ sends: [send("attended", end)] });
  const before = structuredClone(f);
  assert.equal(status("WEB-FU-ATT-001", { ...f, standardVersion: "wrong-version" as never }).reason, "invalid_context");
  assert.deepEqual(f, before);
  assert.equal(Object.isFrozen(context(f).completionFollowUp), true);
});
test("exception evidence remains separate and cannot substitute for an actual follow-up observation", () => {
  const findingWithException = follow({ evidence: ["exception-record-valid", "originating-rule-failed"] });
  const result = status("WEB-FU-ATT-001", findingWithException);
  assert.equal(result.status, "evidence_unavailable");
  assert.equal(result.reason, "missing_evidence");
});
test("pre-event actual sends are invalid rather than early passes", () => {
  const result = status("WEB-FU-ATT-001", follow({ sends: [send("attended", end - 1)] }));
  assert.equal(result.status, "fail");
  assert.equal(result.reason, "invalid_context");
});
test("neutral sends before the two-business-day boundary fail even when eligibility is approved", () => {
  const threshold = addBusinessDays(end, "UTC", 2).epochMs;
  const result = status("WEB-FU-UNK-003", follow({
    attendanceState: "unknown", observedAtEpochMs: threshold + 1, neutralVariantApproved: true,
    reconciliation: { participantId: "participant-1", attendanceState: "unknown", reconciledAtEpochMs: null, evidenceId: "reconcile-1" },
    sends: [send("neutral", threshold - 1)],
  }), "unknown");
  assert.equal(result.status, "fail");
});
test("wrong occurrence and invalid IANA timezone are invalid context", () => {
  assert.equal(status("WEB-FU-ATT-001", follow({ occurrenceId: "" })).reason, "invalid_context");
  assert.equal(status("WEB-FU-ATT-001", follow({ timeZone: "Not/IANA" })).reason, "invalid_context");
});
test("future reconciliation and send observations cannot be accepted", () => {
  assert.equal(status("WEB-FU-ATT-001", follow({ sends: [send("attended", observed + 1)] })).reason, "invalid_context");
  assert.equal(status("WEB-FU-UNK-001", follow({
    attendanceState: "unknown",
    reconciliation: { participantId: "participant-1", attendanceState: "unknown", reconciledAtEpochMs: observed + 1, evidenceId: "reconcile-1" },
  }), "unknown").reason, "invalid_context");
});
test("missing and blank operational evidence identifiers remain unavailable or invalid", () => {
  const missingEvidence = follow({ sends: [send("attended", end, { evidenceId: "" })] });
  assert.equal(status("WEB-FU-ATT-001", missingEvidence).reason, "missing_evidence");
  const missingReconciliationEvidence = follow({
    attendanceState: "unknown",
    reconciliation: { participantId: "participant-1", attendanceState: "unknown", reconciledAtEpochMs: null, evidenceId: "" },
  });
  assert.equal(status("WEB-FU-UNK-001", missingReconciliationEvidence, "unknown").reason, "missing_evidence");
});

test("ATT-001 weekday exact deadline is passing", () => {
  const due = addBusinessDays(end, "UTC", 1).epochMs;
  assert.equal(status("WEB-FU-ATT-001", follow({ sends: [send("attended", due)] })).status, "pass");
});
test("ATT-001 Friday weekend boundary is passing", () => {
  assert.equal(status("WEB-FU-ATT-001", follow({ sends: [send("attended", addBusinessDays(end, "UTC", 1).epochMs)] })).status, "pass");
});
test("ATT-001 just before deadline is passing", () => {
  assert.equal(status("WEB-FU-ATT-001", follow({ sends: [send("attended", addBusinessDays(end, "UTC", 1).epochMs - 1)] })).status, "pass");
});
test("ATT-001 just after deadline is failing", () => {
  assert.equal(status("WEB-FU-ATT-001", follow({ sends: [send("attended", addBusinessDays(end, "UTC", 1).epochMs + 1)] })).status, "fail");
});
test("ATT-001 event timezone and DST boundary are honored", () => {
  const dstEnd = Date.parse("2024-03-08T17:00:00Z");
  const due = addBusinessDays(dstEnd, "America/New_York", 1).epochMs;
  assert.equal(status("WEB-FU-ATT-001", follow({ actualEventEndAtEpochMs: dstEnd, timeZone: "America/New_York", observedAtEpochMs: due, sends: [send("attended", due)] })).status, "pass");
});
test("ABS-001 weekday exact deadline is passing", () => {
  assert.equal(status("WEB-FU-ABS-001", follow({ attendanceState: "absent", sends: [send("absent", addBusinessDays(end, "UTC", 1).epochMs)] })).status, "pass");
});
test("ABS-001 just before deadline is passing", () => {
  assert.equal(status("WEB-FU-ABS-001", follow({ attendanceState: "absent", sends: [send("absent", addBusinessDays(end, "UTC", 1).epochMs - 1)] })).status, "pass");
});
test("ABS-001 just after deadline is failing", () => {
  assert.equal(status("WEB-FU-ABS-001", follow({ attendanceState: "absent", sends: [send("absent", addBusinessDays(end, "UTC", 1).epochMs + 1)] })).status, "fail");
});
test("ABS-001 timezone weekend boundary is honored", () => {
  const due = addBusinessDays(end, "America/New_York", 1).epochMs;
  assert.equal(status("WEB-FU-ABS-001", follow({ attendanceState: "absent", timeZone: "America/New_York", sends: [send("absent", due)] })).status, "pass");
});
test("ATT-001 missing actual end is unavailable", () => {
  assert.equal(status("WEB-FU-ATT-001", follow({ actualEventEndAtEpochMs: null })).status, "evidence_unavailable");
});
test("ABS-001 wrong participant and wrong variant are not accepted", () => {
  assert.equal(status("WEB-FU-ABS-001", follow({ attendanceState: "absent", sends: [send("absent", end, { participantId: "other" })] })).reason, "invalid_context");
  assert.equal(status("WEB-FU-ABS-001", follow({ attendanceState: "absent", sends: [send("attended", end)] })).status, "evidence_unavailable");
});
test("ATT and ABS shared destination does not collapse variants", () => {
  const due = addBusinessDays(end, "UTC", 1).epochMs;
  assert.equal(status("WEB-FU-ATT-001", follow({ sends: [send("attended", due)] })).status, "pass");
  assert.equal(status("WEB-FU-ABS-001", follow({ attendanceState: "absent", sends: [send("absent", due)] })).status, "pass");
});
test("UNK-003 exact threshold remains no-send evidence", () => {
  const threshold = addBusinessDays(end, "UTC", 2).epochMs;
  assert.equal(status("WEB-FU-UNK-003", follow({ attendanceState: "unknown", observedAtEpochMs: threshold, neutralVariantApproved: true, reconciliation: { participantId: "participant-1", attendanceState: "unknown", reconciledAtEpochMs: null, evidenceId: "r" } }), "unknown").status, "evidence_unavailable");
});
test("UNK-001 later absent reconciliation is passing only with timestamp", () => {
  assert.equal(status("WEB-FU-UNK-001", follow({ attendanceState: "unknown", reconciliation: { participantId: "participant-1", attendanceState: "absent", reconciledAtEpochMs: end + 1, evidenceId: "r" } }), "unknown").status, "pass");
});
test("UNK-001 contradictory attended and absent evidence is failing", () => {
  assert.equal(status("WEB-FU-UNK-001", follow({ attendanceState: "unknown", reconciliation: { participantId: "participant-1", attendanceState: "unknown", reconciledAtEpochMs: null, evidenceId: "r" }, sends: [send("attended", end), send("absent", end)] }), "unknown").status, "fail");
});
test("UNK-001 reconciliation before attended treatment is passing", () => {
  assert.equal(status("WEB-FU-UNK-001", follow({
    attendanceState: "unknown",
    reconciliation: { participantId: "participant-1", attendanceState: "attended", reconciledAtEpochMs: end, evidenceId: "r" },
    sends: [send("attended", end + 1)],
  }), "unknown").status, "pass");
});
test("UNK-001 reconciliation equal to attended treatment is passing", () => {
  assert.equal(status("WEB-FU-UNK-001", follow({
    attendanceState: "unknown",
    reconciliation: { participantId: "participant-1", attendanceState: "attended", reconciledAtEpochMs: end + 1, evidenceId: "r" },
    sends: [send("attended", end + 1)],
  }), "unknown").status, "pass");
});
test("UNK-001 reconciliation after attended treatment is failing", () => {
  assert.equal(status("WEB-FU-UNK-001", follow({
    attendanceState: "unknown",
    reconciliation: { participantId: "participant-1", attendanceState: "attended", reconciledAtEpochMs: end + 2, evidenceId: "r" },
    sends: [send("attended", end + 1)],
  }), "unknown").status, "fail");
});