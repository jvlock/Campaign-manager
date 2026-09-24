import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import express from "express";
import { pool } from "@workspace/db";
import { developmentPolicy } from "../src/lib/development-policy";
import { initializeNewSyntheticOccurrence, simulationFingerprint, sourceInputFingerprint,
  evaluateCanonicalAssembly } from "../src/lib/webinar-evaluation-orchestration";
import { assembleEvaluationInput } from "../src/lib/webinar-domain-adapters";
import { loadOccurrenceSources, occurrenceAssemblySource } from "../src/lib/webinar-evaluation-sources";
import { loadWebinarStandardCatalog } from "../src/lib/webinar-standard-catalog";
import { captureWebinarRelease } from "../src/lib/webinar-release-provenance";
import { WebinarPersistence } from "../src/lib/webinar-persistence";
import { STANDARD_ID, STANDARD_VERSION } from "../src/lib/webinar-standard-catalog/types";
import { COMPLETE_OBLIGATIONS } from "../src/lib/webinar-standard-readiness";
import { loadWebinarApiContext, projection, webinarSummary, submitWebinarEvidence,
  requestDraftException, WebinarApiError, historyWebinarApi } from "../src/lib/webinar-standard-api";
import api from "../src/routes/development-webinar-api";
import foundationApi from "../src/routes/development-foundation";

