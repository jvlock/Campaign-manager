import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import app from "./helpers/legacy-app";
import {
  approvals,
  campaigns,
  db,
  governanceAuditEvents,
  taxonomyImportBatches,
  taxonomyImportCandidates,
  taxonomyTerms,
  taxonomyVersions,
} from "@workspace/db";
import { detectImportConflicts, normalizeRecordType } from "../src/lib/governance";

let server: Server;
let baseUrl: string;
let versionId: string;
let campaignId: string;

before(async () => {
  const [version] = await db.insert(taxonomyVersions).values({
    version: `governance-test-${Date.now()}`,
    effectiveAt: new Date(),
  }).returning();
  versionId = version.id;
  const [campaign] = await db.insert(campaigns).values({
    name: "Governance verification campaign",
    scope: "Global",
    region: "Global",
    audience: "Governance test audience",
    outcome: "Verify governance",
  }).returning();
  campaignId = campaign.id;
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Verification server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  server.close();
  const batches = await db.select({ id: taxonomyImportBatches.id }).from(taxonomyImportBatches).where(eq(taxonomyImportBatches.versionId, versionId));
  if (batches.length) {
    const batchIds = batches.map((batch) => batch.id);
    await db.delete(taxonomyImportCandidates).where(inArray(taxonomyImportCandidates.batchId, batchIds));
    await db.delete(taxonomyImportBatches).where(inArray(taxonomyImportBatches.id, batchIds));
  }
  const terms = await db.select({ id: taxonomyTerms.id }).from(taxonomyTerms).where(eq(taxonomyTerms.versionId, versionId));
  if (terms.length) {
    const termIds = terms.map((term) => term.id);
    await db.delete(approvals).where(inArray(approvals.recordId, termIds));
    await db.update(taxonomyTerms).set({ supersededBy: null }).where(inArray(taxonomyTerms.id, termIds));
    await db.delete(governanceAuditEvents).where(inArray(governanceAuditEvents.entityId, termIds));
    for (const category of ["subcampaign", "campaign_shortcode", "product_line"]) {
      await db.delete(taxonomyTerms).where(and(
        eq(taxonomyTerms.versionId, versionId),
        eq(taxonomyTerms.category, category),
      ));
    }
    await db.delete(taxonomyTerms).where(eq(taxonomyTerms.versionId, versionId));
  }
  await db.delete(approvals).where(and(eq(approvals.recordType, "campaign"), eq(approvals.recordId, campaignId)));
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  await db.delete(taxonomyVersions).where(eq(taxonomyVersions.id, versionId));
  await db.delete(governanceAuditEvents).where(eq(governanceAuditEvents.actor, "governance-test"));
});

test("legacy shortcode resolution follows a rename and records snapshots", async () => {
  const create = await fetch(`${baseUrl}/governance/terms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Create a term for the rename test",
      versionId,
      category: "channel",
      label: "Email",
      shortcode: "EMAIL_OLD",
    }),
  });
  assert.equal(create.status, 201);
  const term = await create.json();
  await db.insert(approvals).values({
    recordType: "taxonomyTerm",
    recordId: term.id,
    stage: "Governance",
    status: "approved",
    approver: "governance-test",
  });
  const rename = await fetch(`${baseUrl}/governance/terms/${term.id}/rename`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Use the current naming standard",
      shortcode: "EMAIL_CURRENT",
      legacyCodes: ["EXPLICIT_LEGACY"],
    }),
  });
  assert.equal(rename.status, 200);
  assert.equal((await db.select().from(approvals).where(eq(approvals.recordId, term.id))).length, 0);
  const resolved = await fetch(`${baseUrl}/governance/terms/resolve?versionId=${versionId}&code=EMAIL_OLD`);
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).resolved.shortcode, "EMAIL_CURRENT");
  const explicitLegacyResolved = await fetch(`${baseUrl}/governance/terms/resolve?versionId=${versionId}&code=EXPLICIT_LEGACY`);
  assert.equal(explicitLegacyResolved.status, 200);
  assert.equal((await explicitLegacyResolved.json()).resolved.shortcode, "EMAIL_CURRENT");
  const deprecated = await fetch(`${baseUrl}/governance/terms/${term.id}/deprecate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Retire the old taxonomy value",
    }),
  });
  assert.equal(deprecated.status, 200);
  assert.equal((await deprecated.json()).isDeprecated, true);
  const audit = await fetch(`${baseUrl}/governance/audit?entityType=taxonomyTerm&entityId=${term.id}`);
  const events = await audit.json();
  assert.equal(events[0].actorProvenance, "declared");
  assert.ok(events.some((event: { action: string; before: unknown; after: unknown }) => event.action === "rename" && event.before && event.after));
  assert.ok(events.some((event: { action: string; before: unknown; after: unknown }) => event.action === "deprecate" && event.before && event.after));
});

