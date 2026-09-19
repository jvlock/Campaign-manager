import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { activities, activityTasks, activityTaskSettings, campaigns, conflicts, db, ownerCapacities, webinarSessions } from "@workspace/db";
import deliveryRouter from "../src/routes/delivery";
import taskRouter from "../src/routes/implementation-tasks";
import { capacityTotals, stages, taskDueAt, validateTaskFields } from "../src/lib/implementation-tasks";
import {
  CreateActivityTaskBody, UpdateActivityTaskBody, UpdateTaskDefaultsBody, UpdateOwnerCapacitiesBody,
  type ActivityTaskInput, type ActivityTaskUpdate, type TaskDefaultsUpdate, type OwnerCapacitiesUpdate,
} from "@workspace/api-zod";

const owner = `Task verification ${randomUUID()}`;
const campaignIds: string[] = [];
const activityIds: string[] = [];
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let base: string;
const request = async (path: string, method = "GET", body?: unknown) => {
  const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};
before(async () => {
  for (let i = 0; i < 2; i++) {
    const [campaign] = await db.insert(campaigns).values({ name: `${owner} ${i}`, scope: "Global", region: "Global", audience: "Test", outcome: "Test" }).returning();
    campaignIds.push(campaign.id);
    const [activity] = await db.insert(activities).values({ campaignId: campaign.id, name: "Task parent", type: "Webinar", audience: "Test", region: "Global", timing: "TBD", status: "Estimated", owner, x: "0", y: "0" }).returning();
    activityIds.push(activity.id);
  }
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { warn() {} }; next(); });
  app.use(deliveryRouter); app.use(taskRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test listener missing");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server?.close();
  await db.delete(conflicts).where(eq(conflicts.owner, owner));
  await db.delete(ownerCapacities).where(eq(ownerCapacities.owner, owner));
  await db.delete(activityTasks).where(inArray(activityTasks.campaignId, campaignIds));
  await db.delete(webinarSessions).where(inArray(webinarSessions.campaignId, campaignIds));
  await db.delete(activityTaskSettings).where(inArray(activityTaskSettings.campaignId, campaignIds));
  await db.delete(activities).where(inArray(activities.campaignId, campaignIds));
  await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
});
test("stage and blockage are orthogonal, reasons valid and cleared", () => {
  for (const stage of stages) {
    assert.equal(validateTaskFields({ stage, blocked: true, blockedReason: "Legal" }).stage, stage);
    assert.equal(validateTaskFields({ stage, blocked: false }).blockedReason, null);
  }
  assert.throws(() => validateTaskFields({ blocked: true }), /required/);
  assert.throws(() => validateTaskFields({ blocked: true, blockedReason: "Something" }));
  assert.equal(validateTaskFields({ blocked: false }, { blocked: true, blockedReason: "Content" }).blockedReason, null);
  assert.throws(() => validateTaskFields({ dueAt: null }), /manual/);
});
test("signed offsets use shared business day engine", () => {
  const monday = new Date("2026-07-13T14:00:00Z");
  assert.equal(taskDueAt(monday, -1, "skip_weekends", "America/New_York").toISOString(), "2026-07-10T14:00:00.000Z");
  assert.equal(taskDueAt(monday, -1, "next_business_day", "UTC").toISOString(), monday.toISOString());
  assert.equal(taskDueAt(monday, 5, "skip_weekends", "UTC").toISOString(), "2026-07-20T14:00:00.000Z");
});
test("CRUD, scope, live anchors, global effort, configurable ceilings and managed conflicts", async () => {
  const path = `/campaigns/${campaignIds[0]}/tasks`;
  const settingsPath = `/campaigns/${campaignIds[0]}/activities/${activityIds[0]}/task-settings`;
  assert.equal((await request(path, "POST", { activityId: activityIds[1], name: "Wrong" })).status, 400);
  assert.equal((await request(path, "POST", { activityId: activityIds[0], name: "Manual", dueAt: "2026-07-01" })).status, 400);
  const first = await request(path, "POST", { activityId: activityIds[0], name: "Preserved content", owner, status: "Confirmed", effortPoints: 6, offsetDays: -1, businessDayStrategy: "skip_weekends" });
  assert.equal(first.status, 201); assert.equal(first.body.stage, "Not Started");
  assert.equal(first.body.dueAt, null); assert.match(first.body.schedulingIssue, /Missing/);
  assert.equal((await request(settingsPath, "PATCH", { gtmLaunchAt: "2026-07-13T14:00:00Z", timezone: "UTC", tier: "Gold" })).status, 200);
  let list = await request(`/campaigns/${campaignIds[0]}/delivery`);
  assert.equal(list.body.tasks[0].dueAt, "2026-07-10T14:00:00.000Z");
  await request(settingsPath, "PATCH", { gtmLaunchAt: "2026-07-14T14:00:00Z" });
  list = await request(`/campaigns/${campaignIds[0]}/delivery`);
  assert.equal(list.body.tasks[0].dueAt, "2026-07-13T14:00:00.000Z");
  assert.equal(list.body.taskCounts.stages["Not Started"], 1);
  const second = await request(`/campaigns/${campaignIds[1]}/tasks`, "POST", { activityId: activityIds[1], name: "Across campaign", owner, supportingOwner: owner, effortPoints: 5, blocked: true, blockedReason: "Content" });
  assert.equal(second.status, 201);
  let total = (await capacityTotals()).find(x => x.owner === owner)!;
  assert.equal(total.totalEffort, 11); assert.equal(total.overallocated, true);
  const capacity = await request("/owner-capacities", "PATCH", { capacities: [{ owner, ceiling: 12 }] });
  assert.equal(capacity.status, 200);
  let managed = await db.select().from(conflicts).where(eq(conflicts.owner, owner));
  assert.equal(managed.length, 1); assert.equal(managed[0].status, "Resolved");
  await request("/owner-capacities", "PATCH", { capacities: [{ owner, ceiling: 10 }] });
  await request(`${path}/${first.body.id}`, "PATCH", { stage: "Complete", blocked: true, blockedReason: "Legal" });
  total = (await capacityTotals()).find(x => x.owner === owner)!;
  assert.equal(total.totalEffort, 5);
  managed = await db.select().from(conflicts).where(eq(conflicts.owner, owner));
  assert.equal(managed.length, 1); assert.equal(managed[0].status, "Resolved");
  assert.equal((await request(`/campaigns/${campaignIds[1]}/tasks/${first.body.id}`, "PATCH", { notes: "Bad" })).status, 404);
  assert.equal((await request(`${path}/${first.body.id}`, "PATCH", { blockedReason: "Invalid" })).status, 400);
  await request(`${path}/${first.body.id}`, "PATCH", { blocked: false, trigger: "event", offsetDays: 0 });
  const [session] = await db.insert(webinarSessions).values({ campaignId: campaignIds[0], activityId: activityIds[0], name: "Event", sessionDate: "2026-08-03", startTime: "10:00", durationMinutes: 60, timezone: "America/New_York", platform: "Test" }).returning();
  list = await request(`/campaigns/${campaignIds[0]}/delivery`);
  assert.equal(list.body.tasks[0].dueAt, "2026-08-03T14:00:00.000Z");
  await db.update(webinarSessions).set({ sessionDate: "2026-08-04" }).where(eq(webinarSessions.id, session.id));
  list = await request(`/campaigns/${campaignIds[0]}/delivery`);
  assert.equal(list.body.tasks[0].dueAt, "2026-08-04T14:00:00.000Z");
  assert.equal(list.body.tasks[0].blockedReason, null);
  assert.equal((await request(`${path}/${first.body.id}`, "DELETE")).status, 204);
});
test("migration documents cautious one-time done migration without touching legacy content", async () => {
  const migration = await readFile(new URL("../../../lib/db/migrations/0012_implementation_tasks.sql", import.meta.url), "utf8");
  assert.match(migration, /IF NOT EXISTS.*column_name='stage'/);
  assert.match(migration, /IN \('done','complete','completed'\)/);
  assert.doesNotMatch(migration, /SET status|DELETE FROM activity_tasks/);
  // Rerunning it is safe and never translates a later legacy status into stage.
  await db.execute(sql.raw(migration));
});
test("reference defaults persist and validate signed integer offsets", async () => {
  const prior = await request("/task-defaults");
  const original = prior.body.find((item: { type: string }) => item.type === "Other").offsetDays;
  try {
    assert.equal((await request("/task-defaults", "PATCH", { defaults: [{ type: "Other", offsetDays: -4 }] })).status, 200);
    const current = await request("/task-defaults");
    assert.equal(current.body.find((item: { type: string }) => item.type === "Other").offsetDays, -4);
    assert.equal((await request("/task-defaults", "PATCH", { defaults: [{ type: "Other", offsetDays: 1.5 }] })).status, 400);
    assert.equal((await request("/owner-capacities", "PATCH", { capacities: [{ owner, ceiling: -1 }] })).status, 400);
    assert.equal((await request(`/campaigns/${campaignIds[0]}/activities/${activityIds[0]}/task-settings`, "PATCH", { timezone: "invalid/timezone" })).status, 400);
  } finally {
    await request("/task-defaults", "PATCH", { defaults: [{ type: "Other", offsetDays: original }] });
  }
});
test("write contracts exclude computed response fields and preserve editable legacy fields", () => {
  // These type assertions fail compilation if codegen puts response-only fields back into inputs.
  type Computed = "dueAt" | "schedulingIssue" | "effectiveOffsetDays";
  const createHasNoComputed: Extract<keyof ActivityTaskInput, Computed> extends never ? true : false = true;
  const updateHasNoComputed: Extract<keyof ActivityTaskUpdate, Computed> extends never ? true : false = true;
  const defaultHasNoLabel: Extract<keyof TaskDefaultsUpdate["defaults"][number], "label"> extends never ? true : false = true;
  const capacityHasNoDerived: Extract<keyof OwnerCapacitiesUpdate["capacities"][number], "label" | "totalEffort" | "overallocated"> extends never ? true : false = true;
  assert.ok(createHasNoComputed && updateHasNoComputed && defaultHasNoLabel && capacityHasNoDerived);
  const editable = { activityId: activityIds[0], name: "Legacy", type: "Asset", timing: "TBD", sortOrder: 2, status: "Known", owner, notes: "Keep" };
  const parsed = CreateActivityTaskBody.parse(editable);
  for (const key of Object.keys(editable)) assert.ok(key in parsed, `${key} preserved by generated input schema`);
  for (const parser of [CreateActivityTaskBody, UpdateActivityTaskBody]) {
    const result = parser.parse({ ...editable, dueAt: null, schedulingIssue: "fake", effectiveOffsetDays: 3 });
    for (const key of ["dueAt", "schedulingIssue", "effectiveOffsetDays"]) assert.ok(!(key in result));
  }
  assert.deepEqual(UpdateTaskDefaultsBody.parse({ defaults: [{ type: "Other", offsetDays: 1, label: "injected" }] }), { defaults: [{ type: "Other", offsetDays: 1 }] });
  assert.deepEqual(UpdateOwnerCapacitiesBody.parse({ capacities: [{ owner, ceiling: 10, label: "injected", totalEffort: 99, overallocated: false }] }), { capacities: [{ owner, ceiling: 10 }] });
});
test("HTTP rejects calculated field injection for create and patch; settings responses are exact", async () => {
  const path = `/campaigns/${campaignIds[0]}/tasks`;
  const input = { activityId: activityIds[0], name: "Injection verification", owner, timing: "TBD", status: "Known", type: "Asset", sortOrder: 2 };
  const created = await request(path, "POST", input);
  assert.equal(created.status, 201);
  try {
    for (const [field, value] of Object.entries({ dueAt: null, schedulingIssue: "fake", effectiveOffsetDays: -999, scheduledAt: null, manualDueAt: null })) {
      const post = await request(path, "POST", { ...input, [field]: value });
      const patch = await request(`${path}/${created.body.id}`, "PATCH", { [field]: value });
      for (const result of [post, patch]) {
        assert.equal(result.status, 400, field);
        assert.match(result.body.error, new RegExp(`${field}.*read-only`));
      }
    }
    assert.equal((await request(`${path}/${created.body.id}`, "PATCH", { typoField: true })).status, 400);
    const unblocked = await request(`${path}/${created.body.id}`, "PATCH", { blocked: false, blockedReason: "Legal" });
    assert.equal(unblocked.status, 200); assert.equal(unblocked.body.blockedReason, null);
    const settingsPath = `/campaigns/${campaignIds[0]}/activities/${activityIds[0]}/task-settings`;
    for (const result of [await request(settingsPath), await request(settingsPath, "PATCH", { tier: "Silver" })]) {
      assert.equal(result.status, 200);
      assert.deepEqual(Object.keys(result.body).sort(), ["eventAt", "gtmLaunchAt", "tier", "timezone"]);
    }
    assert.equal((await request("/task-defaults", "PATCH", { defaults: [{ type: "Other", offsetDays: 0, label: "fake" }] })).status, 400);
    for (const extra of [{ label: "fake" }, { totalEffort: 0 }, { overallocated: false }]) {
      assert.equal((await request("/owner-capacities", "PATCH", { capacities: [{ owner, ceiling: 10, ...extra }] })).status, 400);
    }
  } finally {
    await request(`${path}/${created.body.id}`, "DELETE");
  }
});