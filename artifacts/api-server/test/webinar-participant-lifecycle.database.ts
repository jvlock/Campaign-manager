import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { pool } from "@workspace/db";
import { initializeNewSyntheticOccurrence } from "../src/lib/webinar-evaluation-orchestration";
import { createSyntheticParticipant, transitionParticipantLifecycle, listParticipantSimulation,
  listSyntheticFixtures, seedSyntheticExecutedHistory, inspectParticipantSuppression,
  planSyntheticPopulation } from "../src/lib/webinar-participant-lifecycle";
import { loadOccurrenceSources } from "../src/lib/webinar-evaluation-sources";
import { PersistenceConflict } from "../src/lib/webinar-persistence";

let actorId: string;
before(async () => {
  const identity = await pool.query("SELECT current_setting('data_directory') AS directory, inet_server_addr() IS NULL AS socket");
  assert.match(identity.rows[0].directory, /^\/tmp\/disposable-pg-[^/]+\/data$/);
  assert.equal(identity.rows[0].socket, true);
  actorId = (await pool.query("INSERT INTO users(name,email) VALUES ('Synthetic lifecycle',$1) RETURNING id",
    [`${randomUUID()}@example.invalid`])).rows[0].id;
});
after(async () => { await pool.end(); });

async function occurrence() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const campaignId = (await client.query(`INSERT INTO campaigns(name,scope,audience,outcome)
      VALUES ('Synthetic lifecycle','Global','Synthetic','Synthetic') RETURNING id`)).rows[0].id as string;
    const activityId = (await client.query(`INSERT INTO activities(campaign_id,name,type,activity_type_id,audience,region,timing,status,owner,x,y)
      VALUES ($1,'Synthetic webinar','Webinar','webinar','Synthetic','Global','TBD','Draft','Synthetic',0,0) RETURNING id`,
      [campaignId])).rows[0].id as string;
    await client.query(`INSERT INTO development_record_registry(entity_type,entity_id)
      VALUES ('campaign',$1),('activity',$2)`, [campaignId, activityId]);
    const audienceBranchId = (await client.query(`INSERT INTO audiences(campaign_id,name,region)
      VALUES ($1,'Synthetic fixture branch','Global') RETURNING id`, [campaignId])).rows[0].id as string;
    const sessionId = (await client.query(`INSERT INTO webinar_sessions(campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform,template_version)
      VALUES ($1,$2,'Synthetic occurrence','2026-06-15','10:00',60,'UTC','Synthetic','default_5') RETURNING id`,
      [campaignId, activityId])).rows[0].id as string;
    await initializeNewSyntheticOccurrence(client, campaignId, sessionId, actorId, "scheduled");
    await client.query("COMMIT");
    return { campaignId, sessionId, audienceBranchId };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

