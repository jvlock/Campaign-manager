import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { after, before, test } from "node:test";
import { pool } from "@workspace/db";
import { assembleEvaluationInput } from "../src/lib/webinar-domain-adapters";
import { loadWebinarStandardCatalog, STANDARD_ID, STANDARD_VERSION } from "../src/lib/webinar-standard-catalog";
import { evaluateCanonicalAssembly, EvaluationImplementationError, initializeNewSyntheticOccurrence, simulateWebinarOccurrence, simulationFingerprint, sourceInputFingerprint, type WebinarSimulationInput } from "../src/lib/webinar-evaluation-orchestration";
import { createWebinarEvaluatorRegistry, type EvaluationContext } from "../src/lib/webinar-standard-evaluation";
import { fixture as governedFixture, now as governedFixtureTime } from "./evaluation/governed-fixtures";
import { loadOccurrenceSources, occurrenceAssemblySource } from "../src/lib/webinar-evaluation-sources";
import { persistencePayload, PersistenceConflict, WebinarPersistence } from "../src/lib/webinar-persistence";
import { captureWebinarRelease } from "../src/lib/webinar-release-provenance";
import { SyntheticContractAdapter, knownSyntheticFixtureProvider } from "../src/lib/webinar-foundation";
import { inspectFoundationObservations } from "../src/lib/webinar-foundation-service";

const calculationAt = "2026-01-01T00:00:00.000Z";
let actorId: string;
before(async () => {
  const identity = await pool.query("SELECT current_setting('data_directory') AS directory, inet_server_addr() IS NULL AS socket");
  assert.match(identity.rows[0].directory, /^\/tmp\/disposable-pg-[^/]+\/data$/);
  assert.equal(identity.rows[0].socket, true);
  actorId = (await pool.query("INSERT INTO users(name,email) VALUES ('Synthetic simulation',$1) RETURNING id", [`${randomUUID()}@example.invalid`])).rows[0].id;
});
after(async () => { await pool.end(); });

