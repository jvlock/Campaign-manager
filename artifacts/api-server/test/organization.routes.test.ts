import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { createApp } from "../src/app";
import { createOrganizationService } from "../src/lib/organization/service";
import type { VerifiedPrincipal } from "../src/lib/organization/policy";

// Actual production composition + actual DB policy. Identity is injected by the
// server fixture, never taken from HTTP identity, roles, headers or query claims.
const ids = Object.fromEntries(
  ["admin", "alice", "bob", "leader", "team", "a", "b", "ma", "mb", "ml", "ca", "cb", "draft", "public"].map(key => [key, randomUUID()]),
);
const servers: Server[] = [];
const bases: Record<string, string> = {};
const principal = (userId: string): VerifiedPrincipal => ({ userId, issuer: "isolated-test-verifier", subject: userId });
async function serve(userId?: string) {
  const app = createApp(userId ? { authenticate: async () => {
    await new Promise(resolve => setTimeout(resolve, 2));
    return principal(userId);
  } } : {});
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
}
async function request(actor: string, path: string, method = "GET") {
  const response = await fetch(`${bases[actor]}${path}`, {
    method,
    headers: { "x-user-id": ids.admin, "x-role": "administrator" },
  });
  return { status: response.status, body: await response.json() as any };
}

before(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const key of ["admin", "alice", "bob", "leader"]) {
      await client.query("INSERT INTO users(id,name,email) VALUES ($1,$2,$3)", [ids[key], key, `${ids[key]}@organization.test`]);
    }
    await client.query("INSERT INTO organization_units(id,name,kind,accountable_owner_id) VALUES ($1,'HTTP parent','team',$2)", [ids.team, ids.admin]);
    for (const [group, owner] of [["a", "alice"], ["b", "bob"]]) {
      await client.query("INSERT INTO organization_units(id,name,kind,parent_id,accountable_owner_id) VALUES ($1,$2,'group',$3,$4)", [ids[group], `HTTP ${group}`, ids.team, ids[owner]]);
    }
    for (const [membership, actor, group] of [["ma", "alice", "a"], ["mb", "bob", "b"], ["ml", "leader", "team"]]) {
      await client.query("INSERT INTO organization_memberships(id,unit_id,user_id,verified_by) VALUES($1,$2,$3,$4)", [ids[membership], ids[group], ids[actor], ids.admin]);
    }
    for (const [membership, group] of [["ma", "a"], ["mb", "b"]]) {
      await client.query("INSERT INTO organization_grants(membership_id,unit_id,role,granted_by) VALUES($1,$2,'planner',$3)", [ids[membership], ids[group], ids.admin]);
    }
    await client.query("INSERT INTO organization_grants(membership_id,unit_id,action,granted_by) VALUES($1,$2,'calendar_view',$3)", [ids.ml, ids.a, ids.admin]);
    for (const [campaign, group, owner] of [["ca", "a", "alice"], ["cb", "b", "bob"]]) {
      await client.query("INSERT INTO campaigns(id,name,scope,audience,outcome) VALUES($1,$2,'Global','Synthetic','Synthetic')", [ids[campaign], `HTTP ${campaign} ${ids[campaign]}`]);
      await client.query("INSERT INTO campaign_ownership(campaign_id,group_id,accountable_owner_id,created_by) VALUES($1,$2,$3,$3)", [ids[campaign], ids[group], ids[owner]]);
      await client.query("INSERT INTO campaign_group_participation(campaign_id,group_id,created_by) VALUES($1,$2,$3)", [ids[campaign], ids[group], ids.admin]);
    }
    for (const [activity, visibility] of [["draft", "private"], ["public", "summary"]]) {
      await client.query("INSERT INTO activities(id,campaign_id,name,type,audience,region,timing,status,owner,x,y) VALUES($1,$2,$3,'Webinar','Synthetic','Global','TBD','Estimated','Synthetic',0,0)", [ids[activity], ids.ca, `HTTP ${activity}`]);
      await client.query("INSERT INTO activity_ownership(activity_id,campaign_id,group_id,accountable_owner_id,calendar_visibility,created_by) VALUES($1,$2,$3,$4,$5,$4)", [ids[activity], ids.ca, ids.a, ids.alice, visibility]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  for (const actor of ["alice", "bob", "leader"]) bases[actor] = await serve(ids[actor]);
  bases.unavailable = await serve();
});

