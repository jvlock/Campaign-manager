import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createOrganizationService } from "../src/lib/organization/service";
import { createApp } from "../src/app";
import { assertPlanningDatabaseIsolation, planningAccessMode, pool } from "@workspace/db";
after(async () => { await pool.end(); });

// Explicit isolated development suite, excluded from restricted regression glob.
test("actual app default remains restricted regardless of development environment", async () => {
  assert.throws(() => createApp({ mode: "invalid" as "restricted" }), /Invalid/);
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  try {
    const status = await (await fetch(`${base}/development/status?mode=open-development`)).json();
    assert.equal(status.mode, "restricted");
    assert.equal((await fetch(`${base}/campaigns`, { headers: { "x-role": "administrator", "x-development-session": "trusted" } })).status, 503);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("actual open app allows synthetic planning but not operational authority", async () => {
  assert.equal(planningAccessMode, "open-development", "Run this dedicated suite with explicit isolated open-development configuration");
  await assertPlanningDatabaseIsolation();
  const server = createApp({ mode: "open-development" }).listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  const send = (path: string, body: unknown, method = "POST") => fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await fetch(`${base}/development/status`)).status, 200);
    assert.equal((await fetch(`${base}/campaigns`)).status, 200);
    const groups = await (await fetch(`${base}/development/groups`)).json();
    const team = groups.groups.find((g: {kind: string}) => g.kind === "team");
    const groupResponse = await send("/development/groups", { name: `HTTP group ${randomUUID()}`, kind: "group", parentId: team.id });
    assert.equal(groupResponse.status, 201, await groupResponse.clone().text());
    const group = await groupResponse.json();
    const created = await send("/campaigns", { name: `Development HTTP ${randomUUID()}`, scope: "Global", audience: "Synthetic test audience", outcome: "Synthetic planning review" });
    assert.equal(created.status, 201, await created.clone().text());
    const campaign = await created.json();
    assert.equal((await fetch(`${base}/campaigns/${campaign.id}`)).status, 200);
    const ownership = await (await fetch(`${base}/development/ownership/campaigns/${campaign.id}`)).json();
    assert.equal(ownership.unverified, true);
    const changed = await send(`/development/ownership/campaigns/${campaign.id}`, { groupId: group.id, accountableOwnerId: ownership.ownership.accountableOwnerId }, "PUT");
    assert.equal(changed.status, 200, await changed.clone().text());
    assert.equal((await changed.json()).ownership.createdBy, ownership.ownership.createdBy);
    const activity = campaign.map.activities?.[0] ?? campaign.map.nodes?.[0];
    assert.ok(activity, "Created campaign has synthetic planning activities");
    const activityChanged = await send(`/development/ownership/activities/${activity.id}`, { groupId: group.id, accountableOwnerId: ownership.ownership.accountableOwnerId }, "PUT");
    assert.equal(activityChanged.status, 200, await activityChanged.clone().text());
    const calendar = await (await fetch(`${base}/development/calendar?groupId=${group.id}`)).json();
    assert.equal(calendar.entries.length, 1);
    assert.equal(calendar.entries[0].id, activity.id);
    assert.equal(calendar.entries[0].unverified, true);
    assert.ok(Array.isArray(calendar.entries[0].dates));
    assert.equal(new Set(calendar.entries.map((entry: {id: string}) => entry.id)).size, calendar.entries.length);
    await assert.rejects(createOrganizationService().authorize({
      userId: ownership.ownership.createdBy, issuer: "unverified-development", subject: "browser-label",
    }, "read", { type: "campaign", id: campaign.id }));
    for (const path of ["/governance/approvals", "/campaigns/any/communications/any/release", "/campaigns/any/export/json"]) {
      assert.equal((await fetch(`${base}${path}`, { method: "POST" })).status, 403);
    }
    assert.equal((await fetch(`${base}/development/groups`, { method: "POST", headers: { origin: "https://evil.invalid", "content-type": "application/json" }, body: "{}" })).status, 403);
    const simulation = await (await send("/development/simulations", {})).json();
    assert.equal(simulation.authoritative, false);
    assert.equal(simulation.operationalReadiness, false);
    // Trusted disposable-db test fixture deliberately models a manual import
    // bypassing insert triggers; the HTTP app must fail closed afterward.
    const importedId = randomUUID();
    const importer = await pool.connect();
    try {
      await importer.query("BEGIN");
      await importer.query("SET LOCAL session_replication_role=replica");
      await importer.query("INSERT INTO campaigns(id,name,scope,audience,outcome) VALUES($1,$2,'Global','Synthetic','Synthetic')", [importedId, `Unregistered synthetic test ${importedId}`]);
      await importer.query("COMMIT");
    } catch (error) { await importer.query("ROLLBACK"); throw error; }
    finally { importer.release(); }
    try {
      const unsafeStatus = await fetch(`${base}/development/status`);
      assert.equal(unsafeStatus.status, 503);
      assert.equal((await unsafeStatus.json()).planningAccess, false);
      assert.equal((await fetch(`${base}/campaigns`)).status, 503);
    } finally {
      await pool.query("DELETE FROM campaigns WHERE id=$1", [importedId]);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});