const clock = "2026-01-01T00:00:00.000Z";
let campaignId: string, activityId: string, sessionId: string, actorId: string, server: Server, origin: string;
const root = () => `/campaigns/${campaignId}/webinars/${sessionId}/standard`;
const read = (resource: string) => fetch(`${origin}${root()}/${resource}`);
const post = (resource: string, body: unknown) => fetch(`${origin}${root()}/${resource}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
before(async () => {
  const identity = await pool.query("SELECT current_setting('data_directory') AS directory,inet_server_addr() IS NULL AS socket");
  assert.match(identity.rows[0].directory, /^\/tmp\/disposable-pg-[^/]+\/data$/);
  assert.equal(identity.rows[0].socket, true);
  actorId = (await pool.query("INSERT INTO users(name,email) VALUES('Synthetic contract actor',$1) RETURNING id",
    [`${randomUUID()}@example.invalid`])).rows[0].id;
  const team = (await pool.query("INSERT INTO organization_units(name,kind) VALUES('Synthetic API team','team') RETURNING id")).rows[0].id;
  const group = (await pool.query("INSERT INTO organization_units(name,kind,parent_id,accountable_owner_id) VALUES('Synthetic API group','group',$1,$2) RETURNING id",
    [team, actorId])).rows[0].id;
  await pool.query(`INSERT INTO development_planning_environment(marker,default_group_id,creator_id,accountable_owner_id)
    VALUES('synthetic-open-development-v1',$1,$2,$2)`, [group, actorId]);
  campaignId = (await pool.query(`INSERT INTO campaigns(name,scope,audience,outcome)
    VALUES('Synthetic API contract','Global','Synthetic','Synthetic') RETURNING id`)).rows[0].id;
  activityId = (await pool.query(`INSERT INTO activities(campaign_id,name,type,activity_type_id,audience,region,timing,status,owner,x,y)
    VALUES($1,'Synthetic API webinar','Webinar','webinar','Synthetic','Global','TBD','Draft','Synthetic',0,0) RETURNING id`, [campaignId])).rows[0].id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    sessionId = (await client.query(`INSERT INTO webinar_sessions(campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform,template_version)
      VALUES($1,$2,'Synthetic API occurrence','2026-06-15','10:00',60,'UTC','Synthetic','default_5') RETURNING id`, [campaignId, activityId])).rows[0].id;
    await initializeNewSyntheticOccurrence(client, campaignId, sessionId, actorId, "draft");
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  const app = express();
  app.use(express.json(), developmentPolicy, api, foundationApi);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  try {
    // The development marker is intentionally immutable at runtime, but leaving
    // this test's global marker makes later serialized suites create ownership
    // rows for *their* activities and breaks their otherwise valid teardown.
    // Restrict this test-only cleanup to its exact creator in the disposable DB;
    // a transaction always restores the production immutability trigger.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE development_planning_environment DISABLE TRIGGER development_marker_immutable");
      const removed = await client.query("DELETE FROM development_planning_environment WHERE creator_id=$1", [actorId]);
      assert.equal(removed.rowCount, 1, "only this test's development marker may be removed");
      await client.query("ALTER TABLE development_planning_environment ENABLE TRIGGER development_marker_immutable");
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  } finally { await pool.end(); }
});

test("whole synthetic webinar summary distinguishes no evaluation, identity and unavailable observations", async () => {
  const response = await read("summary");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.activityId, activityId);
  assert.equal(body.occurrenceId, sessionId);
  assert.equal(body.status, "not_evaluated");
  assert.equal(body.staleness, "not_evaluated");
  assert.equal(body.foundation.liveProductionConnection, false);
  assert.equal(body.foundation.observations.find((o: { type: string }) => o.type === "internal_title").status, "unavailable");
  assert.equal(body.foundation.outputs.length, 6);
  const taxonomy = body.foundation.outputs.find((o: { type: string }) => o.type === "taxonomy");
  assert.equal(taxonomy.supportedByFixture, true);
  if (taxonomy.configured) assert.notEqual(taxonomy.error, "not_configured",
    "a configured supported fixture must not report provider-not-configured");
  assert.ok(body.foundation.outputs.filter((o: { status: string }) => o.status === "unsupported").length >= 5);
  assert.equal(body.operationalReadiness, false);
  assert.equal(body.population.total, 0);
  await assert.rejects(loadWebinarApiContext({ campaignId, sessionId }, randomUUID()),
    (error: unknown) => error instanceof WebinarApiError && error.code === "NOT_FOUND");
  const unknown = await fetch(`${origin}/campaigns/${campaignId}/webinars/${randomUUID()}/standard/summary`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, "NOT_FOUND");
});
test("existing scoped Foundation inspection exposes six typed outputs and disables unconfigured refresh", async () => {
  const query = new URLSearchParams({ campaignId, activityId, occurrenceId: sessionId });
  const inspected = await fetch(`${origin}/development/foundation/observations?${query}`);
  assert.equal(inspected.status, 200);
  const body = await inspected.json();
  assert.equal(body.observations.length, 6);
  for (const output of body.observations) {
    assert.equal(output.simulationOnly, true);
    assert.ok("providerConfigured" in output);
    assert.ok("providerIdentity" in output);
    assert.ok("supersessionState" in output);
    assert.ok("observationId" in output);
    assert.ok("inputFingerprint" in output);
  }
  assert.equal(body.observations.filter((o: { status: string }) => o.status === "unsupported").length, 5);
  const refresh = await fetch(`${origin}/development/foundation/observations/refresh`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId, activityId, occurrenceId: sessionId,
      calculationAt: clock, idempotencyKey: randomUUID(), expectedRevision: 1 }),
  });
  assert.equal(refresh.status, 409);
  assert.equal((await refresh.json()).code, "PROVIDER_NOT_CONFIGURED");
});
test("source-bound evidence is atomic, unverified, idempotent and distinct from exception", async () => {
  const sourceHash = simulationFingerprint({ synthetic: "source-fixture" });
  const source = await new WebinarPersistence().append({
    campaignId, sessionId, actorId, expectedRevision: 1, idempotencyKey: randomUUID(),
    standard: { id: STANDARD_ID, version: STANDARD_VERSION }, calculationAt: clock,
    inputFingerprint: simulationFingerprint({ kind: "source-fixture" }), operational: false,
    payload: { kind: "source", sourceSystem: "synthetic-api-test", sourceType: "content",
      sourceId: sessionId, sourceVersion: "test-v1", sourceHash,
      observedAt: clock, status: "available" },
  });
  const key = randomUUID();
  const input = { sourceId: source.id, evidenceType: "source-observation" as const,
    sourceType: "content" as const, sourceVersion: "test-v1", sourceHash,
    expectedRevision: 2, idempotencyKey: key, calculationAt: clock };
  const [first, replay] = await Promise.all([
    submitWebinarEvidence({ campaignId, sessionId }, activityId, input),
    submitWebinarEvidence({ campaignId, sessionId }, activityId, input),
  ]);
  assert.equal(first.id, replay.id);
  assert.equal(first.result, "unknown");
  assert.equal(first.authenticated, false);
  assert.deepEqual(new Set([first.replayed, replay.replayed]), new Set([false, true]));
  const rows = await pool.query("SELECT id,kind,actor_id FROM webinar_persistence_records WHERE id=$1", [first.id]);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].kind, "evidence");
  assert.equal(rows.rows[0].actor_id, actorId);
  const audit = await pool.query("SELECT 1 FROM webinar_persistence_audit WHERE record_id=$1", [first.id]);
  assert.equal(audit.rowCount, 1);
  await assert.rejects(submitWebinarEvidence({ campaignId, sessionId }, activityId,
    { ...input, evidenceType: "qa" }), /Idempotency key/);
  const listed = await read("evidence");
  assert.equal(listed.status, 200);
  const reference = (await listed.json()).records[0];
  assert.equal(reference.result, "unknown");
  assert.equal(reference.sourceType, "content");
  assert.equal(reference.sourceVersion, "test-v1");
  assert.equal(reference.sourceHash, sourceHash);
  const exception = await read("exceptions");
  assert.deepEqual((await exception.json()).records, []);
  const missingSource = await post("evidence", { ...input, sourceId: randomUUID(), idempotencyKey: randomUUID(),
    expectedRevision: 3 });
  assert.equal(missingSource.status, 422);
  assert.equal((await missingSource.json()).error.code, "MISSING_REQUIRED_INPUT");
  for (const change of [{ sourceVersion: "stale-v2" }, { sourceHash: simulationFingerprint("wrong") },
    { sourceType: "measurement" }, { evidenceType: "invalid" }]) {
    const invalid = await post("evidence", { ...input, ...change, idempotencyKey: randomUUID(), expectedRevision: 3 });
    assert.equal(invalid.status, change.evidenceType ? 400 : 409);
    assert.equal((await invalid.json()).error.code, change.evidenceType ? "VALIDATION_ERROR" : "STALE_INPUT");
  }
  const incompatible = await post("evidence", { ...input, evidenceType: "manual-review",
    sourceType: "occurrence", idempotencyKey: randomUUID(), expectedRevision: 3 });
  assert.equal(incompatible.status, 409); // The declared type must match before compatibility is evaluated.
});
test("single existing 106-rule orchestration, exact replay, deterministic projections and scoped history", async () => {
  const input = { expectedRevision: 3, idempotencyKey: randomUUID(), calculationAt: clock };
  const [first, retry] = await Promise.all([post("evaluations", input), post("evaluations", input)]);
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  const a = await first.json(), b = await retry.json();
  assert.equal(a.snapshotId, b.snapshotId);
  assert.equal(a.results.length, 106);
  assert.equal(a.evaluatorCoverage.implementedRuleCount, 106);
  assert.equal(a.evaluatorCoverage.missingEvaluatorCount, 0);
  assert.equal(a.operationalReadiness, false);
  assert.equal(a.engineRelease.digest, b.engineRelease.digest);
  assert.equal(a.evaluationContextFingerprint, b.evaluationContextFingerprint);
  assert.equal(a.engineReleaseFingerprint, a.engineRelease.digest);
  assert.equal(a.engineRelease.provenance.evaluatorRegistry.coverage.implemented, 106);
  assert.equal(a.engineRelease.provenance.evaluatorRegistry.coverage.total, 106);
  assert.equal(Object.keys(a.engineRelease.provenance.canonicalDocuments).length, 5);
  assert.ok("applicationRelease" in a.engineRelease.provenance);
  assert.match(a.engineRelease.provenance.dependencies["@js-temporal/polyfill"], /^\d+\.\d+\.\d+/);
  assert.equal("releaseFingerprint" in a, false, "context digest must not be named release identity in the API");
  const detail = await (await read("evaluations")).json();
  assert.equal(detail.results.length, 106);
  assert.equal(detail.snapshotId, a.snapshotId);
  assert.equal(detail.staleness, "current");
  assert.equal(detail.results.map((r: { ruleId: string }) => r.ruleId).join(","),
    [...detail.results].sort((x: { ruleId: string }, y: { ruleId: string }) => x.ruleId.localeCompare(y.ruleId))
      .map((r: { ruleId: string }) => r.ruleId).join(","));
  const readiness = await (await read("readiness")).json();
  assert.equal(readiness.stages.length, 4);
  assert.equal(readiness.operationalReadiness, false);
  assert.deepEqual(readiness.stages.map((stage: { stage: string }) => stage.stage),
    ["Ready to recruit", "Ready to run", "Ready to follow up", "Complete"]);
  for (const stage of readiness.stages) {
    assert.equal(stage.calculationAt, clock);
    assert.equal(stage.staleness, "current");
    assert.equal(stage.applicableRuleCount, stage.applicableRuleIds.length);
    for (const key of ["passes", "unresolvedBlockingFailures", "resolvedBlockingFailures",
      "nonblockingFailures", "warnings", "missingInputs", "missingEvaluatorCoverage",
      "prerequisiteIssues", "evidenceReferences", "exceptionReferences"]) assert.ok(Array.isArray(stage[key]), key);
  }
  assert.equal(readiness.stages[0].prerequisiteIssues.length, 0, "recruitment has no stage prerequisite");
  assert.ok(readiness.stages[1].prerequisiteIssues.every((issue: { prerequisite: string }) =>
    issue.prerequisite !== "Ready to recruit"), "run must not depend on recruit");
  const completion = await (await read("completion")).json();
  assert.equal(completion.result.complete, false);
  assert.equal(completion.evidenceReferences.length, 1);
  assert.deepEqual(completion.obligations.required, [...COMPLETE_OBLIGATIONS]);
  assert.deepEqual(completion.obligations.unsatisfiedOperational,
    completion.result.operationalGaps.filter((name: string) => COMPLETE_OBLIGATIONS.some(key => key === name)));
  assert.deepEqual([...completion.obligations.unsatisfiedOperational, ...completion.obligations.unknownOperational].sort(),
    [...COMPLETE_OBLIGATIONS].sort());
  assert.equal(completion.measurementObligations.operationalEvidence, false);
  assert.equal(completion.operationalObservations, "unavailable");
  assert.equal(completion.staleness, "current");
  const summary = await (await read("summary")).json();
  assert.equal(summary.snapshotId, a.snapshotId);
  assert.equal(summary.foundation.liveProductionConnection, false);
  assert.equal(summary.foundation.capabilities.utm, "unsupported");
  assert.equal(summary.registrationSummary.waitlisted, 0);
  assert.equal(summary.registrationSummary.cancelled, 0);
  assert.equal(summary.attendanceSummary.operationallyVerified, false);
  assert.equal(summary.suppression.operational, false);
  assert.equal(summary.evaluation.missingEvaluatorCoverage.length, 0);
  const page = await (await read("history?limit=2")).json();
  assert.equal(page.returned, 2);
  assert.ok(page.total >= 5);
  assert.ok(page.nextRevision != null);
  const cursor = await (await read(`history?afterRevision=${page.nextRevision}&limit=2`)).json();
  assert.ok(cursor.records.every((r: { revision: number }) => r.revision > page.nextRevision));
  const fullHistory = await (await read("history?limit=100")).json();
  assert.equal(fullHistory.records.length, fullHistory.total);
  for (const record of fullHistory.records) {
    assert.equal("simulation" in record.payload, false);
    assert.equal("governedReceipt" in record.payload, false);
    assert.equal("providerResponse" in record.payload, false);
    if (record.kind === "evidence") assert.deepEqual(Object.keys(record.payload).sort(), ["evidenceType", "result"]);
    if (record.kind === "source") assert.deepEqual(Object.keys(record.payload).sort(),
      ["sourceType", "sourceVersion", "status"]);
  }
  const conflict = await post("evaluations", { ...input, calculationAt: "2026-01-02T00:00:00Z" });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "IDEMPOTENCY_CONFLICT");
});
test("draft exception cannot self-exempt, use unavailable evidence or invent an eligible failed blocker", async () => {
  const context = await loadWebinarApiContext({ campaignId, sessionId }, activityId);
  const evidence = context.sources.records.find(r => r.kind === "evidence")!;
  const input = { ruleId: "WEB-EXC-001" as const, evidenceId: evidence.id, reasonCode: "synthetic-review",
    expectedRevision: context.sources.binding!.revision, idempotencyKey: randomUUID(), calculationAt: clock,
    expiresAt: "2027-01-01T00:00:00.000Z" };
  await assert.rejects(requestDraftException({ campaignId, sessionId }, activityId, input),
    (error: unknown) => error instanceof WebinarApiError && error.code === "VALIDATION_ERROR");
  const request = await post("exceptions", input);
  assert.equal(request.status, 400);
  for (const expiresAt of [clock, "2025-12-31T00:00:00.000Z"]) {
    const expired = await post("exceptions", { ...input, ruleId: "WEB-QA-001",
      expiresAt, idempotencyKey: randomUUID() });
    assert.equal(expired.status, 400);
    assert.equal((await expired.json()).error.code, "VALIDATION_ERROR");
  }
  for (const evidenceId of [randomUUID(), evidence.id]) {
    const incomplete = await post("exceptions", { ...input, ruleId: "WEB-QA-001",
      evidenceId, idempotencyKey: randomUUID() });
    assert.equal(incomplete.status, 422);
    assert.equal((await incomplete.json()).error.code, "EVALUATION_INCOMPLETE");
  }
  const review = await post(`exceptions/${randomUUID()}/review`, {});
  assert.equal(review.status, 403);
  assert.equal((await review.json()).error.code, "UNAUTHORIZED");
  assert.equal((await pool.query(`SELECT count(*)::int AS total FROM webinar_persistence_records
    WHERE kind='exception-disposition' AND campaign_id=$1 AND session_id=$2`, [campaignId, sessionId])).rows[0].total, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS total FROM organization_audit
    WHERE action='development_webinar_exception_requested' AND campaign_id=$1
      AND details->>'occurrenceId'=$2`, [campaignId, sessionId])).rows[0].total, 0);
});
test("non-webinar and historical occurrences are not converted into new-standard API resources", async () => {
  const other = (await pool.query(`INSERT INTO activities(campaign_id,name,type,activity_type_id,audience,region,timing,status,owner,x,y)
    VALUES($1,'Synthetic API non-webinar','Event','events','Synthetic','Global','TBD','Draft','Synthetic',0,0) RETURNING id`, [campaignId])).rows[0].id;
  const client = await pool.connect();
  let otherSession: string;
  try {
    await client.query("BEGIN");
    otherSession = (await client.query(`INSERT INTO webinar_sessions(campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform,template_version)
      VALUES($1,$2,'Synthetic non-webinar occurrence','2026-06-16','10:00',60,'UTC','Synthetic','default_5') RETURNING id`,
    [campaignId, other])).rows[0].id;
    await initializeNewSyntheticOccurrence(client, campaignId, otherSession, actorId, "draft");
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  const wrong = await fetch(`${origin}/campaigns/${campaignId}/webinars/${otherSession!}/standard/summary`);
  assert.equal(wrong.status, 409);
  assert.equal((await wrong.json()).error.code, "CAPABILITY_UNAVAILABLE");
  const foundationWrong = await fetch(`${origin}/development/foundation/observations?${new URLSearchParams({
    campaignId, activityId: other, occurrenceId: otherSession!,
  })}`);
  assert.equal(foundationWrong.status, 409);
  assert.equal((await foundationWrong.json()).code, "CAPABILITY_UNAVAILABLE");
  const historical = (await pool.query(`INSERT INTO webinar_sessions(campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform,template_version)
    VALUES($1,$2,'Historical unbound occurrence','2026-06-17','10:00',60,'UTC','Synthetic','default_5') RETURNING id`,
  [campaignId, activityId])).rows[0].id;
  const unbound = await fetch(`${origin}/campaigns/${campaignId}/webinars/${historical}/standard/summary`);
  assert.equal(unbound.status, 409);
  assert.equal((await unbound.json()).error.code, "CAPABILITY_UNAVAILABLE");
});
test("source edits without a persistence revision still mark historical snapshot stale", async () => {
  const before = await (await read("summary")).json();
  assert.equal(before.staleness, "current");
  const revision = before.snapshotRevision;
  await pool.query("UPDATE activities SET audience='Synthetic changed audience' WHERE id=$1", [activityId]);
  const [summary, readiness, completion] = await Promise.all([
    read("summary").then(r => r.json()), read("readiness").then(r => r.json()),
    read("completion").then(r => r.json()),
  ]);
  assert.equal(summary.snapshotRevision, revision);
  for (const item of [summary, readiness, completion]) {
    assert.equal(item.staleness, "stale");
    assert.equal(item.operationalReadiness, false);
    assert.equal(item.engineReleaseFingerprint, before.engineReleaseFingerprint);
  }
});
test("missing and expired scoped sources cannot be asserted as evidence", async () => {
  const hash = simulationFingerprint("synthetic-invalid-source");
  for (const status of ["missing", "expired"] as const) {
    const binding = await pool.query("SELECT revision FROM webinar_persistence_bindings WHERE session_id=$1", [sessionId]);
    const source = await new WebinarPersistence().append({
      campaignId, sessionId, actorId, expectedRevision: binding.rows[0].revision,
      idempotencyKey: randomUUID(), standard: { id: STANDARD_ID, version: STANDARD_VERSION },
      calculationAt: clock, inputFingerprint: simulationFingerprint({ status, id: randomUUID() }),
      operational: false, payload: { kind: "source", sourceSystem: "synthetic-api-test",
        sourceType: "content", sourceId: sessionId, sourceVersion: "test-v1", sourceHash: hash,
        observedAt: clock, status },
    });
    const response = await post("evidence", { sourceId: source.id, sourceType: "content",
      sourceVersion: "test-v1", sourceHash: hash, evidenceType: "source-observation",
      expectedRevision: source.revision, calculationAt: clock, idempotencyKey: randomUUID() });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, "MISSING_REQUIRED_INPUT");
  }
});
test("a source from a separate eligible occurrence cannot be reused by this occurrence", async () => {
  const client = await pool.connect();
  let secondSession: string;
  try {
    await client.query("BEGIN");
    secondSession = (await client.query(`INSERT INTO webinar_sessions(campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform,template_version)
      VALUES($1,$2,'Synthetic separate occurrence','2026-06-18','10:00',60,'UTC','Synthetic','default_5') RETURNING id`,
    [campaignId, activityId])).rows[0].id;
    await initializeNewSyntheticOccurrence(client, campaignId, secondSession, actorId, "draft");
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  const hash = simulationFingerprint("synthetic-other-occurrence");
  const otherSource = await new WebinarPersistence().append({
    campaignId, sessionId: secondSession!, actorId, expectedRevision: 1,
    idempotencyKey: randomUUID(), standard: { id: STANDARD_ID, version: STANDARD_VERSION },
    calculationAt: clock, inputFingerprint: simulationFingerprint("other-occurrence-source"),
    operational: false, payload: { kind: "source", sourceSystem: "synthetic-api-test",
      sourceType: "content", sourceId: secondSession!, sourceVersion: "test-v1", sourceHash: hash,
      observedAt: clock, status: "available" },
  });
  const revision = (await pool.query("SELECT revision FROM webinar_persistence_bindings WHERE session_id=$1",
    [sessionId])).rows[0].revision;
  const response = await post("evidence", { sourceId: otherSource.id, sourceType: "content",
    sourceVersion: "test-v1", sourceHash: hash, evidenceType: "source-observation",
    expectedRevision: revision, calculationAt: clock, idempotencyKey: randomUUID() });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "MISSING_REQUIRED_INPUT");
});
test("a future observed content version cannot support a backdated evidence calculation", async () => {
  const revision = (await pool.query("SELECT revision FROM webinar_persistence_bindings WHERE session_id=$1",
    [sessionId])).rows[0].revision;
  const hash = simulationFingerprint("future-synthetic-content");
  const source = await new WebinarPersistence().append({
    campaignId, sessionId, actorId, expectedRevision: revision,
    idempotencyKey: randomUUID(), standard: { id: STANDARD_ID, version: STANDARD_VERSION },
    calculationAt: "2026-01-02T00:00:00.000Z", inputFingerprint: simulationFingerprint("future-content"),
    operational: false, payload: { kind: "source", sourceSystem: "synthetic-api-test",
      sourceType: "content", sourceId: sessionId, sourceVersion: "test-v2", sourceHash: hash,
      observedAt: "2026-01-02T00:00:00.000Z", status: "available" },
  });
  const response = await post("evidence", { sourceId: source.id, sourceType: "content",
    sourceVersion: "test-v2", sourceHash: hash, evidenceType: "source-observation",
    expectedRevision: source.revision, calculationAt: clock, idempotencyKey: randomUUID() });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "STALE_INPUT");
});