async function occurrence(options: { eligible?: boolean; status?: "draft" | "cancelled"; date?: string; timezone?: string } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const campaignId = (await client.query(`INSERT INTO campaigns(name,scope,audience,outcome) VALUES ('Synthetic orchestration','Global','Synthetic','Synthetic') RETURNING id`)).rows[0].id;
    const activityId = (await client.query(`INSERT INTO activities(campaign_id,name,type,activity_type_id,audience,region,timing,status,owner,x,y)
      VALUES ($1,'Synthetic webinar','Webinar','webinar','Synthetic','Global','TBD','Draft','Synthetic',0,0) RETURNING id`, [campaignId])).rows[0].id;
    await client.query(`INSERT INTO development_record_registry(entity_type,entity_id) VALUES ('campaign',$1),('activity',$2) ON CONFLICT DO NOTHING`, [campaignId, activityId]);
    const sessionId = (await client.query(`INSERT INTO webinar_sessions(campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform,template_version)
      VALUES ($1,$2,'Synthetic occurrence',$3,'10:00',60,$4,'Synthetic','default_5') RETURNING id`, [campaignId, activityId, options.date ?? "2026-06-15", options.timezone ?? "UTC"])).rows[0].id;
    if (options.eligible !== false) await initializeNewSyntheticOccurrence(client, campaignId, sessionId, actorId, options.status ?? "draft");
    await client.query("COMMIT");
    return { campaignId, activityId, sessionId };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
function command(scope: { campaignId: string; sessionId: string }, extra: Partial<WebinarSimulationInput> = {}): WebinarSimulationInput {
  return { ...scope, actorId, calculationAt, expectedRevision: 1, idempotencyKey: randomUUID(), ...extra };
}
function exactCommand(scope: { campaignId: string; sessionId: string }, extra: Partial<WebinarSimulationInput> = {}) {
  return command({ campaignId: scope.campaignId, sessionId: scope.sessionId }, extra);
}

test("all 106 evaluators, canonical readiness/completion, provenance and source immutability", async () => {
  const scope = await occurrence();
  const client = await pool.connect();
  const before = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
  client.release();
  assert.equal(before.development, true, "synthetic scope");
  assert.equal(before.legacy, false, "nonlegacy scope");
  assert.equal(before.records[0]?.payload.simulationEligibility, "new-synthetic-occurrence", "explicit opt-in plan");
  const result = await simulateWebinarOccurrence(exactCommand(scope));
  assert.equal(result.operationalStatus, "simulation-only");
  assert.equal(result.results.length, 106);
  assert.equal(new Set(result.diagnostics.invokedRuleIds).size, 106);
  assert.equal(result.evaluatorCoverage.implementedRuleCount, 106);
  assert.equal(result.readinessStages.length, 4);
  assert.equal(result.completionResult.complete, false);
  assert.equal(result.standard.version, STANDARD_VERSION);
  assert.ok(result.missingInputData.some(gap => gap.field === "participant"));
  assert.ok(result.unavailableExternalObservations.some(gap => /Foundation/.test(gap.reason)));
  assert.equal(result.releaseFingerprint, (await captureWebinarRelease(Date.parse(calculationAt))).digest);
  assert.equal(result.inputFingerprint, sourceInputFingerprint(before, calculationAt));
  assert.deepEqual(result.results.map(r => r.ruleId), [...result.results.map(r => r.ruleId)].sort());
  const saved = (await pool.query("SELECT * FROM webinar_persistence_records WHERE id=$1", [result.snapshotId])).rows[0];
  assert.equal(saved.operational, false);
  assert.equal(saved.attribution, "unverified-development");
  assert.equal(saved.payload.simulation.operationalStatus, "simulation-only");
  assert.equal("diagnostics" in saved.payload.simulation, false);
  assert.deepEqual(saved.payload.simulation.results, result.results);
  assert.deepEqual(saved.payload.simulation.nonblockingFailures, result.nonblockingFailures);
  assert.deepEqual(saved.payload.simulation.sourceReferences, result.sourceReferences);
  assert.equal(saved.payload.resultFingerprint, simulationFingerprint(saved.payload.simulation));
  await assert.rejects(pool.query("UPDATE webinar_persistence_records SET payload='{}' WHERE id=$1", [result.snapshotId]));
  const final = await pool.connect();
  const after = await loadOccurrenceSources(final, scope.campaignId, scope.sessionId);
  final.release();
  assert.deepEqual({ ...after, binding: before.binding }, before, "domain records and source references were not changed");
  assert.equal(sourceInputFingerprint(after, calculationAt), result.inputFingerprint);
  assert.equal(persistencePayload.safeParse({ ...saved.payload, simulation: { ...saved.payload.simulation, diagnostics: {} } }).success, false);
});

test("synthetic provider persists immutable scoped receipts before evaluation; concurrent retry replays snapshot", async () => {
  const scope = await occurrence();
  const provider = new SyntheticContractAdapter("synthetic-v1", "taxonomy-v1", request => {
    const output = request.type === "taxonomy" ? { type: "taxonomy", classifications: [{ id: "webinar", label: "Webinar" }] }
      : request.type === "internal_title" ? { type: "internal_title", title: "Governed fixture title", components: { activity: "Webinar" } }
      : request.type === "campaign_code" ? { type: "campaign_code", code: `SIM${scope.sessionId.replaceAll("-", "")}`, reservation: "simulated" }
      : null;
    return { status: output ? "success" : "unavailable", type: request.type, environment: "synthetic",
      scope: request.scope, serviceId: "fixture", serviceVersion: "synthetic-v1", taxonomyVersion: "taxonomy-v1",
      requestReference: request.requestReference, inputFingerprint: request.inputFingerprint,
      respondedAt: "2025-12-30T00:00:00Z", validFrom: "2025-12-29T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z", deprecated: false,
      provenance: { adapter: "synthetic-contract", reference: "fixture-1" },
      warnings: [], errors: output ? [] : [{ code: "input_unavailable" }], output };
  });
  const input = exactCommand(scope);
  const [first, replay] = await Promise.all([simulateWebinarOccurrence(input, provider), simulateWebinarOccurrence(input, provider)]);
  assert.equal(first.snapshotId, replay.snapshotId);
  assert.equal(first.results.length, 106);
  assert.equal(first.diagnostics.foundation?.connectorReachable, true);
  assert.equal(first.diagnostics.foundation?.liveProductionConnection, false);
  assert.equal(first.diagnostics.foundation?.observations.filter(o => o.status === "available").length, 3);
  assert.ok(first.sourceReferences.some(r => r.sourceType === "foundation:internal_title"));
  const records = (await pool.query(`SELECT id,revision,payload FROM webinar_persistence_records
    WHERE session_id=$1 ORDER BY revision`, [scope.sessionId])).rows;
  assert.equal(records.filter(r => r.kind === "source" || r.payload.kind === "source").length, 3);
  assert.equal(records.at(-1)?.revision, first.revision);
  assert.equal(records.at(-1)?.payload.simulation.results.length, 106);
  assert.equal(records.at(-1)?.payload.simulation.diagnostics, undefined);
  const receipts = records.filter(r => r.payload.governedReceipt);
  assert.ok(receipts.every(r => r.payload.governedReceipt.simulationOnly === true));
  await assert.rejects(pool.query("UPDATE webinar_persistence_records SET payload='{}' WHERE id=$1", [receipts[0].id]));
});

test("global code lock serializes two occurrences and never recycles a synthetic code", async () => {
  const firstScope = await occurrence(), secondScope = await occurrence();
  const provider = new SyntheticContractAdapter("synthetic-v1", "taxonomy-v1", request => ({
    status: request.type === "campaign_code" ? "success" : "unavailable",
    type: request.type, environment: "synthetic", scope: request.scope, serviceId: "fixture",
    serviceVersion: "synthetic-v1", taxonomyVersion: "taxonomy-v1",
    requestReference: request.requestReference, inputFingerprint: request.inputFingerprint,
    respondedAt: "2025-12-30T00:00:00Z", validFrom: "2025-12-29T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z", deprecated: false,
    provenance: { adapter: "synthetic-contract", reference: "fixture-1" },
    warnings: [], errors: request.type === "campaign_code" ? [] : [{ code: "input_unavailable" }],
    output: request.type === "campaign_code" ? { type: "campaign_code", code: "SIMUNIQUE", reservation: "simulated" } : null,
  }));
  const [first, second] = await Promise.all([
    simulateWebinarOccurrence(exactCommand(firstScope), provider),
    simulateWebinarOccurrence(exactCommand(secondScope), provider),
  ]);
  assert.equal([first, second].filter(s => s.diagnostics.foundation?.observations.some(o =>
    o.type === "campaign_code" && o.status === "available")).length, 1);
  assert.equal([first, second].filter(s => s.diagnostics.foundation?.observations.some(o =>
    o.type === "campaign_code" && o.error === "conflict")).length, 1);
  const used = await pool.query(`SELECT count(*)::int AS count FROM webinar_persistence_records
    WHERE kind='source' AND payload #>> '{governedReceipt,response,output,code}'='SIMUNIQUE'`);
  assert.equal(used.rows[0].count, 1);
});

test("accepted governed receipt enters snapshot fingerprint and remains immutable in history", async () => {
  const scope = await occurrence();
  const provider = new SyntheticContractAdapter("synthetic-v1", "taxonomy-v1", request => ({
    status: request.type === "taxonomy" ? "success" : "unavailable", type: request.type,
    environment: "synthetic", scope: request.scope, serviceId: "fixture", serviceVersion: "synthetic-v1",
    taxonomyVersion: "taxonomy-v1", requestReference: request.requestReference,
    inputFingerprint: request.inputFingerprint, respondedAt: "2025-12-30T00:00:00Z",
    validFrom: "2025-12-29T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z", deprecated: false,
    provenance: { adapter: "synthetic-contract", reference: "fixture-1" }, warnings: [],
    errors: request.type === "taxonomy" ? [] : [{ code: "input_unavailable" }],
    output: request.type === "taxonomy" ? { type: "taxonomy",
      classifications: [{ id: "webinar", label: "Webinar" }] } : null,
  }));
  const before = await pool.connect();
  const original = await loadOccurrenceSources(before, scope.campaignId, scope.sessionId);
  before.release();
  const originalFingerprint = sourceInputFingerprint(original, calculationAt);
  const result = await simulateWebinarOccurrence(exactCommand(scope), provider);
  const after = await pool.connect();
  const current = await loadOccurrenceSources(after, scope.campaignId, scope.sessionId);
  after.release();
  assert.notEqual(result.inputFingerprint, originalFingerprint);
  assert.equal(result.inputFingerprint, sourceInputFingerprint(current, calculationAt));
  assert.equal((await pool.query("SELECT payload->'simulation'->>'inputFingerprint' AS fingerprint FROM webinar_persistence_records WHERE id=$1",
    [result.snapshotId])).rows[0].fingerprint, result.inputFingerprint);
});

test("wall-clock-later synthetic receipt survives persisted inspection and fixed-instant refresh retry", async () => {
  const scope = await occurrence();
  const fixedAsOf = new Date(Date.now() - 2000).toISOString();
  const input = exactCommand(scope, { calculationAt: fixedAsOf });
  const provider = knownSyntheticFixtureProvider();
  const first = await simulateWebinarOccurrence(input, provider, true);
  const initial = first.diagnostics.foundation?.observations.find(o => o.type === "taxonomy");
  assert.equal(initial?.status, "available");
  assert.ok(Date.parse(initial.response!.respondedAt) > Date.parse(fixedAsOf));
  const client = await pool.connect();
  const saved = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
  client.release();
  const inspection = inspectFoundationObservations(saved, new Date(fixedAsOf), provider, first.releaseFingerprint);
  const taxonomy = inspection.observations.find(o => o.type === "taxonomy");
  assert.equal(taxonomy?.status, "available");
  assert.equal(taxonomy?.error, null);
  assert.equal(taxonomy?.source, "immutable-history");
  assert.ok(saved.records.some(r => {
    const receipt = r.payload.governedReceipt as { receivedAt?: string } | undefined;
    return receipt?.receivedAt && Date.parse(receipt.receivedAt) > Date.parse(fixedAsOf);
  }));
  const latest = await pool.query(`SELECT calculation_at FROM webinar_persistence_records
    WHERE campaign_id=$1 AND session_id=$2 AND kind='readiness' ORDER BY revision DESC LIMIT 1`,
  [scope.campaignId, scope.sessionId]);
  assert.equal(new Date(latest.rows[0].calculation_at).toISOString(), fixedAsOf);
  assert.equal((await captureWebinarRelease(new Date(latest.rows[0].calculation_at).getTime())).digest, first.releaseFingerprint);
  assert.notEqual((await captureWebinarRelease(Date.now())).digest, first.releaseFingerprint);
  const retry = await simulateWebinarOccurrence({
    ...input, idempotencyKey: randomUUID(), expectedRevision: first.revision,
  }, provider, true);
  assert.equal(retry.snapshotId, first.snapshotId);
  assert.equal(retry.releaseFingerprint, first.releaseFingerprint);
  assert.equal(retry.diagnostics.replayed, true);
  const persisted = await pool.query(`SELECT count(*)::int AS count FROM webinar_persistence_records
    WHERE session_id=$1 AND kind='source' AND payload->>'sourceType'='foundation'`, [scope.sessionId]);
  assert.equal(persisted.rows[0].count, 1);
});

test("objective and exclusion receipts persist but cannot pass without complete canonical setup/population", async () => {
  const scope = await occurrence();
  await pool.query(`UPDATE activities SET activity_answers='{"objectiveId":"objective_1","audienceId":"audience_1"}'::jsonb
    WHERE id=$1`, [scope.activityId]);
  const provider = new SyntheticContractAdapter("synthetic-v1", "taxonomy-v1", request => {
    const output = request.type === "objective_membership" ? { type: "objective_membership", objectiveId: "objective_1", decision: true }
      : request.type === "campaign_exclusion" ? { type: "campaign_exclusion", audienceId: "audience_1", decision: false } : null;
    return { status: output ? "success" : "unavailable", type: request.type, environment: "synthetic",
      scope: request.scope, serviceId: "fixture", serviceVersion: "synthetic-v1", taxonomyVersion: "taxonomy-v1",
      requestReference: request.requestReference, inputFingerprint: request.inputFingerprint,
      respondedAt: "2025-12-30T00:00:00Z", validFrom: "2025-12-29T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z", deprecated: false,
      provenance: { adapter: "synthetic-contract", reference: "fixture-1" },
      warnings: [], errors: output ? [] : [{ code: "input_unavailable" }], output };
  });
  const result = await simulateWebinarOccurrence(exactCommand(scope), provider);
  assert.equal(result.diagnostics.foundation?.observations.filter(o => o.status === "available").length, 2);
  assert.ok(result.unavailableExternalObservations.some(g => g.field === "governed.objective_membership"));
  assert.ok(result.unavailableExternalObservations.some(g => g.field === "governed.campaign_exclusion"));
  for (const id of ["WEB-SETUP-003", "WEB-REC-010"]) assert.notEqual(result.results.find(r => r.ruleId === id)?.status, "pass");
  const persisted = await pool.query(`SELECT count(*)::int AS count FROM webinar_persistence_records
    WHERE session_id=$1 AND kind='source' AND payload->>'sourceType'='foundation'`, [scope.sessionId]);
  assert.equal(persisted.rows[0].count, 2);
  assert.equal(result.completionResult.complete, false);
});

test("same occurrence concurrent idempotent retry and equivalent input reuse one immutable snapshot", async () => {
  const scope = await occurrence(), input = exactCommand(scope);
  const [a, b] = await Promise.all([simulateWebinarOccurrence(input), simulateWebinarOccurrence(input)]);
  assert.equal(a.snapshotId, b.snapshotId);
  assert.equal(a.inputFingerprint, b.inputFingerprint);
  assert.notEqual(a.diagnostics.replayed, b.diagnostics.replayed);
  assert.notEqual(a.diagnostics, b.diagnostics);
  const equivalent = await simulateWebinarOccurrence({ ...input, idempotencyKey: randomUUID(), expectedRevision: a.revision });
  assert.equal(equivalent.snapshotId, a.snapshotId);
  const count = await pool.query("SELECT count(*)::int AS count FROM webinar_persistence_records WHERE session_id=$1 AND kind='readiness'", [scope.sessionId]);
  assert.equal(count.rows[0].count, 1);
  await assert.rejects(simulateWebinarOccurrence({ ...input, expectedRevision: 2 }), PersistenceConflict);
  await assert.rejects(simulateWebinarOccurrence({ ...input, calculationAt: "2026-01-02T00:00:00.000Z" }), PersistenceConflict);
});

test("different occurrences evaluate concurrently without source or diagnostics leakage", async () => {
  const a = await occurrence({ status: "draft" }), b = await occurrence({ status: "cancelled" });
  const [first, second] = await Promise.all([simulateWebinarOccurrence(exactCommand(a)), simulateWebinarOccurrence(exactCommand(b))]);
  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.notEqual(first.inputFingerprint, second.inputFingerprint);
  assert.ok(first.sourceReferences.some(r => r.sourceId === a.campaignId));
  assert.ok(!first.sourceReferences.some(r => r.sourceId === b.campaignId || r.sourceId === b.sessionId));
  assert.ok(!second.sourceReferences.some(r => r.sourceId === a.campaignId || r.sourceId === a.sessionId));
  assert.notEqual(first.diagnostics, second.diagnostics);
  await assert.rejects(simulateWebinarOccurrence(exactCommand({ campaignId: a.campaignId, sessionId: b.sessionId })), /not found/);
});

test("competing same-occurrence calculations enforce the optimistic revision", async () => {
  const scope = await occurrence();
  const outcomes = await Promise.allSettled([
    simulateWebinarOccurrence(exactCommand(scope)),
    simulateWebinarOccurrence(exactCommand(scope, { calculationAt: "2026-01-02T00:00:00.000Z" })),
  ]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(r => r.status === "rejected" && r.reason instanceof PersistenceConflict).length, 1);
});

test("source edits create a new fingerprint and snapshot; stale revisions never overwrite history", async () => {
  const scope = await occurrence(), first = await simulateWebinarOccurrence(exactCommand(scope));
  await pool.query("UPDATE webinar_sessions SET name='Changed synthetic source' WHERE id=$1", [scope.sessionId]);
  await assert.rejects(simulateWebinarOccurrence(exactCommand(scope)), PersistenceConflict);
  const second = await simulateWebinarOccurrence(exactCommand(scope, { expectedRevision: first.revision }));
  assert.notEqual(first.inputFingerprint, second.inputFingerprint);
  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.equal(second.revision, first.revision + 2);
  const original = (await pool.query("SELECT payload FROM webinar_persistence_records WHERE id=$1", [first.snapshotId])).rows[0];
  assert.equal(original.payload.simulation.inputFingerprint, first.inputFingerprint);
});

test("a domain change during evaluation aborts atomically before release or snapshot writes", async () => {
  const scope = await occurrence();
  const originalConnect = pool.connect.bind(pool);
  let changed = false;
  const interceptedConnect = async () => {
    const client = await originalConnect();
    const query = client.query.bind(client), release = client.release.bind(client);
    client.query = (async (sql: string, ...args: unknown[]) => {
      if (typeof sql === "string" && sql.startsWith("LOCK TABLE") && !changed) {
        changed = true;
        const other = await originalConnect();
        try { await other.query("UPDATE webinar_sessions SET platform='Changed during evaluation' WHERE id=$1", [scope.sessionId]); }
        finally { other.release(); }
      }
      return (query as (...params: unknown[]) => unknown)(sql, ...args);
    }) as typeof client.query;
    client.release = (...args) => { client.query = query; client.release = release; release(...args); };
    return client;
  };
  pool.connect = ((...args: unknown[]) => args.length
    ? (originalConnect as (...parameters: unknown[]) => unknown)(...args)
    : interceptedConnect()) as typeof pool.connect;
  try {
    await assert.rejects(simulateWebinarOccurrence(exactCommand(scope)), /changed during evaluation/);
    assert.equal(changed, true);
  } finally { pool.connect = originalConnect; }
  const rows = await pool.query("SELECT kind FROM webinar_persistence_records WHERE session_id=$1 ORDER BY revision", [scope.sessionId]);
  assert.deepEqual(rows.rows.map(r => r.kind), ["plan"]);
});

test("legacy templates alone never authorize; old sessions cannot be opted in", async () => {
  const scope = await occurrence({ eligible: false });
  await assert.rejects(simulateWebinarOccurrence(exactCommand(scope, { expectedRevision: 0 })), /eligibility/);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(initializeNewSyntheticOccurrence(client, scope.campaignId, scope.sessionId, actorId, "draft"), /newly inserted/);
    await client.query("ROLLBACK");
  } finally { client.release(); }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM webinar_persistence_bindings WHERE session_id=$1", [scope.sessionId])).rows[0].n, 0);
});