test("import staging exposes conflicts and committed candidates are idempotent", async () => {
  const conflicts = detectImportConflicts(
    [{ category: "channel", label: "Duplicate", shortcode: "DUP" }, { category: "channel", label: "Duplicate 2", shortcode: "DUP" }],
    [],
  );
  assert.ok(conflicts.every((candidate) => candidate.conflicts.includes("duplicate_candidate_shortcode")));
  const namespaceConflicts = detectImportConflicts(
    [
      { category: "channel", label: "Current", shortcode: "CURRENT", legacyCodes: ["SHARED_ALIAS"] },
      { category: "channel", label: "Other", shortcode: "OTHER", legacyCodes: ["CURRENT"] },
      { category: "channel", label: "Existing", shortcode: "NEW", legacyCodes: ["OLD_ALIAS"] },
    ],
    [{ category: "channel", label: "Already present", shortcode: "PRESENT", legacyCodes: ["OLD_ALIAS"] }],
  );
  assert.ok(namespaceConflicts[1].conflicts.includes("duplicate_candidate_code"));
  assert.ok(namespaceConflicts[2].conflicts.includes("existing_code"));
  const hierarchyScoped = detectImportConflicts(
    [
      {
        category: "campaign_shortcode", label: "Business as Usual", shortcode: "bau",
        stableKey: "campaign_shortcode:a:bau", parentStableKey: "product_line:a",
      },
      {
        category: "campaign_shortcode", label: "Business as Usual", shortcode: "bau",
        stableKey: "campaign_shortcode:b:bau", parentStableKey: "product_line:b",
      },
    ],
    [],
  );
  assert.ok(hierarchyScoped.every((candidate) => candidate.status === "staged"));

  const firstBatch = await fetch(`${baseUrl}/governance/imports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Stage the first namespace candidate",
      versionId,
      sourceName: "first namespace batch",
      idempotencyKey: "governance-test-namespace-first",
      candidates: [{ sourceKey: "first", category: "channel", label: "First", shortcode: "BATCH_CURRENT", legacyCodes: ["BATCH_ALIAS"] }],
    }),
  });
  assert.equal(firstBatch.status, 201);
  const secondBatch = await fetch(`${baseUrl}/governance/imports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Detect the staged namespace candidate",
      versionId,
      sourceName: "second namespace batch",
      idempotencyKey: "governance-test-namespace-second",
      candidates: [{ sourceKey: "second", category: "channel", label: "Second", shortcode: "BATCH_ALIAS" }],
    }),
  });
  assert.equal(secondBatch.status, 201);
  const secondBatchJson = await secondBatch.json();
  assert.equal(secondBatchJson.candidates[0].status, "conflict");
  assert.ok(secondBatchJson.candidates[0].conflicts.includes("existing_code"));
  const override = await fetch(`${baseUrl}/governance/imports/${secondBatchJson.batch.id}/candidates/${secondBatchJson.candidates[0].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "governance-test", reason: "Attempt an unsafe override", status: "business_review_complete", resolveConflict: true }),
  });
  assert.equal(override.status, 200);
  const unsafeCommit = await fetch(`${baseUrl}/governance/imports/${secondBatchJson.batch.id}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "governance-test", reason: "Reject the namespace collision at commit" }),
  });
  assert.equal(unsafeCommit.status, 409);

  const staged = await fetch(`${baseUrl}/governance/imports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Stage a reviewed import",
      versionId,
      sourceName: "governance test rows",
      idempotencyKey: "governance-test-import",
      candidates: [{ sourceKey: "valid-1", category: "channel", label: "Push", shortcode: "PUSH" }],
    }),
  });
  assert.equal(staged.status, 201);
  const stagedJson = await staged.json();
  const candidate = stagedJson.candidates[0];
  const reviewed = await fetch(`${baseUrl}/governance/imports/${stagedJson.batch.id}/candidates/${candidate.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "governance-test", reason: "Candidate is valid", status: "business_review_complete" }),
  });
  assert.equal(reviewed.status, 200);
  const committed = await fetch(`${baseUrl}/governance/imports/${stagedJson.batch.id}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "governance-test", reason: "Commit the approved candidate" }),
  });
  assert.equal(committed.status, 200);
  const secondCommit = await fetch(`${baseUrl}/governance/imports/${stagedJson.batch.id}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "governance-test", reason: "Verify idempotent commit" }),
  });
  assert.equal(secondCommit.status, 200);
  const terms = await db.select().from(taxonomyTerms).where(and(eq(taxonomyTerms.versionId, versionId), eq(taxonomyTerms.shortcode, "PUSH")));
  assert.equal(terms.length, 1);
  const candidateAudits = await db.select().from(governanceAuditEvents).where(eq(governanceAuditEvents.entityId, candidate.id));
  assert.ok(candidateAudits.some((event) => event.action === "review"));
  assert.ok(candidateAudits.some((event) => event.action === "commit"));
});

