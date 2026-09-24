import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompletionSnapshotContext } from "../../src/lib/webinar-standard-evaluation/completion-done-types";
import {
  COMPLETION_DONE_RULE_ID, deriveCompletionRegistryFingerprint, evaluateCompletionDone, evaluateCompletionDoneWithDiagnostics,
} from "../../src/lib/webinar-standard-evaluation/completion-done";
import { catalog, makeContext, referenceTime, registry } from "./fixtures";

test("concurrent completion diagnostics are invocation-local, including missing snapshots", async () => {
  const contexts = [
    { ...makeContext(), completionSnapshot: snapshot(completeResults()) },
    { ...makeContext(), completionSnapshot: snapshot(completeResults(), { eventId: "other-event" }) },
    makeContext(),
  ];
  const expected = contexts.map(context => evaluateCompletionDoneWithDiagnostics(catalog, context));
  const actual = await Promise.all(Array.from({ length: 90 }, async (_, index) => {
    await new Promise<void>(resolve => setImmediate(resolve));
    const result = evaluateCompletionDoneWithDiagnostics(catalog, contexts[index % 3]!);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(result, expected[index % 3]);
    assert.deepEqual(result.finding, evaluateCompletionDone(catalog, contexts[index % 3]!));
    return result;
  }));
  assert.equal(actual[0]!.projection.complete, true);
  assert.equal(actual[1]!.projection.outcome, "incomplete_invalid_context");
  assert.equal(actual[2]!.projection.outcome, "incomplete_evidence");
  assert.notEqual(actual[0]!.projection, actual[3]!.projection);
});

function snapshot(results: readonly unknown[], overrides: Partial<CompletionSnapshotContext> = {}): CompletionSnapshotContext {
  const fingerprint = deriveCompletionRegistryFingerprint(catalog);
  return {
    standardId: catalog.standardId, standardVersion: catalog.standardVersion, eventId: "event-1",
    occurrenceId: "occurrence-1", calculatedAtEpochMs: referenceTime,
    registryFingerprint: fingerprint,
    exceptionSnapshotId: "exceptions-1",
    canonicalRuleIds: catalog.rules.map(rule => rule.ruleId),
    results: results.map(result => ({ result: result as never, eventId: "event-1", occurrenceId: "occurrence-1",
      calculatedAtEpochMs: referenceTime, snapshotFingerprint: fingerprint,
      evidenceSnapshotId: "evidence-1", exceptionSnapshotId: "exceptions-1" })),
    exceptions: [], exceptionClaims: [],
    evidenceSnapshot: { snapshotId: "evidence-1", snapshotCompleteness: "complete", eventId: "event-1",
      occurrenceId: "occurrence-1", calculatedAtEpochMs: referenceTime, registryFingerprint: fingerprint },
    operationalObligations: {
      attendanceReconciliation: "resolved", requiredFollowUpCompletion: "resolved",
      exceptionRecording: "resolved", measurementCapture: "resolved",
    }, ...overrides,
  };
}
function completeResults() {
  const context = makeContext();
  return registry.entries.filter(entry => entry.ruleId !== COMPLETION_DONE_RULE_ID)
    .map(entry => {
      const result = entry.evaluate(context);
      // Preserve every canonical metadata field from the real registry result;
      // this only supplies a deliberately complete observation fixture.
      return { ...result, status: "pass" as const, reason: "satisfied" as const };
    });
}
function evaluate(overrides: Partial<CompletionSnapshotContext> = {}, results: readonly unknown[] = completeResults()) {
  const context = makeContext();
  return evaluateCompletionDone(catalog, { ...context, completionSnapshot: snapshot(results, overrides) });
}

test("complete snapshot validates exactly 105 canonical, metadata-valid prerequisites and excludes DONE", () => {
  const results = completeResults();
  assert.equal(results.length, 105);
  assert.equal(evaluate({}, results).status, "pass");
  assert.equal(results.some(result => result.ruleId === COMPLETION_DONE_RULE_ID), false);
});

test("snapshot rejects wrong standard/version, occurrence scope, stale time, and registry fingerprint", () => {
  assert.equal(evaluate({ standardId: "WEB-STANDARD-001" as never, standardVersion: "wrong" as never }).reason, "invalid_context");
  assert.equal(evaluate({ eventId: "other-event" }).reason, "invalid_context");
  assert.equal(evaluate({ calculatedAtEpochMs: referenceTime - 1 }).reason, "invalid_context");
  assert.equal(evaluate({ registryFingerprint: "stale" }).reason, "invalid_context");
});