test("synthetic registration commits source, projection, audit, obligations and 106-rule snapshot together", async () => {
  const scope = await occurrence();
  const fixture = await createSyntheticParticipant({ ...scope, actorId, expectedRevision: 1,
    idempotencyKey: randomUUID(), calculationAt: "2026-01-01T00:00:00.000Z", fixtureKey: "fixture-001",
    audienceClass: "customer" });
  const duplicateFixture = await createSyntheticParticipant({ ...scope, actorId, expectedRevision: 1,
    idempotencyKey: randomUUID(), calculationAt: "2026-01-01T00:00:00.000Z", fixtureKey: "fixture-001",
    audienceClass: "customer" });
  assert.equal(duplicateFixture.personId, fixture.personId);
  assert.equal(fixture.syntheticEmail, "fixture-001@participants.test");
  const input = { campaignId: scope.campaignId, sessionId: scope.sessionId, personId: fixture.personId,
    actorId, expectedRevision: 1, idempotencyKey: randomUUID(), sourceReference: randomUUID(),
    calculationAt: "2026-01-02T00:00:00.000Z", action: "register" as const };
  const result = await transitionParticipantLifecycle(input);
  assert.equal(result.snapshot.operationalStatus, "simulation-only");
  assert.equal(result.snapshot.results.length, 106);
  assert.ok(result.suppression.some(s => !s.allowed && /registration/.test(s.reasonCode)));
  assert.equal((await transitionParticipantLifecycle(input)).snapshot.snapshotId, result.snapshot.snapshotId);
  await assert.rejects(pool.query(`INSERT INTO webinar_lifecycle_events
    (campaign_id,session_id,actor_id,event_key,action,source_reference,observed_at,payload,request_fingerprint)
    VALUES($1,$2,$3,$4,'cancel-occurrence',$5,$6,'{}',$7)`,
    [scope.campaignId, scope.sessionId, actorId, randomUUID(), randomUUID(),
      "2026-01-02T00:00:00.000Z", "0".repeat(64)]), /snapshot/);
  await assert.rejects(createSyntheticParticipant({ ...scope, actorId, expectedRevision: result.snapshot.revision,
    idempotencyKey: randomUUID(), calculationAt: "2026-01-02T00:00:00.000Z",
    fixtureKey: "salesforce-contact-123", audienceClass: "customer" }));
  const counts = await pool.query(`SELECT
    (SELECT count(*)::int FROM webinar_lifecycle_events WHERE session_id=$1) events,
    (SELECT count(*)::int FROM webinar_lifecycle_snapshots s JOIN webinar_lifecycle_events e ON e.id=s.event_id WHERE e.session_id=$1) snapshots,
    (SELECT count(*)::int FROM webinar_registration_results WHERE session_id=$1 AND result='registered') registered`,
    [scope.sessionId]);
  assert.deepEqual(counts.rows[0], { events: 1, snapshots: 1, registered: 1 });
  assert.ok((await listParticipantSimulation({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    limit: 10, offset: 0 })).participants.length === 1);
  await assert.rejects(transitionParticipantLifecycle({ ...input, idempotencyKey: randomUUID(),
    sourceReference: randomUUID() }), PersistenceConflict);
});

