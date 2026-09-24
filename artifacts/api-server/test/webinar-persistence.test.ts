import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { pool } from "@workspace/db";
import { WebinarPersistence, PersistenceConflict, retentionExpiration, type PersistenceMutation } from "../src/lib/webinar-persistence";
import { captureWebinarRelease } from "../src/lib/webinar-release-provenance";
import { STANDARD_ID, STANDARD_VERSION } from "../src/lib/webinar-standard-catalog";

const repository = new WebinarPersistence();
let campaignId: string, sessionId: string, actorId: string, reviewerId: string;
let revision = 0;
const hash = "a".repeat(64);
const calculationAt = "2026-01-01T00:00:00.000Z";
const standard = { id: STANDARD_ID, version: STANDARD_VERSION };
const ids: Record<string, string> = {};
const payloads: Record<string, PersistenceMutation["payload"]> = {};
function command(payload: PersistenceMutation["payload"], extra: Partial<PersistenceMutation> = {}): PersistenceMutation {
  return { campaignId, sessionId, actorId, expectedRevision: revision, idempotencyKey: randomUUID(), standard,
    calculationAt, inputFingerprint: hash, operational: false, payload, ...extra };
}
async function append(payload: PersistenceMutation["payload"], extra: Partial<PersistenceMutation> = {}) {
  const row = await repository.append(command(payload, extra));
  revision = row.revision;
  ids[payload.kind] = row.id;
  payloads[payload.kind] = payload;
  return row;
}
before(async () => {
  // This suite must only be invoked under lib/db/test/disposable-db.mjs.
  const identity = await pool.query("SELECT current_setting('data_directory') AS directory, inet_server_addr() IS NULL AS socket");
  assert.match(identity.rows[0].directory, /^\/tmp\/disposable-pg-[^/]+\/data$/);
  assert.equal(identity.rows[0].socket, true);
  const insert = async (sql: string, params: unknown[] = []) => (await pool.query(sql + " RETURNING id", params)).rows[0].id;
  actorId = await insert("INSERT INTO users(name,email) VALUES ('Simulation actor',$1)", [`${randomUUID()}@example.invalid`]);
  reviewerId = await insert("INSERT INTO users(name,email) VALUES ('Simulation reviewer',$1)", [`${randomUUID()}@example.invalid`]);
  campaignId = await insert("INSERT INTO campaigns(name,scope,audience,outcome) VALUES ('Synthetic persistence','Global','Synthetic','Synthetic')");
  const activityId = await insert(`INSERT INTO activities(campaign_id,name,type,audience,region,timing,status,owner,x,y)
    VALUES ($1,'Synthetic webinar','Webinar','Synthetic','Global','TBD','Draft','Synthetic',0,0)`, [campaignId]);
  sessionId = await insert(`INSERT INTO webinar_sessions(campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform)
    VALUES ($1,$2,'Synthetic occurrence','2026-06-15','10:00',60,'UTC','Synthetic')`, [campaignId, activityId]);
});
after(async () => { await pool.end(); });