test("stable-key import replay preserves UUID and stable identity", async () => {
  const stableKey = `test:channel:${Date.now()}`;
  const importAndCommit = async (suffix: string, label: string, extra: Record<string, unknown> = {}) => {
    const staged = await fetch(`${baseUrl}/governance/imports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "governance-test",
        reason: `Stage stable-key replay ${suffix}`,
        versionId,
        sourceName: `stable-key-${suffix}`,
        idempotencyKey: `governance-stable-${stableKey}-${suffix}`,
        candidates: [{
          sourceKey: stableKey,
          stableKey,
          category: "channel",
          label,
          shortcode: "STABLE_CHANNEL",
          ...extra,
        }],
      }),
    });
    assert.equal(staged.status, 201);
    const body = await staged.json();
    assert.equal(body.candidates[0].status, "staged");
    const reviewed = await fetch(`${baseUrl}/governance/imports/${body.batch.id}/candidates/${body.candidates[0].id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "governance-test", reason: "Complete business review for isolated stable-key fixture", status: "business_review_complete" }),
    });
    assert.equal(reviewed.status, 200);
    const committed = await fetch(`${baseUrl}/governance/imports/${body.batch.id}/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "governance-test", reason: "Commit isolated stable-key fixture" }),
    });
    assert.equal(committed.status, 200);
    return (await committed.json()).committedTermIds[0] as string;
  };

  const firstId = await importAndCommit("first", "Stable Channel", {
    sourceMetadata: { suppliedBy: "governance-test" },
  });
  const replayId = await importAndCommit("replay", "Stable Channel Updated");
  assert.equal(replayId, firstId);
  const [term] = await db.select().from(taxonomyTerms).where(eq(taxonomyTerms.id, firstId));
  assert.equal(term.stableKey, stableKey);
  assert.equal(term.label, "Stable Channel Updated");
  assert.deepEqual(term.sourceMetadata, { suppliedBy: "governance-test" });

  await db.insert(approvals).values({
    recordType: "taxonomyTerm",
    recordId: firstId,
    stage: "Governance",
    status: "approved",
    approver: "governance-test",
  });
  await importAndCommit("legacy-alias", "Stable Channel Updated", { legacyCodes: ["STABLE_CHANNEL_OLD"] });
  assert.equal((await db.select().from(approvals).where(eq(approvals.recordId, firstId))).length, 0);

  const [supersessionTarget] = await db.insert(taxonomyTerms).values({
    versionId,
    category: "channel",
    label: "Stable Channel Replacement",
    shortcode: "STABLE_CHANNEL_REPLACEMENT",
  }).returning();
  await db.insert(approvals).values({
    recordType: "taxonomyTerm",
    recordId: firstId,
    stage: "Governance",
    status: "approved",
    approver: "governance-test",
  });
  await importAndCommit("supersession", "Stable Channel Updated", {
    legacyCodes: ["STABLE_CHANNEL_OLD"],
    supersededBy: supersessionTarget.id,
  });
  assert.equal((await db.select().from(approvals).where(eq(approvals.recordId, firstId))).length, 0);

  const resolution = await fetch(`${baseUrl}/governance/terms/resolve?versionId=${versionId}&code=${encodeURIComponent(stableKey)}`);
  assert.equal(resolution.status, 200);
  const resolutionBody = await resolution.json();
  assert.equal(resolutionBody.chain[0].id, firstId);
  assert.equal(resolutionBody.resolved.id, supersessionTarget.id);

  const identityChange = await fetch(`${baseUrl}/governance/terms/${firstId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Verify stable identity cannot change",
      stableKey: `${stableKey}:changed`,
    }),
  });
  assert.equal(identityChange.status, 409);
});