test("missing event status and ambiguous DST input invoke all rules without inventing canonical facts", async () => {
  const scope = await occurrence();
  const client = await pool.connect();
  const sources = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
  client.release();
  const source = occurrenceAssemblySource(sources, calculationAt), catalog = await loadWebinarStandardCatalog();
  const before = structuredClone(source);
  for (const missing of [
    { ...source, eventStatus: null },
    { ...source, occurrence: { ...source.occurrence, timezone: "Europe/Amsterdam", sessionDate: "2026-03-29", startTime: "02:30" } },
  ]) {
    const assembly = assembleEvaluationInput(missing);
    assert.equal(assembly.context, null);
    const evaluated = evaluateCanonicalAssembly({ assembly, catalog, activityId: scope.activityId, occurrenceId: scope.sessionId, calculationAt, releaseFingerprint: "a".repeat(64), inputFingerprint: "b".repeat(64) });
    assert.equal(evaluated.diagnostics.invokedRuleIds.length, 106);
    assert.equal(evaluated.snapshot.results.every(r => r.status === "evidence_unavailable"), true);
    assert.equal(evaluated.snapshot.passedRules.length, 0);
    assert.equal(evaluated.snapshot.completionResult.complete, false);
    assert.equal(evaluated.snapshot.readinessStages.every(s => s.status !== "ready"), true);
  }
  assert.deepEqual(source, before);
});

