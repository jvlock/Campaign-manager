import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FINAL_CODE_ISSUANCE_MESSAGE,
  GovernanceQuarantineError,
  PROVISIONAL_GOVERNANCE,
  assertNoFinalityRequest,
  assertNoSourceMetadataEscalation,
  quarantineApprovalResponse,
} from "../src/lib/governance-quarantine";

test("finality controls are rejected without scanning harmless draft copy", () => {
  assert.doesNotThrow(() => assertNoFinalityRequest({
    title: "Draft comparison of final and approved wording",
    content: { body: "This copy is not governance-approved." },
  }));
  for (const request of [
    { final: true },
    { isFinal: "yes" },
    { approvalStatus: "approved" },
    { approval_status: "approved" },
    { "approval-status": "final" },
    { mode: "official" },
    { status: "final" },
    { externalPublishing: true },
    { external_publishing: true },
    { nested: { official: "true" } },
    { activities: [{ name: "draft", governanceApproved: true }] },
  ]) {
    assert.throws(
      () => assertNoFinalityRequest(request),
      (error: unknown) => error instanceof GovernanceQuarantineError
        && error.message === FINAL_CODE_ISSUANCE_MESSAGE,
    );
  }
});

test("source metadata cannot override quarantine provenance", () => {
  for (const metadata of [
    { source_environment: "production" },
    { verificationStatus: "verified" },
    { publishing_eligible: true },
    { governanceApproved: true },
  ]) {
    assert.throws(
      () => assertNoSourceMetadataEscalation(metadata),
      (error: unknown) => error instanceof GovernanceQuarantineError,
    );
  }
  assert.doesNotThrow(() => assertNoSourceMetadataEscalation({
    source_environment: "development",
    verification_status: "provisional",
    publishing_eligible: false,
  }));
});

test("historical approved records are never returned as effective approval", () => {
  const response = quarantineApprovalResponse({
    id: "historical",
    recordType: "taxonomyTerm",
    status: "approved",
  });
  assert.equal(response.status, "provisional");
  assert.equal(response.governanceApproved, false);
  assert.equal(response.approvalEffective, false);
  assert.deepEqual(response.quarantine, PROVISIONAL_GOVERNANCE);
});