test("import rejects an ambiguous parent shortcode instead of choosing arbitrarily", async () => {
  const [productA, productB] = await db.insert(taxonomyTerms).values([
    { versionId, category: "product_line", label: "Product A", shortcode: "PRODUCT_A" },
    { versionId, category: "product_line", label: "Product B", shortcode: "PRODUCT_B" },
  ]).returning();
  await db.insert(taxonomyTerms).values([
    { versionId, category: "campaign_shortcode", label: "BAU A", shortcode: "AMBIGUOUS_BAU", parentId: productA.id },
    { versionId, category: "campaign_shortcode", label: "BAU B", shortcode: "AMBIGUOUS_BAU", parentId: productB.id },
  ]);
  const staged = await fetch(`${baseUrl}/governance/imports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Verify ambiguous parent rejection",
      versionId,
      sourceName: "ambiguous-parent-test",
      candidates: [{
        sourceKey: "ambiguous-child",
        stableKey: "test:ambiguous-child",
        category: "subcampaign",
        label: "Ambiguous Child",
        shortcode: "AMBIGUOUS_CHILD",
        parentShortcode: "AMBIGUOUS_BAU",
      }],
    }),
  });
  assert.equal(staged.status, 201);
  const body = await staged.json();
  await fetch(`${baseUrl}/governance/imports/${body.batch.id}/candidates/${body.candidates[0].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "governance-test", reason: "Complete business review for ambiguity fixture", status: "business_review_complete" }),
  });
  const committed = await fetch(`${baseUrl}/governance/imports/${body.batch.id}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "governance-test", reason: "Parent resolution must reject ambiguity" }),
  });
  assert.equal(committed.status, 409);
  assert.match((await committed.json()).error, /ambiguous.*parentStableKey or parentId/i);
});

test("polymorphic approvals validate target record types", async () => {
  assert.equal(normalizeRecordType("campaigns"), "campaign");
  const invalid = await fetch(`${baseUrl}/governance/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Reject an invalid target",
      recordType: "campaign",
      recordId: "00000000-0000-4000-8000-000000000000",
      stage: "launch",
      status: "pending",
      approver: "reviewer",
    }),
  });
  assert.equal(invalid.status, 404);
  const created = await fetch(`${baseUrl}/governance/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Create a campaign approval",
      recordType: "campaign",
      recordId: campaignId,
      stage: "launch",
      status: "pending",
      approver: "reviewer",
    }),
  });
  assert.equal(created.status, 201);
  const approval = await created.json();
  assert.equal(approval.recordType, "campaign");
  assert.equal(approval.recordId, campaignId);

  for (const status of ["approved", "final", "official"]) {
    const rejected = await fetch(`${baseUrl}/governance/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "governance-test",
        reason: "Quarantine must reject governance finality",
        recordType: "campaign",
        recordId: campaignId,
        stage: "governance",
        status,
        approver: "reviewer",
      }),
    });
    assert.equal(rejected.status, 409);
    assert.match((await rejected.json()).error, /Final code issuance is not currently available/);
  }

  await db.insert(approvals).values({
    recordType: "campaign",
    recordId: campaignId,
    campaignId,
    stage: "historical",
    status: "approved",
    approver: "legacy-system",
  });
  const listed = await fetch(`${baseUrl}/governance/approvals?recordType=campaign&recordId=${campaignId}`);
  assert.equal(listed.status, 200);
  const oldApproved = (await listed.json()).find((row: any) => row.stage === "historical");
  assert.equal(oldApproved.status, "provisional");
  assert.equal(oldApproved.governanceApproved, false);
  assert.equal(oldApproved.approvalEffective, false);
});