test("waitlist promotion, cancellation, re-registration, reschedule and per-person attendance preserve source history", async () => {
  const scope = await occurrence();
  const fixture = await createSyntheticParticipant({ ...scope, actorId, expectedRevision: 1,
    idempotencyKey: randomUUID(), calculationAt: "2026-01-01T00:00:00.000Z", fixtureKey: "fixture-002",
    audienceClass: "customer" });
  let revision = 1;
  const go = async (action: "waitlist" | "promote" | "cancel-registration" | "register" | "reschedule" | "complete-occurrence" | "record-attendance" | "reconcile-attendance",
    calculationAt: string, extra: Record<string, string> = {}) => {
    const eventAction = ["reschedule", "complete-occurrence"].includes(action);
    const result = await transitionParticipantLifecycle({ campaignId: scope.campaignId, sessionId: scope.sessionId,
      ...(eventAction ? {} : { personId: fixture.personId }), actorId, expectedRevision: revision, idempotencyKey: randomUUID(),
      sourceReference: randomUUID(), calculationAt, action, ...extra });
    revision = result.snapshot.revision;
    return result;
  };
  const waitlisted = await go("waitlist", "2026-01-02T00:00:00.000Z");
  assert.equal(waitlisted.suppression[0]?.reasonCode, "waitlist_suppresses_recruitment");
  assert.equal((await pool.query(`SELECT result FROM webinar_registration_results
    WHERE session_id=$1 AND person_id=$2`, [scope.sessionId, fixture.personId])).rows[0].result, "not_registered");
  const promoted = await go("promote", "2026-01-03T00:00:00.000Z");
  assert.equal(promoted.suppression[0]?.reasonCode, "registration_suppresses_recruitment");
  await go("cancel-registration", "2026-01-04T00:00:00.000Z");
  await go("register", "2026-01-05T00:00:00.000Z");
  const moved = await go("reschedule", "2026-01-06T00:00:00.000Z",
    { sessionDate: "2026-06-16", startTime: "10:00", timezone: "UTC" });
  assert.equal(moved.snapshot.operationalStatus, "simulation-only");
  assert.ok((await pool.query(`SELECT 1 FROM webinar_lifecycle_obligations
    WHERE session_id=$1 AND source_event_id=$2 AND disposition='rescheduled' LIMIT 1`,
    [scope.sessionId, moved.eventId])).rowCount);
  await go("complete-occurrence", "2026-06-16T12:00:00.000Z", { actualEndAt: "2026-06-16T11:00:00.000Z" });
  const attended = await go("record-attendance", "2026-06-16T13:00:00.000Z", { attendance: "attended" });
  assert.ok(attended.after instanceof Array && attended.after.some(o => "kind" in o && o.kind === "attended_follow_up"));
  const conflict = await go("record-attendance", "2026-06-16T14:00:00.000Z", { attendance: "absent" });
  assert.ok(conflict.after instanceof Array && conflict.after.some(o => "kind" in o && o.kind === "attendance_reconciliation"));
  const corrected = await go("reconcile-attendance", "2026-06-16T15:00:00.000Z", { attendance: "absent" });
  assert.ok(corrected.after instanceof Array && corrected.after.some(o => "kind" in o && o.kind === "absent_follow_up"));
  const facts = await pool.query(`SELECT
    (SELECT count(*)::int FROM webinar_lifecycle_events WHERE session_id=$1) events,
    (SELECT count(*)::int FROM webinar_lifecycle_snapshots s JOIN webinar_lifecycle_events e ON e.id=s.event_id WHERE e.session_id=$1) snapshots,
    (SELECT first_registered_at FROM webinar_registration_results WHERE session_id=$1 AND person_id=$2) first_registration,
    (SELECT result FROM webinar_attendance_results WHERE session_id=$1 AND person_id=$2) attendance`,
    [scope.sessionId, fixture.personId]);
  assert.equal(facts.rows[0].events, 9);
  assert.equal(facts.rows[0].snapshots, 9);
  assert.equal(facts.rows[0].attendance, "no_show");
  assert.equal(new Date(facts.rows[0].first_registration).toISOString(), "2026-01-03T00:00:00.000Z");
});

test("occurrence cancellation evaluates every synthetic participant and preserves confirmed registrations", async () => {
  const scope = await occurrence();
  let revision = 1;
  for (const fixtureKey of ["fixture-101", "fixture-102"]) {
    const fixture = await createSyntheticParticipant({ ...scope, actorId, expectedRevision: revision,
      idempotencyKey: randomUUID(), calculationAt: "2026-01-01T00:00:00.000Z", fixtureKey,
      audienceClass: "customer" });
    const registered = await transitionParticipantLifecycle({ campaignId: scope.campaignId,
      sessionId: scope.sessionId, personId: fixture.personId, actorId, expectedRevision: revision,
      idempotencyKey: randomUUID(), sourceReference: randomUUID(), calculationAt: "2026-01-02T00:00:00.000Z",
      action: "register" });
    revision = registered.snapshot.revision;
  }
  const cancellation = await transitionParticipantLifecycle({ campaignId: scope.campaignId,
    sessionId: scope.sessionId, actorId, expectedRevision: revision, idempotencyKey: randomUUID(),
    sourceReference: randomUUID(), calculationAt: "2026-01-03T00:00:00.000Z", action: "cancel-occurrence" });
  assert.equal(cancellation.snapshotIds.length, 2);
  assert.equal(new Set(cancellation.snapshotIds).size, 2);
  const coverage = (await pool.query(`SELECT count(*)::int AS total,
    count(DISTINCT s.person_id)::int AS people,
    bool_and(jsonb_array_length(r.payload #> '{simulation,results}')=106) AS complete
    FROM webinar_lifecycle_snapshots s JOIN webinar_persistence_records r ON r.id=s.snapshot_id
    WHERE s.event_id=$1`, [cancellation.eventId])).rows[0];
  assert.deepEqual(coverage, { total: 2, people: 2, complete: true });
  assert.equal(cancellation.snapshot.revision, revision + 5);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM webinar_registration_results
    WHERE session_id=$1 AND result='registered'`, [scope.sessionId])).rows[0].n, 2);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM webinar_attendance_results
    WHERE session_id=$1`, [scope.sessionId])).rows[0].n, 0);
  await assert.rejects(transitionParticipantLifecycle({ campaignId: scope.campaignId,
    sessionId: scope.sessionId, actorId, expectedRevision: revision, idempotencyKey: randomUUID(),
    sourceReference: randomUUID(), calculationAt: "2026-01-04T00:00:00.000Z", action: "cancel-occurrence" }),
  PersistenceConflict);
});