test("strict snapshot rejects cross-scope/fingerprint payloads and pagination processes all source records", async () => {
  const scope = await occurrence();
  const repo = new WebinarPersistence();
  let revision = 1;
  for (let index = 0; index < 7; index++) {
    const row = await repo.append({ ...exactCommand(scope, { expectedRevision: revision }), standard: { id: STANDARD_ID, version: STANDARD_VERSION },
      inputFingerprint: simulationFingerprint(index), operational: false, payload: { kind: "plan", state: "draft", eventStatus: "draft", planFingerprint: simulationFingerprint(index) } });
    revision = row.revision;
  }
  let cursor = 0;
  const seen: string[] = [];
  do {
    const page = await repo.load(scope.campaignId, scope.sessionId, cursor, 2);
    seen.push(...page.records.map(r => r.id));
    if (page.nextRevision === null) break;
    cursor = page.nextRevision;
  } while (true);
  assert.equal(seen.length, 8);
  assert.equal(new Set(seen).size, 8);
  const result = await simulateWebinarOccurrence(exactCommand(scope, { expectedRevision: revision }));
  assert.equal(result.sourceReferences.filter(r => r.sourceType === "records").length, 8);
  const saved = (await pool.query("SELECT * FROM webinar_persistence_records WHERE id=$1", [result.snapshotId])).rows[0];
  await assert.rejects(repo.append({ ...exactCommand(scope, { expectedRevision: result.revision }), standard: result.standard, operational: false,
    inputFingerprint: result.inputFingerprint, releaseId: saved.release_id, payload: {
      ...saved.payload, simulation: { ...saved.payload.simulation, occurrenceId: randomUUID() },
    } }), /identity or content fingerprint mismatch/);
});