test("taxonomy imports reject approval aliases and provenance escalation", async () => {
  for (const candidate of [
    { sourceKey: "approved-write", category: "channel", label: "Approved write", shortcode: "NOAPP", status: "approved" },
    {
      sourceKey: "production-override",
      category: "channel",
      label: "Production override",
      shortcode: "NOPROD",
      sourceMetadata: { source_environment: "production", publishing_eligible: true },
    },
  ]) {
    const response = await fetch(`${baseUrl}/governance/imports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "governance-test",
        reason: "Quarantine import regression",
        versionId,
        sourceName: "quarantine regression",
        candidates: [candidate],
      }),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /Final code issuance is not currently available/);
  }

  const staged = await fetch(`${baseUrl}/governance/imports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Stage a provisional business-review candidate",
      versionId,
      sourceName: "quarantine business review",
      candidates: [{ sourceKey: "business-review", category: "channel", label: "Draft candidate", shortcode: "DRAFTONLY" }],
    }),
  });
  assert.equal(staged.status, 201);
  const stagedBody = await staged.json();
  const candidate = stagedBody.candidates[0];
  const approvedAlias = await fetch(`${baseUrl}/governance/imports/${stagedBody.batch.id}/candidates/${candidate.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Explicit approval must be rejected",
      status: "approved",
    }),
  });
  assert.equal(approvedAlias.status, 409);
  const reviewed = await fetch(`${baseUrl}/governance/imports/${stagedBody.batch.id}/candidates/${candidate.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Business review remains available",
      status: "business_review_complete",
    }),
  });
  assert.equal(reviewed.status, 200);
  const reviewedBody = await reviewed.json();
  assert.equal(reviewedBody.status, "business_review_complete");
  assert.equal(reviewedBody.governanceApproved, false);
});

test("taxonomy term create and update reject hidden finality and source metadata escalation", async () => {
  const rejectedCreate = await fetch(`${baseUrl}/governance/terms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Reject hidden approval",
      versionId,
      category: "channel",
      label: "Hidden approval",
      shortcode: "HIDDEN_APPROVAL",
      approval_status: "approved",
    }),
  });
  assert.equal(rejectedCreate.status, 409);
  assert.match((await rejectedCreate.json()).error, /Final code issuance is not currently available/);

  const created = await fetch(`${baseUrl}/governance/terms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Create provisional update fixture",
      versionId,
      category: "channel",
      label: "Provisional fixture",
      shortcode: "PROVISIONAL_FIXTURE",
    }),
  });
  assert.equal(created.status, 201);
  const term = await created.json();
  const rejectedUpdate = await fetch(`${baseUrl}/governance/terms/${term.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "governance-test",
      reason: "Reject production metadata override",
      source_metadata: {
        source_environment: "production",
        verification_status: "verified",
        publishing_eligible: true,
      },
    }),
  });
  assert.equal(rejectedUpdate.status, 409);
  assert.match((await rejectedUpdate.json()).error, /Final code issuance is not currently available/);
});