test("snapshot rejects duplicate, unknown, missing, invalid, unavailable, and self results", () => {
  const results = completeResults();
  assert.equal(evaluate({}, [...results, results[0]]).reason, "invalid_context");
  assert.equal(evaluate({}, [...results, { ruleId: "WEB-UNKNOWN-001" } as unknown]).reason, "invalid_context");
  assert.equal(evaluate({}, results.slice(1)).reason, "invalid_context");
  const bad = { ...results[0], standardVersion: "wrong" } as unknown;
  assert.equal(evaluate({}, [bad, ...results.slice(1)]).reason, "invalid_context");
  const self = { ...results[0] as object, ruleId: COMPLETION_DONE_RULE_ID };
  assert.equal(evaluate({}, [self, ...results.slice(1)]).reason, "invalid_context");
  const unavailable = results.map(result => result.rule.primaryRuleType === "Mandatory blocker"
    ? { ...result, status: "unimplemented", reason: "not_implemented" } : result);
  assert.equal(evaluate({}, unavailable).reason, "invalid_context");
});

test("real blocker, evidence gap, operational gap, and advisory remain distinct", () => {
  const results = completeResults();
  const blocker = results.map(result => result.rule.primaryRuleType === "Mandatory blocker"
    ? { ...result, status: "fail", reason: "violation" } : result);
  assert.equal(evaluate({}, blocker).status, "fail");
  const evidence = results.map(result => result.rule.primaryRuleType === "Mandatory blocker"
    ? { ...result, status: "evidence_unavailable", reason: "missing_evidence" } : result);
  assert.equal(evaluate({}, evidence).reason, "missing_evidence");
  assert.equal(evaluate({ operationalObligations: { attendanceReconciliation: "resolved",
    requiredFollowUpCompletion: "resolved", exceptionRecording: "resolved",
    measurementCapture: "unresolved" } }).reason, "violation");
  const advisory = results.map(result => !["Mandatory blocker", "Conditional blocker"].includes(result.rule.primaryRuleType)
    ? { ...result, status: "fail", reason: "violation" } : result);
  assert.equal(evaluate({}, advisory).status, "pass");
});