test("canonical exception resolution preserves original failures; invalid or non-overridable claims never resolve", async () => {
  const scope = await occurrence();
  const client = await pool.connect();
  const sources = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
  client.release();
  const catalog = await loadWebinarStandardCatalog();
  const assembly = assembleEvaluationInput({ ...occurrenceAssemblySource(sources, calculationAt), baseFacts: {
    registrationFlowTest: { confirmed: false, evidence: "Synthetic test fixture: registration failed" },
    followUp: {
      attended: { variantId: "synthetic-attended", messageContent: "identical synthetic text", destinationId: null },
      absent: { variantId: "synthetic-absent", messageContent: "identical synthetic text", destinationId: null },
      distinctContentConfirmation: null,
    },
  } });
  assert.ok(assembly.context);
  const rule = catalog.rules.find(r => r.ruleId === "WEB-FU-VAR-001")!;
  const at = Date.parse(calculationAt);
  const exception = {
    exceptionId: "synthetic-exception", standardId: STANDARD_ID, standardVersion: STANDARD_VERSION,
    ruleId: rule.ruleId, requirementOverridden: rule.expectedBehavior,
    businessJustification: "Explicit synthetic test of canonical exception resolution.",
    requestor: "Synthetic requestor", reviewer: "Synthetic reviewer", reviewerVerificationStatus: "unverified",
    decision: "approved", decisionAtEpochMs: at - 100, expiresAtEpochMs: at + 100, expirationRequired: true,
    createdAtEpochMs: at - 200, compensatingAction: "Synthetic alternative control", compensatingActionRequired: true,
    pilotAudit: { pilotReference: "synthetic-pilot", auditReference: "synthetic-audit" },
  };
  const run = (record: unknown, ruleId: string = rule.ruleId) => evaluateCanonicalAssembly({
    assembly, catalog, activityId: scope.activityId, occurrenceId: scope.sessionId,
    calculationAt, releaseFingerprint: "a".repeat(64), inputFingerprint: "b".repeat(64),
    exceptions: [record], exceptionClaims: [{ ruleId, exceptionId: exception.exceptionId }],
  }).snapshot;
  const resolved = run(exception);
  assert.equal(resolved.blockersResolvedByExceptions.some(r => r.ruleId === rule.ruleId), true);
  assert.equal(resolved.results.find(r => r.ruleId === rule.ruleId)!.status, "fail");
  assert.equal(resolved.blockersResolvedByExceptions.find(r => r.ruleId === rule.ruleId)!.originalFailure.status, "fail");
  assert.equal(resolved.unresolvedBlockingFailures.some(r => r.ruleId === rule.ruleId), false);
  assert.equal(resolved.operationalStatus, "simulation-only");
  for (const invalid of [
    { ...exception, decision: "rejected" }, { ...exception, expiresAtEpochMs: at - 1 },
    { ...exception, standardVersion: "wrong" }, { ...exception, reviewer: "" }, {},
  ]) {
    const result = run(invalid);
    assert.equal(result.blockersResolvedByExceptions.length, 0);
    assert.equal(result.unresolvedBlockingFailures.some(r => r.ruleId === rule.ruleId), true);
  }
  const qaRule = catalog.rules.find(r => r.ruleId === "WEB-QA-003")!;
  const nonOverridable = run({ ...exception, ruleId: qaRule.ruleId, requirementOverridden: qaRule.expectedBehavior }, qaRule.ruleId);
  assert.equal(nonOverridable.blockersResolvedByExceptions.length, 0);
  assert.equal(nonOverridable.unresolvedBlockingFailures.some(r => r.ruleId === qaRule.ruleId), true);
});

