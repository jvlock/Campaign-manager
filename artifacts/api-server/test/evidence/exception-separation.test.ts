import assert from "node:assert/strict";
import { test } from "node:test";
import { validateManualEvidence, type EvidenceValidationContext } from "../../src/lib/webinar-standard-evidence";
import { validateWebinarException } from "../../src/lib/webinar-standard-exceptions";
import { aggregateWebinarReadiness } from "../../src/lib/webinar-standard-readiness";
import { catalog, registry, referenceTime, makeContext } from "../evaluation/fixtures";
import { exception, input, stage } from "../readiness/fixtures";

// Exercise the existing, real distinct-variants evaluator: confirmation is only one
// input; evidence cannot override its independent content/identity comparison.
const ruleId = "WEB-FU-VAR-001";
const rule = catalog.rules.find(r => r.ruleId === ruleId)!;
const validation: EvidenceValidationContext = {
  catalog, nowEpochMs: referenceTime, expectedRuleId: ruleId,
  expectedScope: { eventId: "event-1", sessionIds: [], participantIds: [], communicationIds: [], deliverableIds: ["attended-1", "absent-1"] },
  expectedInputSnapshotVersion: "variants-v1", expectedArtifactVersion: "content-v1",
  referenceRequired: false,
};
function evidence(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: "variant-review-1", ruleId, standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    evidenceStatus: "confirmed", evidenceDescription: "Reviewed the configured attended and absent message content for distinctness.",
    suppliedBy: { nameOrPilotIdentifier: "pilot-reviewer", identityVerified: false },
    suppliedAtEpochMs: referenceTime - 10, validFromEpochMs: referenceTime - 10,
    expiresAtEpochMs: referenceTime + 100, sourceReference: null, attachmentReference: null,
    notes: "Both message variants were included in this review.", scope: validation.expectedScope,
    binding: { inputSnapshotVersion: "variants-v1", artifactVersion: "content-v1", reviewedAtEpochMs: referenceTime - 10, snapshotCompleteness: "complete", observationFromEpochMs: null, observationThroughEpochMs: null },
    ...overrides,
  };
}
function evaluate(raw: unknown, identicalContent = false) {
  const checked = validateManualEvidence(raw, validation);
  const context = makeContext();
  // Explicit rule-specific test adapter, not a generic production pass mapper.
  const confirmation = checked.ok && checked.evidence.binding.snapshotCompleteness === "complete"
    && ["confirmed", "rejected"].includes(checked.evidence.evidenceStatus)
    ? { confirmed: checked.evidence.evidenceStatus === "confirmed", evidence: checked.evidence.evidenceDescription }
    : null;
  return registry.evaluate(ruleId, {
    ...context,
    followUp: {
      ...context.followUp,
      absent: identicalContent ? { ...context.followUp.absent!, messageContent: context.followUp.attended!.messageContent } : context.followUp.absent,
      distinctContentConfirmation: confirmation,
    },
  });
}
function aggregate(result: ReturnType<typeof evaluate>, includeException: boolean) {
  const record = exception(rule);
  assert.equal(validateWebinarException(record, catalog, referenceTime, ruleId).ok, true);
  return stage(aggregateWebinarReadiness(catalog, registry, input({
    results: [result], exceptions: includeException ? [record] : [],
    exceptionClaims: includeException ? [{ ruleId, exceptionId: record.exceptionId }] : [],
  })), rule.readinessStage);
}
test("evidence supports rule evaluation through the actual registry", () => {
  assert.equal(evaluate(evidence()).status, "pass");
  assert.equal(evaluate(evidence({ evidenceStatus: "rejected" })).status, "fail");
});
test("evidence does not resolve a failure established by rule-specific facts", () => {
  const result = evaluate(evidence(), true);
  assert.equal(result.status, "fail");
  const readiness = aggregate(result, false);
  assert.equal(readiness.status, "blocked");
  assert.ok(readiness.failedBlockers.some(r => r.ruleId === ruleId));
  assert.equal(readiness.exceptionResolvedBlockers.length, 0);
});
test("exception does not replace missing evidence", () => {
  const result = evaluate(null);
  assert.equal(result.status, "evidence_unavailable");
  assert.equal(result.reason, "missing_evidence");
  const readiness = aggregate(result, true);
  assert.equal(readiness.status, "incomplete");
  assert.equal(readiness.exceptionResolvedBlockers.length, 0);
});
test("valid exception retains the failed original registry result", () => {
  const result = evaluate(evidence({ evidenceStatus: "rejected" }));
  assert.equal(result.status, "fail");
  const readiness = aggregate(result, true);
  const resolved = readiness.exceptionResolvedBlockers.find(r => r.ruleId === ruleId);
  assert.ok(resolved);
  assert.equal(resolved.originalFailure.status, "fail");
  assert.deepEqual(resolved.originalFailure, result);
  assert.equal(result.status, "fail");
});
test("expired evidence remains unavailable even with an approved exception", () => {
  const result = evaluate(evidence({ expiresAtEpochMs: referenceTime }));
  assert.equal(result.status, "evidence_unavailable");
  assert.equal(aggregate(result, true).exceptionResolvedBlockers.length, 0);
});
test("mismatched scoped evidence remains unavailable even with an approved exception", () => {
  const result = evaluate(evidence({ scope: { ...validation.expectedScope, eventId: "another-event" } }));
  assert.equal(result.status, "evidence_unavailable");
  assert.equal(aggregate(result, true).exceptionResolvedBlockers.length, 0);
});