test("fixture-seeded prior execution remains immutable after reschedule, recalculation and cancellation", async () => {
  const scope = await occurrence();
  const fixture = await createSyntheticParticipant({ ...scope, actorId, expectedRevision: 1,
    idempotencyKey: randomUUID(), calculationAt: "2026-01-01T00:00:00.000Z",
    fixtureKey: "fixture-301", audienceClass: "customer" });
  const registered = await transitionParticipantLifecycle({ ...scope, actorId, expectedRevision: 1,
    personId: fixture.personId, action: "register", idempotencyKey: randomUUID(),
    sourceReference: randomUUID(), calculationAt: "2026-01-02T00:00:00.000Z" });
  const command = { campaignId: scope.campaignId, sessionId: scope.sessionId, actorId,
    personId: fixture.personId, historyKind: "registration_confirmation" as const,
    historyExecutedAt: "2026-01-02T00:30:00.000Z", syntheticMessageReference: randomUUID(),
    expectedRevision: registered.snapshot.revision, idempotencyKey: randomUUID(),
    sourceReference: randomUUID(), calculationAt: "2026-01-03T00:00:00.000Z" };
  const seeded = await seedSyntheticExecutedHistory(command);
  assert.equal(seeded.snapshot.results.length, 106);
  assert.equal((await seedSyntheticExecutedHistory(command)).eventId, seeded.eventId);
  const { rows: [execution] } = await pool.query(`SELECT * FROM webinar_synthetic_executions
    WHERE source_event_id=$1`, [seeded.eventId]);
  assert.equal(execution.provenance, "synthetic-fixture-history");
  assert.equal(execution.synthetic_message_reference, command.syntheticMessageReference);
  assert.equal((await inspectParticipantSuppression({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    personId: fixture.personId, kind: "registration_confirmation",
    calculationAt: "2026-01-04T00:00:00.000Z" })).reasonCode, "previously_executed");
  await assert.rejects(pool.query("UPDATE webinar_synthetic_executions SET executed_at=now() WHERE id=$1", [execution.id]), /immutable/);
  await assert.rejects(pool.query("DELETE FROM webinar_synthetic_executions WHERE id=$1", [execution.id]), /immutable/);
  await assert.rejects(seedSyntheticExecutedHistory({ ...command, expectedRevision: seeded.snapshot.revision,
    idempotencyKey: randomUUID(), sourceReference: randomUUID() }), PersistenceConflict);
  const moved = await transitionParticipantLifecycle({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    actorId, action: "reschedule",
    expectedRevision: seeded.snapshot.revision, idempotencyKey: randomUUID(), sourceReference: randomUUID(),
    calculationAt: "2026-01-04T00:00:00.000Z",
    sessionDate: "2026-06-16", startTime: "10:00", timezone: "UTC" });
  await transitionParticipantLifecycle({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    actorId, action: "cancel-occurrence",
    expectedRevision: moved.snapshot.revision, idempotencyKey: randomUUID(), sourceReference: randomUUID(),
    calculationAt: "2026-01-05T00:00:00.000Z" });
  assert.equal((await pool.query("SELECT count(*)::int n FROM webinar_synthetic_executions WHERE id=$1",
    [execution.id])).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM webinar_lifecycle_obligations
    WHERE session_id=$1 AND person_id=$2 AND communication_id=$3 AND disposition='executed'`,
    [scope.sessionId, fixture.personId, execution.communication_id])).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM webinar_lifecycle_obligations
    WHERE session_id=$1 AND person_id=$2 AND communication_id=$3 AND disposition<>'executed'
      AND source_event_id IN (SELECT id FROM webinar_lifecycle_events
      WHERE session_id=$1 AND action IN ('reschedule','cancel-occurrence'))`,
    [scope.sessionId, fixture.personId, execution.communication_id])).rows[0].n, 0);
  await assert.rejects(pool.query(`INSERT INTO webinar_lifecycle_obligations
    (campaign_id,session_id,person_id,communication_id,kind,disposition,reason,source_event_id)
    VALUES($1,$2,$3,$4,'registration_confirmation','required','late forged mutation',$5)`,
    [scope.campaignId, scope.sessionId, fixture.personId, execution.communication_id, seeded.eventId]),
  /matching source event transaction/);
});