/** Disposable-only seam: persist an actual strict canonical pure-evaluator result, never
 * fabricate a failed finding or change a canonical fixture/runtime evaluator. The
 * accepted source adapter cannot yet establish complete produced-deliverable inventory. */
async function seededExceptionScope() {
  const client = await pool.connect();
  let occurrenceId: string;
  try {
    await client.query("BEGIN");
    occurrenceId = (await client.query(`INSERT INTO webinar_sessions(campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform,template_version)
      VALUES($1,$2,$3,'2025-12-15','10:00',60,'UTC','Synthetic','default_5') RETURNING id`,
    [campaignId, activityId, `Synthetic exception fixture ${randomUUID()}`])).rows[0].id;
    await initializeNewSyntheticOccurrence(client, campaignId, occurrenceId, actorId, "draft");
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  const scope = { campaignId, sessionId: occurrenceId! };
  const sourceHash = simulationFingerprint({ synthetic: "exception-test", occurrenceId });
  const repository = new WebinarPersistence();
  const source = await repository.append({ ...scope, actorId, expectedRevision: 1, idempotencyKey: randomUUID(),
    standard: { id: STANDARD_ID, version: STANDARD_VERSION }, calculationAt: clock,
    inputFingerprint: simulationFingerprint({ kind: "exception-test", occurrenceId }), operational: false,
    payload: { kind: "source", sourceSystem: "synthetic-api-test", sourceType: "content",
      sourceId: occurrenceId!, sourceVersion: "exception-fixture-v1", sourceHash, observedAt: clock, status: "available" } });
  const evidence = await submitWebinarEvidence(scope, activityId, {
    sourceId: source.id, sourceType: "content", sourceVersion: "exception-fixture-v1", sourceHash,
    evidenceType: "source-observation", expectedRevision: source.revision, idempotencyKey: randomUUID(),
    calculationAt: clock,
  });
  const reader = await pool.connect();
  let sources: Awaited<ReturnType<typeof loadOccurrenceSources>>;
  try { sources = await loadOccurrenceSources(reader, campaignId, scope.sessionId); }
  finally { reader.release(); }
  const assembly = assembleEvaluationInput({ ...occurrenceAssemblySource(sources, clock), baseFacts: {
    registrationFlowTest: { confirmed: false, evidence: "Synthetic canonical test: registration failed" },
    followUp: { attended: { variantId: "synthetic-attended", messageContent: "identical synthetic text", destinationId: null },
      absent: { variantId: "synthetic-absent", messageContent: "identical synthetic text", destinationId: null },
      distinctContentConfirmation: null },
  } });
  assert.ok(assembly.context, "pure evaluator must use an actual canonical assembly");
  const catalog = await loadWebinarStandardCatalog();
  const release = await captureWebinarRelease(Date.parse(clock));
  const inputFingerprint = sourceInputFingerprint(sources, clock);
  const { snapshot } = evaluateCanonicalAssembly({ assembly, catalog, activityId, occurrenceId: scope.sessionId,
    calculationAt: clock, releaseFingerprint: release.digest, engineRelease: release.engineRelease, inputFingerprint });
  const eligible = snapshot.unresolvedBlockingFailures.find(r => r.ruleId === "WEB-FU-VAR-001"
    && r.status === "fail" && r.rule.exceptionEligible);
  const ineligible = snapshot.unresolvedBlockingFailures.find(r => r.ruleId === "WEB-SETUP-005"
    && r.status === "fail" && !r.rule.exceptionEligible);
  assert.ok(eligible, "real canonical fixture must fail its exception-eligible follow-up rule");
  assert.ok(ineligible, "past synthetic session must fail a non-exception-eligible mandatory rule");
  const common = { ...scope, actorId, standard: { id: STANDARD_ID, version: STANDARD_VERSION },
    calculationAt: clock, inputFingerprint, operational: false as const };
  const releaseRow = await repository.append({ ...common, expectedRevision: evidence.revision,
    idempotencyKey: randomUUID(), payload: { kind: "release" } });
  const readiness = await repository.append({ ...common, expectedRevision: releaseRow.revision,
    idempotencyKey: randomUUID(), releaseId: releaseRow.id, payload: {
      kind: "readiness", stage: "completion", result: "not-ready",
      resultFingerprint: simulationFingerprint(snapshot), evidenceIds: [evidence.id], exceptionIds: [],
      simulation: snapshot,
    } });
  const inspected = await loadWebinarApiContext(scope, activityId);
  assert.equal(inspected.latest?.revision, readiness.revision);
  assert.ok(inspected.latest?.payload.evidenceIds.includes(evidence.id));
  assert.equal(inspected.latest?.payload.simulation.calculationAt, clock);
  assert.equal(sourceInputFingerprint(inspected.sources, clock), snapshot.inputFingerprint,
    "test evaluator snapshot must be bound to the same immutable scoped source facts");
  return { scope, evidenceId: evidence.id, snapshot, revision: readiness.revision,
    eligibleRuleId: eligible.ruleId, ineligibleRuleId: ineligible.ruleId };
}

const exceptionPath = (scope: { campaignId: string; sessionId: string }) =>
  `${origin}/campaigns/${scope.campaignId}/webinars/${scope.sessionId}/standard/exceptions`;
async function submitException(scope: { campaignId: string; sessionId: string }, body: unknown) {
  return fetch(exceptionPath(scope), { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body) });
}
const exceptionCommand = (seed: Awaited<ReturnType<typeof seededExceptionScope>>) => ({
  ruleId: seed.eligibleRuleId, evidenceId: seed.evidenceId, reasonCode: "synthetic-conditional-exception",
  expectedRevision: seed.revision, idempotencyKey: randomUUID(), calculationAt: clock,
  expiresAt: "2026-12-31T00:00:00.000Z",
});