test("every typed record persists, reloads and remains explicitly nonoperational", async () => {
  await append({ kind: "plan", state: "draft", planFingerprint: hash });
  await append({ kind: "source", sourceSystem: "synthetic", sourceType: "content", sourceId: randomUUID(), sourceVersion: "v1", sourceHash: hash, observedAt: calculationAt, status: "available" });
  await append({ kind: "evidence", evidenceType: "qa", contentFingerprint: hash, result: "pass" }, { parentId: ids.source });
  await append({ kind: "exception-request", ruleId: "WEB-TEST-001", findingFingerprint: hash, reasonCode: "simulation" }, { parentId: ids.evidence });
  await assert.rejects(repository.append(command({ kind: "exception-disposition", disposition: "approved", reasonCode: "simulation" }, { parentId: ids["exception-request"] })), /Self-approval/);
  await append({ kind: "exception-disposition", disposition: "denied", reasonCode: "simulation" }, { parentId: ids["exception-request"], actorId: reviewerId });
  const release = await append({ kind: "release" });
  assert.deepEqual(release.payload, { kind: "release", ...await captureWebinarRelease(Date.parse(calculationAt)) });
  assert.equal(release.input_fingerprint, hash, "source-input identity remains separate from provenance");
  assert.notEqual(release.input_fingerprint, release.payload.digest, "server release digest is not caller source-input identity");
  const references = { evidenceIds: [ids.evidence], exceptionIds: [ids["exception-disposition"]] };
  await append({ kind: "readiness", stage: "setup", result: "not-ready", resultFingerprint: hash, ...references }, { releaseId: ids.release });
  await append({ kind: "completion", result: "incomplete", resultFingerprint: hash, ...references }, { releaseId: ids.release });
  await append({ kind: "legal-hold", held: true, reasonCode: "litigation" }, { parentId: ids.completion });
  const reloaded = await new WebinarPersistence().load(campaignId, sessionId);
  assert.equal(reloaded.records.length, 9);
  assert.deepEqual(new Set(reloaded.records.map(r => r.kind)), new Set(Object.keys(ids)));
  for (const row of reloaded.records) {
    assert.equal(row.operational, false);
    assert.equal(row.attribution, "unverified-development");
    assert.equal(row.standard_version, standard.version);
    assert.equal(row.payload.kind, row.kind);
    assert.deepEqual(row.payload, row.kind === "release" ? release.payload : payloads[row.kind]);
    const audit = await pool.query("SELECT * FROM webinar_persistence_audit WHERE record_id=$1", [row.id]);
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].actor_id, row.actor_id);
  }
  const page = await repository.load(campaignId, sessionId, 0, 3);
  assert.equal(page.returnedCount, 3); assert.equal(page.remainingCount, 9); assert.equal(page.nextRevision, 3);
  assert.equal(page.totalCount, 9);
  const exhausted = await repository.load(campaignId, sessionId, 999, 3);
  assert.equal(exhausted.totalCount, 9); assert.equal(exhausted.returnedCount, 0); assert.equal(exhausted.remainingCount, 0);
  assert.equal(exhausted.nextRevision, null);
  assert.equal((await repository.load(randomUUID(), sessionId)).totalCount, 0);
});

