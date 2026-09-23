import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog";
import { validateManualEvidence, validateManualEvidenceCollection, type EvidenceValidationContext } from "../../src/lib/webinar-standard-evidence";

const catalog = await loadWebinarStandardCatalog();
const now = 1_893_499_200_000;
const context: EvidenceValidationContext = {
  catalog, nowEpochMs: now, expectedRuleId: "WEB-SETUP-001",
  expectedScope: { eventId: "event-1", sessionIds: ["session-1"], participantIds: [], communicationIds: [], deliverableIds: [] },
  expectedInputSnapshotVersion: "snapshot-1", expectedArtifactVersion: null, referenceRequired: false,
};
function fixture(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: "evidence-1", ruleId: context.expectedRuleId,
    standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    evidenceStatus: "confirmed", evidenceDescription: "Pilot review of the session setup.",
    suppliedBy: { nameOrPilotIdentifier: "pilot-reviewer-1", identityVerified: false },
    suppliedAtEpochMs: now - 100, validFromEpochMs: now - 100,
    expiresAtEpochMs: now + 100, sourceReference: "https://example.org/review/1",
    attachmentReference: null, notes: "Reviewed against the current session inventory.",
    scope: structuredClone(context.expectedScope),
    binding: { inputSnapshotVersion: "snapshot-1", artifactVersion: null, reviewedAtEpochMs: now - 100, snapshotCompleteness: "complete", observationFromEpochMs: null, observationThroughEpochMs: null },
    ...overrides,
  };
}
function rejected(input: unknown, code: string) {
  const result = validateManualEvidence(input, context);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail();
  assert.ok(result.issues.some(i => i.code === code), JSON.stringify(result));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.issues));
  assert.ok(result.issues.every(Object.isFrozen));
}
test("valid evidence is accepted without asserting a rule pass", () => {
  const result = validateManualEvidence(fixture(), context);
  assert.equal(result.ok, true);
  assert.equal("status" in result, false);
});
test("unknown canonical rule is rejected", () => rejected(fixture({ ruleId: "WEB-UNKNOWN-999" }), "unknown_rule"));
test("wrong standard is rejected", () => rejected(fixture({ standardId: "OTHER" }), "wrong_standard"));
test("wrong exact version is rejected", () => rejected(fixture({ standardVersion: "1.0" }), "wrong_version"));
test("missing immutable evidence ID is rejected", () => rejected(fixture({ evidenceId: undefined }), "missing_evidence_id"));
test("identical duplicate evidence ID in collection is rejected", () => {
  const value = fixture();
  const result = validateManualEvidenceCollection([value, structuredClone(value)], context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some(i => i.code === "duplicate_evidence_id"));
});
test("changed duplicate evidence ID in collection is rejected", () => {
  const result = validateManualEvidenceCollection([fixture(), fixture({ notes: "Changed notes." })], context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some(i => i.code === "duplicate_evidence_id"));
});
test("mismatched authoritative scope is rejected", () => rejected(fixture({ scope: { ...context.expectedScope, eventId: "other" } }), "scope_mismatch"));
test("empty scoped arrays are not a wildcard", () => rejected(fixture({ scope: { ...context.expectedScope, sessionIds: [] } }), "scope_mismatch"));
test("missing supplied timestamp is rejected", () => rejected(fixture({ suppliedAtEpochMs: undefined }), "invalid_timestamp"));
test("future supplied timestamp is rejected", () => rejected(fixture({ suppliedAtEpochMs: now + 1 }), "future_timestamp"));
test("expired evidence is rejected at expiration boundary", () => rejected(fixture({ expiresAtEpochMs: now }), "expired_evidence"));
test("malformed source reference is rejected", () => rejected(fixture({ sourceReference: "javascript:alert(1)" }), "malformed_reference"));
test("whitespace source reference is rejected", () => rejected(fixture({ sourceReference: "https://example.org/a b" }), "malformed_reference"));
test("unscoped local reference is rejected", () => rejected(fixture({ sourceReference: "ref:session:other:review-1" }), "malformed_reference"));
test("explicit scoped reference is accepted", () => assert.equal(validateManualEvidence(fixture({ sourceReference: "ref:session:session-1:review-1" }), context).ok, true));
test("verified supplier identity claim is rejected", () => rejected(fixture({ suppliedBy: { nameOrPilotIdentifier: "Pilot", identityVerified: true } }), "verified_identity_claim"));
test("nonboolean supplier identity marker is rejected", () => rejected(fixture({ suppliedBy: { nameOrPilotIdentifier: "Pilot", identityVerified: "false" } }), "verified_identity_claim"));
test("missing effective timestamp is unavailable", () => rejected(fixture({ validFromEpochMs: undefined }), "invalid_timestamp"));
test("nonfinite effective timestamp is unavailable", () => rejected(fixture({ validFromEpochMs: Infinity }), "invalid_timestamp"));
test("malformed effective timestamp is unavailable", () => rejected(fixture({ validFromEpochMs: "yesterday" }), "invalid_timestamp"));
test("future effective timestamp is unavailable", () => rejected(fixture({ validFromEpochMs: now + 1 }), "future_timestamp"));
test("required reference cannot be replaced with fake attachment", () => {
  const result = validateManualEvidence(fixture({ sourceReference: null }), { ...context, referenceRequired: true });
  assert.equal(result.ok, false);
  rejected(fixture({ attachmentReference: { uploaded: true } }), "malformed_reference");
});
test("missing supplier name is rejected", () => rejected(fixture({ suppliedBy: { identityVerified: false } }), "missing_supplier"));
test("missing description is rejected", () => rejected(fixture({ evidenceDescription: "" }), "missing_required_text"));
test("missing notes are rejected", () => rejected(fixture({ notes: undefined }), "missing_required_text"));
test("missing status is rejected", () => rejected(fixture({ evidenceStatus: undefined }), "invalid_status"));
test("snapshot version mismatch is rejected", () => rejected(fixture({ binding: { ...fixture().binding, inputSnapshotVersion: "old" } }), "binding_mismatch"));
test("future review timestamp is rejected", () => rejected(fixture({ binding: { ...fixture().binding, reviewedAtEpochMs: now + 1 } }), "invalid_timestamp"));
test("unknown and hostile inputs return immutable errors", () => {
  for (const value of [null, undefined, 3, [], new Date(), Object.defineProperty({}, "evidenceId", { get() { throw Error("getter"); }, enumerable: true })])
    rejected(value, "invalid_evidence");
});
test("validation does not mutate or freeze caller input", () => {
  const input = fixture();
  const before = structuredClone(input);
  validateManualEvidence(input, context);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.scope), false);
});
test("validated result is deeply frozen and defensively copied", () => {
  const input = fixture();
  const result = validateManualEvidence(input, context);
  assert.ok(result.ok);
  (input.scope.sessionIds as string[]).push("later-session");
  input.suppliedBy.nameOrPilotIdentifier = "different";
  assert.deepEqual(result.evidence.scope.sessionIds, ["session-1"]);
  assert.equal(result.evidence.suppliedBy.nameOrPilotIdentifier, "pilot-reviewer-1");
  assert.ok(Object.isFrozen(result.evidence));
  assert.ok(Object.isFrozen(result.evidence.scope.sessionIds));
  assert.ok(Object.isFrozen(result.evidence.binding));
  assert.equal(Reflect.set(result.evidence, "evidenceId", "other"), false);
});