test("canonical failed/nonblocking/ineligible rules and missing evidence reject draft creation", async () => {
  const seed = await seededExceptionScope();
  const command = exceptionCommand(seed);
  const nonblocking = seed.snapshot.results.find(r => r.ruleId === "WEB-REC-001");
  assert.equal(nonblocking?.rule.primaryRuleType, "Recommended default");
  assert.equal(seed.snapshot.unresolvedBlockingFailures.some(r => r.ruleId === nonblocking?.ruleId), false);
  for (const [change, status, code] of [
    [{ ruleId: seed.ineligibleRuleId }, 409, "CAPABILITY_UNAVAILABLE"],
    [{ ruleId: "WEB-REC-001" }, 422, "EVALUATION_INCOMPLETE"],
    [{ ruleId: "WEB-EXC-001" }, 400, "VALIDATION_ERROR"],
    [{ evidenceId: randomUUID() }, 422, "MISSING_REQUIRED_INPUT"],
  ] as const) {
    const response = await submitException(seed.scope, { ...command, ...change, idempotencyKey: randomUUID() });
    assert.equal(response.status, status, JSON.stringify(change));
    assert.equal((await response.json()).error.code, code);
  }
  const audit = await pool.query(`SELECT 1 FROM organization_audit
    WHERE action='development_webinar_exception_requested' AND campaign_id=$1
      AND details->>'occurrenceId'=$2`, [campaignId, seed.scope.sessionId]);
  assert.equal(audit.rowCount, 0);
});