test("retry is stable; changed retries and concurrent edits conflict without duplicates", async () => {
  const input = command({ kind: "plan", state: "planned", planFingerprint: hash }, { inputFingerprint: "b".repeat(64) });
  const [a, b] = await Promise.all([repository.append(input), repository.append(input)]);
  assert.equal(a.id, b.id); revision = a.revision;
  await assert.rejects(repository.append({ ...input, payload: { ...input.payload, state: "superseded" } } as PersistenceMutation), PersistenceConflict);
  const edits = await Promise.allSettled([
    repository.append(command({ kind: "plan", state: "planned", planFingerprint: hash }, { inputFingerprint: "c".repeat(64) })),
    repository.append(command({ kind: "plan", state: "draft", planFingerprint: hash }, { inputFingerprint: "d".repeat(64) })),
  ]);
  assert.equal(edits.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(edits.filter(r => r.status === "rejected" && r.reason instanceof PersistenceConflict).length, 1);
  revision++;
  await assert.rejects(repository.append(command({ kind: "completion", result: "incomplete", resultFingerprint: hash, evidenceIds: [], exceptionIds: [] }, { releaseId: ids.release })), PersistenceConflict);
});

test("immutable records, immutable standard, scope and PII boundaries", async () => {
  for (const sql of ["UPDATE webinar_persistence_records SET payload='{}'", "DELETE FROM webinar_persistence_records", "TRUNCATE webinar_persistence_records CASCADE", "DELETE FROM webinar_persistence_audit", "UPDATE webinar_persistence_bindings SET standard_version='2'"]) {
    await assert.rejects(pool.query(sql));
  }
  await assert.rejects(repository.append(command({ kind: "plan", state: "draft", planFingerprint: hash }, { standard: { ...standard, version: "2.0.0" } })), PersistenceConflict);
  await assert.rejects(repository.append(command({ kind: "evidence", evidenceType: "qa", contentFingerprint: hash, result: "pass" }, { parentId: ids.plan })), /parent reference/);
  await assert.rejects(repository.append(command({ kind: "plan", state: "draft", planFingerprint: hash }, { campaignId: randomUUID() })), /campaign/);
  for (const unsafe of [{ email: "participant@example.invalid" }, { content: "copied body" }, { diagnostics: {} }, { participantName: "person" }]) {
    await assert.rejects(repository.append(command({ kind: "plan", state: "draft", planFingerprint: hash, ...unsafe } as PersistenceMutation["payload"])));
  }
  await assert.rejects(repository.append({ ...command({ kind: "plan", state: "draft", planFingerprint: hash }), operational: true } as unknown as PersistenceMutation));
  await assert.rejects(repository.append(command({ kind: "source", sourceSystem: "participant@example.invalid", sourceType: "content", sourceId: randomUUID(), sourceVersion: "v1", sourceHash: hash, observedAt: calculationAt, status: "available" })));
});

test("audit failure rolls back record and revision; deferred constraint rejects unaudited SQL", async () => {
  await pool.query(`CREATE FUNCTION test_reject_webinar_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$`);
  await pool.query("CREATE TRIGGER test_audit_failure BEFORE INSERT ON webinar_persistence_audit FOR EACH ROW EXECUTE FUNCTION test_reject_webinar_audit()");
  const input = command({ kind: "plan", state: "draft", planFingerprint: hash }, { inputFingerprint: "e".repeat(64) });
  try { await assert.rejects(repository.append(input), /injected audit failure/); }
  finally { await pool.query("DROP TRIGGER test_audit_failure ON webinar_persistence_audit"); }
  assert.equal((await pool.query("SELECT revision FROM webinar_persistence_bindings WHERE session_id=$1", [sessionId])).rows[0].revision, revision);
  assert.equal((await pool.query("SELECT count(*)::int n FROM webinar_persistence_records WHERE idempotency_key=$1", [input.idempotencyKey])).rows[0].n, 0);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO webinar_persistence_records(campaign_id,session_id,revision,kind,calculation_at,input_fingerprint,payload,actor_id,idempotency_key,request_hash,retention_class,expires_at)
      VALUES ($1,$2,$3,'plan',now(),$4,'{}',$5,$6,$4,'decision',now()+interval '7 years')`, [campaignId, sessionId, revision + 1, hash, actorId, randomUUID()]);
    await assert.rejects(client.query("COMMIT"), /requires corresponding actor audit/);
  } finally { await client.query("ROLLBACK"); client.release(); }
  const retry = await repository.append(input); revision = retry.revision;
});

test("retention baselines, configurable extension, legal hold and immutable release", async () => {
  assert.equal(retentionExpiration("decision", new Date("2024-02-29T00:00:00Z")).toISOString(), "2031-02-28T00:00:00.000Z");
  assert.equal(retentionExpiration("recomputable", new Date(calculationAt)).toISOString(), "2028-01-01T00:00:00.000Z");
  assert.equal(retentionExpiration("provenance", new Date(calculationAt), { decisionMonths: 84, provenanceMonths: 120, auditMonths: 84, recomputableMonths: 24 }).toISOString(), "2036-01-01T00:00:00.000Z");
  assert.throws(() => retentionExpiration("audit", new Date(), { decisionMonths: 84, provenanceMonths: 84, auditMonths: 1, recomputableMonths: 24 }));
  assert.deepEqual(await repository.retentionStatus(campaignId, sessionId, ids.completion, new Date("2100-01-01")), {
    legalHold: true, expired: true, effectiveExpired: false, deletionEnabled: false, deletionBlocked: true,
  });
  await append({ kind: "legal-hold", held: false, reasonCode: "released" }, { parentId: ids.completion, inputFingerprint: "f".repeat(64) });
  assert.equal((await repository.retentionStatus(campaignId, sessionId, ids.completion)).legalHold, false);
  assert.deepEqual(await repository.retentionStatus(campaignId, sessionId, ids.completion, new Date("2100-01-01")), {
    legalHold: false, expired: true, effectiveExpired: true, deletionEnabled: false, deletionBlocked: true,
  });
  assert.equal((await pool.query("SELECT count(*)::int n FROM webinar_persistence_records WHERE kind='legal-hold' AND parent_id=$1", [ids.completion])).rows[0].n, 2);
});

test("restricted and production-like processes cannot claim authoritative storage", async () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const environment of ["production", "development", undefined]) {
      if (environment) process.env.NODE_ENV = environment; else delete process.env.NODE_ENV;
      await assert.rejects(repository.append(command({ kind: "plan", state: "draft", planFingerprint: hash })), /authoritative storage actions are disabled/);
    }
  } finally { process.env.NODE_ENV = previous; }
});

test("unknown standard remains nullable and never inferred from legacy template", async () => {
  const { rows: [other] } = await pool.query(`INSERT INTO webinar_sessions
    (campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform)
    SELECT campaign_id,activity_id,'Unknown binding fixture',session_date,start_time,duration_minutes,timezone,platform
    FROM webinar_sessions WHERE id=$1 RETURNING id`, [sessionId]);
  const row = await repository.append(command({ kind: "plan", state: "draft", planFingerprint: hash }, { sessionId: other.id, expectedRevision: 0, standard: null }));
  assert.equal(row.standard_id, null); assert.equal(row.standard_version, null);
  await assert.rejects(repository.append(command({ kind: "completion", result: "unknown", resultFingerprint: hash, evidenceIds: [], exceptionIds: [] },
    { sessionId: other.id, expectedRevision: 1, standard: null, releaseId: ids.release })), /Exact standard binding is required/);
  const original = await pool.query("SELECT template_version FROM webinar_sessions WHERE id=$1", [other.id]);
  assert.equal(original.rows[0].template_version, "legacy_9");
});

test("trusted release capture is deterministic, versioned, nonoperational and rejects caller fabrications", async () => {
  const first = await captureWebinarRelease(Date.parse(calculationAt));
  const retry = await captureWebinarRelease(Date.parse(calculationAt));
  assert.deepEqual(first, retry);
  assert.notEqual(first.digest, (await captureWebinarRelease(Date.parse(calculationAt) + 1)).digest);
  assert.equal(first.provenance.operational, false);
  assert.equal(first.provenance.foundationVersion, null);
  assert.equal(first.provenance.taxonomyVersion, null);
  assert.equal(first.provenance.standardVersion, STANDARD_VERSION);
  assert.equal(first.provenance.evaluatorRegistry.coverage.implemented, 106);
  assert.equal(first.provenance.dependencies["@js-temporal/polyfill"], "0.5.1");
  assert.equal(Object.keys(first.provenance.canonicalDocuments).length, 5);
  assert.match(first.provenance.applicationRelease, /^[a-f0-9]{40}$/);
  assert.ok(Object.isFrozen(first.provenance.evaluatorRegistry.implementationHashes));
  for (const source of ["webinar-release-provenance.ts", "webinar-persistence.ts", "webinar-standard-catalog/loader.ts", "webinar-standard-evaluation/registry.ts"]) {
    assert.ok(first.provenance.evaluatorRegistry.implementationHashes[`artifacts/api-server/src/lib/${source}`]);
  }
  for (const forged of [{ digest: hash }, { provenance: first.provenance }, { fingerprint: hash }, { foundationVersion: "claimed-v1" }]) {
    await assert.rejects(repository.append(command({ kind: "release", ...forged } as PersistenceMutation["payload"])));
  }
});

test("direct SQL with matching audits cannot bypass typed graph, exact release or revision ordering", async () => {
  const client = await pool.connect();
  type Overrides = { id?: string; kind?: string; parentId?: string; releaseId?: string; revision?: number; standardVersion?: string; calculationAt?: string };
  const rawRecord = async (override: Overrides = {}) => {
    const id = override.id ?? randomUUID();
    await client.query(`INSERT INTO webinar_persistence_records
      (id,campaign_id,session_id,revision,kind,standard_id,standard_version,calculation_at,input_fingerprint,payload,parent_id,release_id,actor_id,idempotency_key,request_hash,retention_class,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}',$10,$11,$12,$13,$9,'decision',now()+interval '7 years')`,
    [id, campaignId, sessionId, override.revision ?? revision + 1, override.kind ?? "plan", standard.id,
      override.standardVersion ?? standard.version, override.calculationAt ?? calculationAt,
      "1".repeat(64), override.parentId ?? null, override.releaseId ?? null, reviewerId, randomUUID()]);
    await client.query(`INSERT INTO webinar_persistence_audit(record_id,campaign_id,session_id,actor_id,action,expires_at)
      VALUES ($1,$2,$3,$4,'simulation-recorded',now()+interval '7 years')`, [id, campaignId, sessionId, reviewerId]);
    return id;
  };
  const rejected = async (override: Overrides, message: RegExp) => {
    await client.query("BEGIN");
    try {
      await rawRecord(override);
      await client.query("UPDATE webinar_persistence_bindings SET revision=revision+1 WHERE session_id=$1", [sessionId]);
      await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"), message);
    } finally { await client.query("ROLLBACK"); }
  };
  try {
    // A valid control with a matching audit and revision succeeds before rollback.
    await client.query("BEGIN");
    await rawRecord();
    await client.query("UPDATE webinar_persistence_bindings SET revision=revision+1 WHERE session_id=$1", [sessionId]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("ROLLBACK");
    for (const [kind, parentId] of [
      ["evidence", ids.plan], ["exception-request", ids.source],
      ["exception-disposition", ids.source], ["legal-hold", ids["legal-hold"]], ["plan", ids.source],
    ]) {
      await rejected({ kind, parentId }, /Invalid webinar parent kind or revision ordering/);
    }
    await rejected({ kind: "readiness", releaseId: ids.source }, /Snapshot requires prior release/);
    await rejected({ kind: "completion", releaseId: ids.release, calculationAt: "2026-01-02T00:00:00.000Z" }, /Snapshot requires prior release/);
    await rejected({ kind: "completion", releaseId: ids.release, standardVersion: "2.0.0" }, /record standard must match/);
    await rejected({ revision: revision + 2 }, /binding revision must match contiguous/);
    await rejected({ kind: "plan", releaseId: ids.release }, /Snapshot requires prior release/);
    // Revision advancement without a matching record is also rejected.
    await client.query("BEGIN");
    await client.query("UPDATE webinar_persistence_bindings SET revision=revision+1 WHERE session_id=$1", [sessionId]);
    await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"), /binding revision must match contiguous/);
    await client.query("ROLLBACK");
    // Same-transaction forward references satisfy FK/typing but violate history order.
    await client.query("BEGIN");
    const futureSource = await rawRecord({ kind: "source", revision: revision + 2 });
    await rawRecord({ kind: "evidence", parentId: futureSource });
    await client.query("UPDATE webinar_persistence_bindings SET revision=revision+1 WHERE session_id=$1", [sessionId]);
    await client.query("UPDATE webinar_persistence_bindings SET revision=revision+1 WHERE session_id=$1", [sessionId]);
    await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"), /Invalid webinar parent kind or revision ordering/);
    await client.query("ROLLBACK");
  } finally { await client.query("ROLLBACK"); client.release(); }
});