test("release provenance covers adapters, orchestration, strict snapshot and source capture implementation", async () => {
  const release = await captureWebinarRelease(Date.parse(calculationAt));
  const paths = Object.keys(release.provenance.evaluatorRegistry.implementationHashes);
  for (const file of ["webinar-evaluation-orchestration.ts", "webinar-evaluation-sources.ts", "webinar-simulation-snapshot.ts"]) {
    assert.ok(paths.some(path => path.endsWith(file)), file);
  }
  assert.ok(paths.some(path => path.includes("/webinar-domain-adapters/assembly.ts")));
  assert.equal(release.provenance.dependencies["@js-temporal/polyfill"], "0.5.1");
});

test("catalog, registry, invocation and result inventories fail closed on drift and implementation errors", async () => {
  const scope = await occurrence(), client = await pool.connect();
  const sources = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
  client.release();
  const catalog = await loadWebinarStandardCatalog(), registry = createWebinarEvaluatorRegistry(catalog);
  const assembly = assembleEvaluationInput(occurrenceAssemblySource(sources, calculationAt));
  assert.ok(assembly.context);
  const input = { assembly, catalog, registry, activityId: scope.activityId, occurrenceId: scope.sessionId,
    calculationAt, releaseFingerprint: "a".repeat(64), inputFingerprint: "b".repeat(64) };
  assert.throws(() => evaluateCanonicalAssembly({ ...input, catalog: { ...catalog, rules: catalog.rules.slice(1) } }), /inventory drift/);
  assert.throws(() => evaluateCanonicalAssembly({ ...input, registry: { ...registry, implementedRuleIds: registry.implementedRuleIds.slice(1) } }), /inventory drift/);
  assert.throws(() => evaluateCanonicalAssembly({ ...input, registry: { ...registry, entries: [...registry.entries.slice(1), registry.entries[1]!] } }), /inventory drift/);
  assert.throws(() => evaluateCanonicalAssembly({ ...input, registry: { ...registry, unimplementedRuleIds: [registry.implementedRuleIds[0]!] } }), /Missing canonical evaluator/);
  const brokenId = registry.implementedRuleIds[0]!;
  for (const broken of [
    { ...registry, evaluate: (id: typeof brokenId, context: EvaluationContext) => { if (id === brokenId) throw new Error("synthetic evaluator failure"); return registry.evaluate(id, context); } },
    { ...registry, evaluate: (id: typeof brokenId, context: EvaluationContext) => ({ ...registry.evaluate(id, context), ruleId: brokenId }) },
  ]) {
    assert.throws(() => evaluateCanonicalAssembly({ ...input, registry: broken }), (error: unknown) => {
      assert.ok(error instanceof EvaluationImplementationError);
      assert.equal(error.diagnostics.invokedRuleIds.length, 106);
      assert.ok(error.diagnostics.evaluatorErrors.length > 0);
      assert.ok(error.diagnostics.evaluatorErrors.every(e => e.code !== "required-input-unavailable"));
      assert.equal(Object.isFrozen(error.diagnostics), true);
      return true;
    });
  }
  const healthy = evaluateCanonicalAssembly(input);
  assert.equal(healthy.diagnostics.evaluatorErrors.length, 0, "implementation diagnostics do not leak to later requests");
});