after(async () => {
  await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  const client = await pool.connect();
  try {
  await client.query("BEGIN");
  const groups = [ids.a, ids.b, ids.team];
  await client.query("DELETE FROM organization_grants WHERE unit_id = ANY($1::uuid[])", [groups]);
  await client.query("DELETE FROM activity_ownership WHERE campaign_id = ANY($1::uuid[])", [[ids.ca, ids.cb]]);
  await client.query("DELETE FROM activities WHERE campaign_id = ANY($1::uuid[])", [[ids.ca, ids.cb]]);
  await client.query("DELETE FROM campaign_group_participation WHERE campaign_id = ANY($1::uuid[])", [[ids.ca, ids.cb]]);
  await client.query("DELETE FROM campaign_ownership WHERE campaign_id = ANY($1::uuid[])", [[ids.ca, ids.cb]]);
  await client.query("DELETE FROM campaigns WHERE id = ANY($1::uuid[])", [[ids.ca, ids.cb]]);
  await client.query("DELETE FROM organization_memberships WHERE unit_id = ANY($1::uuid[])", [groups]);
  await client.query("DELETE FROM organization_units WHERE id = ANY($1::uuid[])", [[ids.a, ids.b]]);
  await client.query("DELETE FROM organization_units WHERE id = $1", [ids.team]);
  await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[ids.admin, ids.alice, ids.bob, ids.leader]]);
  await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
});

test("default app fails closed despite forged identity, while health remains public", async () => {
  assert.equal((await request("unavailable", "/healthz")).status, 200);
  for (const path of ["/organization/campaigns", `/organization/campaigns/${ids.ca}`, "/campaigns", `/campaigns/${ids.ca}`, "/activity-model/catalog", "/organization/setup", `/campaigns/${ids.ca}/export/json`]) {
    const result = await request("unavailable", path);
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, "AUTHENTICATION_UNAVAILABLE");
  }
  assert.equal((await request("unavailable", "/campaigns", "POST")).status, 503);
});

test("collection filtering and direct requests deny cross-group access without totals", async () => {
  // Even an authorized record reader cannot fall through to legacy aggregations.
  assert.equal((await request("alice", "/campaigns")).status, 403);
  assert.equal((await request("alice", `/campaigns/${ids.ca}`)).status, 403);
  const list = await request("alice", "/organization/campaigns");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((row: any) => row.id), [ids.ca]);
  assert.equal((await request("alice", `/organization/campaigns/${ids.cb}`)).status, 404);
  assert.equal((await request("alice", `/organization/campaigns/${randomUUID()}`)).status, 404);
  const detail = await request("alice", `/organization/campaigns/${ids.ca}`);
  assert.equal(detail.status, 200);
  for (const key of ["map", "strategy", "utmLinks", "communications", "tasks", "inheritance", "budget", "evidence"]) {
    assert.equal(Object.hasOwn(detail.body, key), false, key);
  }
  assert.equal(detail.body.governance.verificationStatus, "provisional");
});

test("calendar leader sees only published summaries, never detail or operational HTTP routes", async () => {
  const rows = await createOrganizationService().calendarSummary(principal(ids.leader));
  const serialized = JSON.stringify(rows);
  assert.ok(serialized.includes(ids.public));
  assert.ok(!serialized.includes(ids.draft));
  assert.deepEqual((await request("leader", "/organization/campaigns")).body, []);
  assert.equal((await request("leader", `/organization/campaigns/${ids.ca}`)).status, 404);
  for (const [path, method] of [
    ["/campaigns", "GET"],
    [`/campaigns/${ids.ca}`, "GET"],
    [`/campaigns/${ids.ca}`, "PATCH"],
    [`/campaigns/${ids.ca}/map`, "GET"],
    [`/campaigns/${ids.ca}/export/json`, "GET"],
    [`/campaigns/${ids.ca}/exceptions`, "POST"],
    ["/organization/setup", "POST"],
  ]) assert.equal((await request("leader", path, method)).status, 403);
  const siblings = await createOrganizationService().calendarSummary(principal(ids.bob));
  assert.ok(!JSON.stringify(siblings).includes(ids.draft));
});

test("concurrent verified identities stay isolated and membership removal invalidates the same identity", async () => {
  await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const actor = index % 2 ? "alice" : "bob";
    const own = actor === "alice" ? ids.ca : ids.cb;
    const other = actor === "alice" ? ids.cb : ids.ca;
    assert.deepEqual((await request(actor, "/organization/campaigns")).body.map((row: any) => row.id), [own]);
    assert.equal((await request(actor, `/organization/campaigns/${other}`)).status, 404);
  }));
  await pool.query("UPDATE organization_grants SET status='revoked', revoked_at=now() WHERE membership_id=$1", [ids.ma]);
  assert.deepEqual((await request("alice", "/organization/campaigns")).body, []);
  assert.equal((await request("alice", `/organization/campaigns/${ids.ca}`)).status, 404);
  await pool.query("UPDATE organization_memberships SET status='revoked', revoked_at=now() WHERE id=$1", [ids.ml]);
  assert.deepEqual(await createOrganizationService().calendarSummary(principal(ids.leader)), []);
});