test("draft exception exact concurrent retry persists once with one atomic audit, changed key conflicts", async () => {
  const seed = await seededExceptionScope();
  const command = exceptionCommand(seed);
  const [left, right] = await Promise.all([submitException(seed.scope, command), submitException(seed.scope, command)]);
  const [a, b] = await Promise.all([left.json(), right.json()]);
  assert.equal(left.status, 201, JSON.stringify(a));
  assert.equal(right.status, 201, JSON.stringify(b));
  assert.equal(a.id, b.id);
  assert.deepEqual(new Set([a.replayed, b.replayed]), new Set([true, false]));
  assert.equal(a.status, "draft-unverified");
  assert.equal(a.resolvesBlocker, false);
  const history = await pool.query(`SELECT id,payload,actor_id FROM webinar_persistence_records
    WHERE campaign_id=$1 AND session_id=$2 AND kind='exception-request'`, [campaignId, seed.scope.sessionId]);
  assert.equal(history.rowCount, 1);
  assert.equal(history.rows[0].id, a.id);
  assert.equal(history.rows[0].actor_id, actorId);
  const audit = await pool.query(`SELECT details FROM organization_audit
    WHERE action='development_webinar_exception_requested' AND campaign_id=$1
      AND details->>'occurrenceId'=$2`, [campaignId, seed.scope.sessionId]);
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].details.recordId, a.id);
  assert.equal(audit.rows[0].details.expiresAt, command.expiresAt);
  const changed = await submitException(seed.scope, { ...command, reasonCode: "changed-synthetic-rationale" });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, "IDEMPOTENCY_CONFLICT");
  const newKey = await submitException(seed.scope, { ...command, idempotencyKey: randomUUID() });
  assert.equal(newKey.status, 409);
  assert.equal((await newKey.json()).error.code, "STALE_INPUT");
  const listed = await fetch(exceptionPath(seed.scope));
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).records.length, 1);
});