test("paged population and branch scoping never silently truncate or invent communication IDs", async () => {
  const scope = await occurrence();
  const alternate = (await pool.query("INSERT INTO audiences(campaign_id,name,region) VALUES($1,'Other synthetic branch','Global') RETURNING id",
    [scope.campaignId])).rows[0].id as string;
  let revision = 1;
  const people: string[] = [];
  for (const [fixtureKey, audienceBranchId] of [["fixture-401", scope.audienceBranchId], ["fixture-402", alternate],
    ["fixture-403", scope.audienceBranchId]] as const) {
    const fixture = await createSyntheticParticipant({ ...scope, audienceBranchId, actorId, expectedRevision: revision,
      idempotencyKey: randomUUID(), fixtureKey, audienceClass: "customer",
      calculationAt: "2026-01-01T00:00:00.000Z" });
    people.push(fixture.personId);
    const result = await transitionParticipantLifecycle({ campaignId: scope.campaignId, sessionId: scope.sessionId,
      actorId, personId: fixture.personId, action: "register", expectedRevision: revision,
      idempotencyKey: randomUUID(), sourceReference: randomUUID(),
      calculationAt: "2026-01-02T00:00:00.000Z" });
    revision = result.snapshot.revision;
  }
  const first = await listParticipantSimulation({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    limit: 1, offset: 0 });
  assert.equal(first.total, 3);
  assert.equal(first.returned, 1);
  assert.equal(first.nextOffset, 1);
  assert.ok(first.nextCursor);
  const next = await listParticipantSimulation({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    limit: 2, offset: 0, after: first.nextCursor! });
  assert.equal(next.returned, 2);
  assert.equal(new Set([...first.participants, ...next.participants].map(p => p.participantId)).size, 3);
  const branch = await listParticipantSimulation({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    limit: 1, offset: 0, audienceBranchId: alternate });
  assert.equal(branch.total, 1);
  assert.deepEqual(branch.participants.map(p => p.participantId), [people[1]]);
  assert.equal((await listSyntheticFixtures({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    limit: 10, offset: 0, audienceBranchId: alternate })).total, 1);
  const fixturePage = await listSyntheticFixtures({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    limit: 1, offset: 0 });
  assert.equal(fixturePage.total, 3);
  assert.equal(fixturePage.returned, 1);
  assert.ok(fixturePage.nextCursor);
  const fixtureRest = await listSyntheticFixtures({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    limit: 2, offset: 0, after: fixturePage.nextCursor! });
  assert.equal(fixtureRest.returned, 2);
  assert.equal(fixtureRest.nextCursor, null);
  await assert.rejects(transitionParticipantLifecycle({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    actorId, personId: people[1], audienceBranchId: scope.audienceBranchId, action: "cancel-registration",
    expectedRevision: revision, idempotencyKey: randomUUID(), sourceReference: randomUUID(),
    calculationAt: "2026-01-03T00:00:00.000Z" }), PersistenceConflict);
  const missing = await inspectParticipantSuppression({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    personId: people[0]!, kind: "neutral_follow_up", calculationAt: "2026-01-03T00:00:00.000Z" });
  assert.equal(missing.communicationId, null);
  assert.equal(missing.reasonCode, "communication_identity_unavailable");
});