// Keep each material snapshot condition independently addressable in TAP.
test("snapshot exact canonical inventory", () => assert.equal(evaluate().status, "pass"));
test("snapshot duplicate result", () => assert.equal(evaluate({}, [...completeResults(), completeResults()[0]]).reason, "invalid_context"));
test("snapshot unknown result", () => assert.equal(evaluate({}, [...completeResults(), { ruleId: "WEB-UNKNOWN-001" } as never]).reason, "invalid_context"));
test("snapshot missing required result", () => assert.equal(evaluate({}, completeResults().slice(1)).reason, "invalid_context"));
test("snapshot foreign occurrence", () => assert.equal(evaluate({ occurrenceId: "other-occurrence" }).reason, "invalid_context"));
test("snapshot stale calculation instant", () => assert.equal(evaluate({ calculatedAtEpochMs: referenceTime - 1 }).reason, "invalid_context"));
test("snapshot wrong standard", () => assert.equal(evaluate({ standardId: "WRONG" as never }).reason, "invalid_context"));
test("snapshot wrong version", () => assert.equal(evaluate({ standardVersion: "WRONG" as never }).reason, "invalid_context"));
test("snapshot registry fingerprint mismatch", () => assert.equal(evaluate({ registryFingerprint: "wrong" }).reason, "invalid_context"));
test("snapshot evidence identity mismatch", () => assert.equal(evaluate({
  evidenceSnapshot: { snapshotId: "wrong", snapshotCompleteness: "complete", eventId: "event-1",
    occurrenceId: "occurrence-1", calculatedAtEpochMs: referenceTime,
    registryFingerprint: deriveCompletionRegistryFingerprint(catalog) },
}).reason, "invalid_context"));
test("snapshot exception identity mismatch", () => assert.equal(evaluate({ exceptionSnapshotId: "" }).reason, "invalid_context"));
test("blank evidence snapshot identity fails closed", () => assert.equal(evaluate({
  evidenceSnapshot: { snapshotId: " ", snapshotCompleteness: "complete", eventId: "event-1",
    occurrenceId: "occurrence-1", calculatedAtEpochMs: referenceTime,
    registryFingerprint: deriveCompletionRegistryFingerprint(catalog) },
}).reason, "invalid_context"));
test("blank envelope evidence identity fails closed", () => {
  const results = completeResults();
  const context = makeContext();
  const base = snapshot(results);
  const envelopes = base.results.map((envelope, index) => index === 0
    ? { ...envelope, evidenceSnapshotId: " " } : envelope);
  assert.equal(evaluateCompletionDone(catalog, { ...context, completionSnapshot: { ...base, results: envelopes } }).reason, "invalid_context");
});
test("evaluator unavailable prerequisite", () => {
  const results = completeResults().map(result => result.rule.primaryRuleType === "Mandatory blocker"
    ? { ...result, status: "unimplemented", reason: "not_implemented" } : result);
  assert.equal(evaluate({}, results).reason, "invalid_context");
});
test("invalid-context prerequisite", () => {
  const results = completeResults().map((result, index) => index === 0
    ? { ...result, status: "fail", reason: "invalid_context" } : result);
  assert.equal(evaluate({}, results).reason, "invalid_context");
});
test("missing blocker evidence", () => {
  const results = completeResults().map(result => result.rule.primaryRuleType === "Mandatory blocker"
    ? { ...result, status: "evidence_unavailable", reason: "missing_evidence" } : result);
  assert.equal(evaluate({}, results).reason, "missing_evidence");
});
test("mandatory blocker failure", () => {
  const results = completeResults().map(result => result.rule.primaryRuleType === "Mandatory blocker"
    ? { ...result, status: "fail", reason: "violation" } : result);
  assert.equal(evaluate({}, results).status, "fail");
});
test("conditional blocker failure", () => {
  const results = completeResults().map(result => result.rule.primaryRuleType === "Conditional blocker"
    ? { ...result, status: "fail", reason: "violation" } : result);
  assert.equal(evaluate({}, results).status, "fail");
});
test("valid exception resolution remains separately represented", () => {
  const target = catalog.rules.find(rule => rule.exceptionEligible)!;
  const now = referenceTime;
  const record = {
    exceptionId: "exception-done-1", standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    ruleId: target.ruleId, requirementOverridden: target.expectedBehavior,
    businessJustification: "The pilot audience requires a different approved operational sequence.",
    requestor: "Pilot requestor", reviewer: "Pilot reviewer", reviewerVerificationStatus: "unverified",
    decision: "approved", decisionAtEpochMs: now - 1_000, expiresAtEpochMs: now + 1_000,
    expirationRequired: true, compensatingAction: "Review the adapted sequence before operation.",
    compensatingActionRequired: true, createdAtEpochMs: now - 2_000,
    pilotAudit: { pilotReference: "pilot-done", auditReference: "audit-done" },
  };
  const results = completeResults().map(result => result.ruleId === target.ruleId
    ? { ...result, status: "fail", reason: "violation" } : result);
  assert.equal(evaluate({ exceptions: [record], exceptionClaims: [{ ruleId: target.ruleId, exceptionId: record.exceptionId }] }, results).status, "pass");
});
test("invalid exception claim remains blocking", () => {
  assert.equal(evaluate({
    exceptionClaims: [{ ruleId: "WEB-EXC-001", exceptionId: "missing" }],
  }).reason, "invalid_context");
});
for (const advisoryType of ["Warning", "Recommended default", "Optional"] as const) {
  test(`advisory ${advisoryType} failure remains visible and nonblocking`, () => {
    const results = completeResults().map(result => result.rule.primaryRuleType === advisoryType
      ? { ...result, status: "fail", reason: "violation" } : result);
    assert.equal(evaluate({}, results).status, "pass");
  });
  test(`advisory ${advisoryType} evidence gap remains visible and nonblocking`, () => {
    const results = completeResults().map(result => result.rule.primaryRuleType === advisoryType
      ? { ...result, status: "evidence_unavailable", reason: "missing_evidence" } : result);
    assert.equal(evaluate({}, results).status, "pass");
  });
}
test("missing operational obligation fails closed", () => {
  assert.equal(evaluate({ operationalObligations: {} as never }).reason, "violation");
});
test("truly complete occurrence passes only with all four operational obligations", () => {
  assert.equal(evaluate().status, "pass");
});