test("explicit valid synthetic Foundation observations are consumed without inventing connector connectivity", async () => {
  const scope = await occurrence(), client = await pool.connect();
  const sources = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
  client.release();
  const fixture = JSON.parse(JSON.stringify(governedFixture("WEB-SETUP-003"))
    .replaceAll("event-1", scope.sessionId).replaceAll("occurrence-1", scope.sessionId).replaceAll("campaign-1", scope.campaignId)) as EvaluationContext;
  const at = new Date(governedFixtureTime).toISOString();
  const assembly = assembleEvaluationInput({ ...occurrenceAssemblySource(sources, at),
    subcontexts: { governed: fixture.governed, setup: fixture.setup } });
  assert.ok(assembly.context, JSON.stringify(assembly.mappingErrors));
  const snapshot = evaluateCanonicalAssembly({ assembly, catalog: await loadWebinarStandardCatalog(),
    activityId: scope.activityId, occurrenceId: scope.sessionId, calculationAt: at,
    releaseFingerprint: "a".repeat(64), inputFingerprint: "b".repeat(64) }).snapshot;
  assert.equal(snapshot.results.find(r => r.ruleId === "WEB-SETUP-003")!.status, "pass");
  assert.equal(snapshot.operationalStatus, "simulation-only");
  assert.ok(snapshot.unavailableExternalObservations.some(gap => gap.field.startsWith("governed.exclusion")));
  assert.equal(fixture.governed?.objective?.observations[0]?.sourceVersion, "fixture-version");
});