test("mid-population snapshot failure rolls back all source, projection, obligation and revision writes", async () => {
  const scope = await occurrence();
  let revision = 1;
  for (const fixtureKey of ["fixture-501", "fixture-502"]) {
    const fixture = await createSyntheticParticipant({ ...scope, actorId, expectedRevision: revision,
      idempotencyKey: randomUUID(), calculationAt: "2026-01-01T00:00:00.000Z", fixtureKey,
      audienceClass: "customer" });
    revision = (await transitionParticipantLifecycle({ campaignId: scope.campaignId, sessionId: scope.sessionId,
      actorId, personId: fixture.personId, expectedRevision: revision,
      idempotencyKey: randomUUID(), sourceReference: randomUUID(),
      calculationAt: "2026-01-02T00:00:00.000Z", action: "register" })).snapshot.revision;
  }
  await pool.query(`CREATE FUNCTION synthetic_fail_second_population_snapshot() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF (SELECT e.action='cancel-occurrence' FROM webinar_lifecycle_events e WHERE e.id=NEW.event_id)
        AND (SELECT count(*) FROM webinar_lifecycle_snapshots WHERE event_id=NEW.event_id)=1
      THEN RAISE EXCEPTION 'forced second participant snapshot failure'; END IF;
      RETURN NEW;
    END $$`);
  await pool.query(`CREATE TRIGGER synthetic_fail_second_snapshot BEFORE INSERT ON webinar_lifecycle_snapshots
    FOR EACH ROW EXECUTE FUNCTION synthetic_fail_second_population_snapshot()`);
  const before = (await pool.query(`SELECT
    (SELECT revision FROM webinar_persistence_bindings WHERE session_id=$1) revision,
    (SELECT count(*)::int FROM webinar_lifecycle_events WHERE session_id=$1) events,
    (SELECT count(*)::int FROM webinar_lifecycle_obligations WHERE session_id=$1) obligations`,
    [scope.sessionId])).rows[0];
  try {
    await assert.rejects(transitionParticipantLifecycle({ campaignId: scope.campaignId, sessionId: scope.sessionId,
      actorId, expectedRevision: revision, idempotencyKey: randomUUID(), sourceReference: randomUUID(),
      calculationAt: "2026-01-03T00:00:00.000Z", action: "cancel-occurrence" }),
    /forced second participant snapshot failure/);
  } finally {
    await pool.query("DROP TRIGGER synthetic_fail_second_snapshot ON webinar_lifecycle_snapshots");
    await pool.query("DROP FUNCTION synthetic_fail_second_population_snapshot()");
  }
  const after = (await pool.query(`SELECT
    (SELECT revision FROM webinar_persistence_bindings WHERE session_id=$1) revision,
    (SELECT count(*)::int FROM webinar_lifecycle_events WHERE session_id=$1) events,
    (SELECT count(*)::int FROM webinar_lifecycle_obligations WHERE session_id=$1) obligations`,
    [scope.sessionId])).rows[0];
  assert.deepEqual(after, before);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM webinar_persistence_records
    WHERE session_id=$1 AND kind='plan' AND payload->>'eventStatus'='cancelled'`,
    [scope.sessionId])).rows[0].n, 0);
});

test("concurrent transitions serialize, repeated keys replay, and production markers are denied", async () => {
  const scope = await occurrence();
  const fixture = await createSyntheticParticipant({ ...scope, actorId, expectedRevision: 1,
    idempotencyKey: randomUUID(), calculationAt: "2026-01-01T00:00:00.000Z", fixtureKey: "fixture-601",
    audienceClass: "customer" });
  for (const fixtureKey of ["salesforce-123", "ON24-123", "crm-import-1", "person@real.example.com"]) {
    await assert.rejects(createSyntheticParticipant({ ...scope, actorId, expectedRevision: 1,
      idempotencyKey: randomUUID(), calculationAt: "2026-01-01T00:00:00.000Z", fixtureKey,
      audienceClass: "customer" }));
  }
  await assert.rejects(createSyntheticParticipant({ ...scope, actorId, expectedRevision: 1,
    idempotencyKey: randomUUID(), calculationAt: "2026-01-01T00:00:00.000Z", fixtureKey: "fixture-602",
    audienceClass: "customer", productionSource: "on24" } as never));
  const command = { campaignId: scope.campaignId, sessionId: scope.sessionId, actorId,
    personId: fixture.personId, expectedRevision: 1, action: "register" as const,
    idempotencyKey: randomUUID(), sourceReference: randomUUID(),
    calculationAt: "2026-01-02T00:00:00.000Z" };
  const attempts = await Promise.allSettled([transitionParticipantLifecycle(command),
    transitionParticipantLifecycle({ ...command, idempotencyKey: randomUUID(), sourceReference: randomUUID() })]);
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 1);
  assert.equal(attempts.filter(a => a.status === "rejected").length, 1);
  assert.equal((await transitionParticipantLifecycle(command)).replayed,
    attempts[0].status === "fulfilled");
  await assert.rejects(transitionParticipantLifecycle({ ...command, expectedRevision: 2 }),
    PersistenceConflict);
  await assert.rejects(transitionParticipantLifecycle({ ...command, idempotencyKey: randomUUID(),
    sourceReference: randomUUID(), personId: randomUUID(), expectedRevision: 3 }), PersistenceConflict);
});

test("unknown attendance never implicitly approves neutral follow-up and explicit reconciliation changes variant", async () => {
  const scope = await occurrence();
  const fixture = await createSyntheticParticipant({ ...scope, actorId, expectedRevision: 1,
    idempotencyKey: randomUUID(), calculationAt: "2026-01-01T00:00:00.000Z",
    fixtureKey: "fixture-701", audienceClass: "customer" });
  const register = await transitionParticipantLifecycle({ ...scope, actorId, personId: fixture.personId,
    expectedRevision: 1, action: "register", idempotencyKey: randomUUID(),
    sourceReference: randomUUID(), calculationAt: "2026-01-02T00:00:00.000Z" });
  const completed = await transitionParticipantLifecycle({ campaignId: scope.campaignId, sessionId: scope.sessionId,
    actorId, action: "complete-occurrence",
    expectedRevision: register.snapshot.revision, idempotencyKey: randomUUID(),
    sourceReference: randomUUID(), actualEndAt: "2026-06-15T11:00:00.000Z",
    calculationAt: "2026-06-15T12:00:00.000Z" });
  const client = await pool.connect();
  try {
    const sources = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
    const early = await planSyntheticPopulation(sources, "2026-06-15T13:00:00.000Z");
    const late = await planSyntheticPopulation(sources, "2026-06-19T13:00:00.000Z");
    assert.ok(early.participants[0]?.warnings.includes("neutral_variant_not_yet_eligible"));
    assert.ok(late.participants[0]?.warnings.includes("neutral_variant_requires_explicit_approval"));
    assert.ok(!late.participants[0]?.obligations.some(o => o.kind === "neutral_follow_up"));
  } finally { client.release(); }
  const observed = await transitionParticipantLifecycle({ ...scope, actorId, personId: fixture.personId,
    expectedRevision: completed.snapshot.revision, action: "record-attendance", attendance: "absent",
    idempotencyKey: randomUUID(), sourceReference: randomUUID(), calculationAt: "2026-06-19T14:00:00.000Z" });
  assert.ok(observed.after.some(o => "kind" in o && o.kind === "absent_follow_up"));
  assert.ok(!observed.after.some(o => "kind" in o && o.kind === "neutral_follow_up"));
});