test("different-key draft race permits exactly one append; review never promotes its request", async () => {
  const seed = await seededExceptionScope();
  const first = exceptionCommand(seed), second = { ...first, idempotencyKey: randomUUID() };
  const [a, b] = await Promise.all([submitException(seed.scope, first), submitException(seed.scope, second)]);
  const [bodyA, bodyB] = await Promise.all([a.json(), b.json()]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409], JSON.stringify([bodyA, bodyB]));
  const accepted = a.status === 201 ? bodyA : bodyB;
  const denied = a.status === 409 ? bodyA : bodyB;
  assert.equal(denied.error.code, "STALE_INPUT");
  const review = await fetch(`${exceptionPath(seed.scope)}/${accepted.id}/review`, {
    method: "POST", headers: { "content-type": "application/json", "x-actor-role": "reviewer" }, body: "{}",
  });
  assert.equal(review.status, 403);
  assert.equal((await review.json()).error.code, "UNAUTHORIZED");
  const dispositions = await pool.query(`SELECT 1 FROM webinar_persistence_records
    WHERE campaign_id=$1 AND session_id=$2 AND kind='exception-disposition'`, [campaignId, seed.scope.sessionId]);
  assert.equal(dispositions.rowCount, 0);
});

test("audit insertion failure rolls back the draft request and binding revision atomically", async () => {
  const seed = await seededExceptionScope();
  const command = exceptionCommand(seed);
  // This disposable-only trigger exercises the real database failure *after*
  // repository.append, without modifying production schema or application logic.
  await pool.query(`CREATE FUNCTION development_webinar_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic audit rejection'; END $$`);
  await pool.query(`CREATE TRIGGER development_webinar_test_reject_audit
    BEFORE INSERT ON organization_audit FOR EACH ROW
    WHEN (NEW.action = 'development_webinar_exception_requested')
    EXECUTE FUNCTION development_webinar_test_reject_audit()`);
  try {
    const response = await submitException(seed.scope, command);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(JSON.stringify(body), /synthetic audit rejection|postgres|stack|at Router/i);
    const request = await pool.query(`SELECT id FROM webinar_persistence_records
      WHERE campaign_id=$1 AND session_id=$2 AND kind='exception-request'`, [campaignId, seed.scope.sessionId]);
    assert.equal(request.rowCount, 0);
    const binding = await pool.query("SELECT revision FROM webinar_persistence_bindings WHERE session_id=$1",
      [seed.scope.sessionId]);
    assert.equal(binding.rows[0].revision, seed.revision);
    const audit = await pool.query(`SELECT 1 FROM organization_audit
      WHERE action='development_webinar_exception_requested' AND campaign_id=$1
        AND details->>'occurrenceId'=$2`, [campaignId, seed.scope.sessionId]);
    assert.equal(audit.rowCount, 0);
  } finally {
    await pool.query("DROP TRIGGER development_webinar_test_reject_audit ON organization_audit");
    await pool.query("DROP FUNCTION development_webinar_test_reject_audit()");
  }
  const recovered = await submitException(seed.scope, command);
  assert.equal(recovered.status, 201, JSON.stringify(await recovered.clone().json()));
  const committed = await pool.query(`SELECT 1 FROM organization_audit
    WHERE action='development_webinar_exception_requested' AND campaign_id=$1
      AND details->>'occurrenceId'=$2`, [campaignId, seed.scope.sessionId]);
  assert.equal(committed.rowCount, 1);
});