test("canvas-only edits preserve input identity, but domain edits change it", async () => {
  const scope = await occurrence(), client = await pool.connect();
  const sources = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
  client.release();
  const fingerprint = sourceInputFingerprint(sources, calculationAt);
  const moved = { ...sources, activity: { ...sources.activity, x: "200", y: "300", row_version: 100, updated_at: "2026-02-01T00:00:00Z" } };
  assert.equal(sourceInputFingerprint(moved, calculationAt), fingerprint);
  assert.notEqual(sourceInputFingerprint({ ...moved, activity: { ...moved.activity, owner: "Changed synthetic owner" } }, calculationAt), fingerprint);
});

test("relocated bundled orchestration loads the verified catalog and matches source execution", async () => {
  const scope = await occurrence(), input = exactCommand(scope);
  const artifact = dirname(dirname(fileURLToPath(import.meta.url)));
  const temporary = await mkdtemp(join(artifact, ".simulation-bundle-test-"));
  try {
    const output = join(temporary, "simulation.mjs");
    // A service-only bundle, not an app server. Relocation reproduces the real
    // esbuild import.meta.url boundary without touching dist or starting a workflow.
    await build({ entryPoints: [join(artifact, "src/lib/webinar-evaluation-orchestration.ts")],
      outfile: output, platform: "node", bundle: true, format: "esm", packages: "external", logLevel: "silent" });
    const bundled = await import(pathToFileURL(output).href) as typeof import("../src/lib/webinar-evaluation-orchestration");
    const result = await bundled.simulateWebinarOccurrence(input);
    assert.equal(result.results.length, 106);
    assert.equal(result.diagnostics.invokedRuleIds.length, 106);
    assert.equal(result.operationalStatus, "simulation-only");
    const source = await simulateWebinarOccurrence(input);
    assert.equal(source.snapshotId, result.snapshotId);
    assert.equal(source.releaseFingerprint, result.releaseFingerprint);
    assert.equal(source.inputFingerprint, result.inputFingerprint);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});