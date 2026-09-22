import assert from "node:assert/strict";
import express from "express";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  activityConnections,
  activities,
  campaignStrategy,
  campaigns,
  communications,
  db,
  scheduledInstanceHistory,
  scheduledInstances,
  scheduleRules,
} from "@workspace/db";
import campaignsRouter from "../src/routes/campaigns";
import planningRouter from "../src/routes/planning";
import { calculateScheduledAt, effectiveScheduledAt } from "../src/lib/planning";

const api = express();
api.use(express.json());
api.use(campaignsRouter);
api.use(planningRouter);

let server: ReturnType<typeof api.listen>;
let baseUrl: string;
let campaignId: string;
let activityIds: string[];

before(async () => {
  const [campaign] = await db.insert(campaigns).values({
    name: `Planning verification ${randomUUID()}`,
    scope: "Regional",
    region: "EMEA",
    audience: "Verification audience",
    outcome: "Verify planning",
  }).returning();
  campaignId = campaign.id;
  const rows = await db.insert(activities).values([
    {
      campaignId, name: "Entry", type: "Audience entry", audience: "Verification audience",
      region: "EMEA", timing: "TBD", status: "Confirmed", owner: "Test", x: "0", y: "0",
    },
    {
      campaignId, name: "Webinar", type: "Webinar", audience: "Verification audience",
      region: "EMEA", timing: "TBD", status: "Confirmed", owner: "Test", x: "200", y: "0",
    },
    {
      campaignId, name: "Outcome", type: "Desired outcome", audience: "Verification audience",
      region: "EMEA", timing: "TBD", status: "Estimated", owner: "Test", x: "400", y: "0",
    },
  ]).returning();
  activityIds = rows.map((row) => row.id);
  server = api.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Planning test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  const instances = await db.select({ id: scheduledInstances.id }).from(scheduledInstances)
    .where(eq(scheduledInstances.campaignId, campaignId));
  if (instances.length) {
    await db.delete(scheduledInstanceHistory).where(
      inArray(scheduledInstanceHistory.scheduledInstanceId, instances.map((row) => row.id)),
    );
  }
  await db.delete(scheduledInstances).where(eq(scheduledInstances.campaignId, campaignId));
  await db.delete(scheduleRules).where(eq(scheduleRules.campaignId, campaignId));
  await db.delete(activityConnections).where(eq(activityConnections.campaignId, campaignId));
  await db.delete(campaignStrategy).where(eq(campaignStrategy.campaignId, campaignId));
  await db.delete(activities).where(eq(activities.campaignId, campaignId));
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
});

test("campaign stale writers receive 409 and missing versions receive 428", async () => {
  const current = (await (await fetch(`${baseUrl}/campaigns/${campaignId}`)).json()) as { rowVersion: number };
  const updated = await fetch(`${baseUrl}/campaigns/${campaignId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rowVersion: current.rowVersion, lifecycle: "Planned" }),
  });
  assert.equal(updated.status, 200);
  const stale = await fetch(`${baseUrl}/campaigns/${campaignId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rowVersion: current.rowVersion, lifecycle: "Live" }),
  });
  assert.equal(stale.status, 409);
  const missing = await fetch(`${baseUrl}/campaigns/${campaignId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lifecycle: "Live" }),
  });
  assert.equal(missing.status, 428);
});

test("normalized duplicate names conflict", async () => {
  const first = await fetch(`${baseUrl}/campaigns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `Name collision ${randomUUID()}`, scope: "Global", audience: "Test", outcome: "Test" }),
  });
  assert.equal(first.status, 201);
  const created = await first.json() as { id: string; name: string };
  const duplicate = await fetch(`${baseUrl}/campaigns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: created.name.replaceAll(" ", "-"), scope: "Global", audience: "Test", outcome: "Test" }),
  });
  assert.equal(duplicate.status, 409);
  await db.delete(activityConnections).where(eq(activityConnections.campaignId, created.id));
  await db.delete(campaignStrategy).where(eq(campaignStrategy.campaignId, created.id));
  await db.delete(activities).where(eq(activities.campaignId, created.id));
  await db.delete(campaigns).where(eq(campaigns.id, created.id));
});

test("branch chaining preserves IDs and rejects cycles", async () => {
  const current = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  const nodes = await db.select().from(activities).where(eq(activities.campaignId, campaignId));
  const first = randomUUID();
  const second = randomUUID();
  const map = {
    rowVersion: current[0].rowVersion,
    activities: nodes.map((node) => ({
      id: node.id, name: node.name, type: node.type, audience: node.audience, region: node.region,
      timing: node.timing, status: node.status, owner: node.owner, conflict: node.conflict,
      decisionStatus: node.decisionStatus, rowVersion: node.rowVersion, position: { x: Number(node.x), y: Number(node.y) },
    })),
    connections: [
      { id: first, source: activityIds[0], target: activityIds[1], trigger: "Response", timing: "Immediate", exclusions: [], sentence: "first", entryCondition: { event: "click" }, suppressionRule: {} },
      { id: second, source: activityIds[1], target: activityIds[2], parentBranchId: first, trigger: "Open", timing: "Immediate", exclusions: [], sentence: "second", entryCondition: { event: "open" }, suppressionRule: { status: "unsubscribed" } },
    ],
  };
  const saved = await fetch(`${baseUrl}/campaigns/${campaignId}/map`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(map),
  });
  assert.equal(saved.status, 200);
  const savedMap = await saved.json() as {
    rowVersion: number;
    activities: typeof map.activities;
    connections: { id: string; parentBranchId: string | null }[];
  };
  assert.deepEqual(savedMap.connections.map((connection) => connection.id).sort(), [first, second].sort());
  const rootConnection = savedMap.connections.find((connection) => connection.id === first);
  const childConnection = savedMap.connections.find((connection) => connection.id === second);
  assert.ok(rootConnection);
  assert.ok(childConnection);
  assert.equal(rootConnection.parentBranchId, null);
  assert.equal(childConnection.parentBranchId, rootConnection.id);
  const cycle = await fetch(`${baseUrl}/campaigns/${campaignId}/map`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...map, rowVersion: savedMap.rowVersion, activities: savedMap.activities, connections: [
      { ...map.connections[0], parentBranchId: second },
      { ...map.connections[1], parentBranchId: first },
    ] }),
  });
  assert.equal(cycle.status, 400);
});

test("omitted map activities delete atomically and reject linked dependents", async () => {
  const [current] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  const mapActivities = async (omitted = new Set([activityIds[2]])) => (await db.select().from(activities).where(eq(activities.campaignId, campaignId)))
    .filter((node) => !omitted.has(node.id))
    .map((node) => ({
      id: node.id, name: node.name, type: node.type, audience: node.audience, region: node.region,
      timing: node.timing, status: node.status, owner: node.owner, conflict: node.conflict,
      decisionStatus: node.decisionStatus, rowVersion: node.rowVersion,
      position: { x: Number(node.x), y: Number(node.y) },
    }));
  const retainedPayload = await mapActivities();
  const deleted = await fetch(`${baseUrl}/campaigns/${campaignId}/map`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rowVersion: current.rowVersion, activities: retainedPayload, connections: [] }),
  });
  assert.equal(deleted.status, 200);
  const [removed] = await db.select().from(activities).where(eq(activities.id, activityIds[2]));
  assert.equal(removed, undefined);

  const [dependent] = await db.insert(activities).values({
    campaignId, name: "Dependent activity", type: "Email", audience: "Verification audience",
    region: "EMEA", timing: "TBD", status: "Estimated", owner: "Test", x: "600", y: "0",
  }).returning();
  const [communication] = await db.insert(communications).values({
    campaignId, activityId: dependent.id, name: "Dependent communication",
  }).returning();
  const [beforeReject] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  const reject = await fetch(`${baseUrl}/campaigns/${campaignId}/map`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rowVersion: beforeReject.rowVersion,
      activities: await mapActivities(new Set([activityIds[2], dependent.id])),
      connections: [],
    }),
  });
  assert.equal(reject.status, 409);
  assert.match((await reject.json()).error, /communications/);
  const [afterReject] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  assert.equal(afterReject.rowVersion, beforeReject.rowVersion);
  const [stillPresent] = await db.select().from(activities).where(eq(activities.id, dependent.id));
  assert.equal(stillPresent.id, dependent.id);

  await db.delete(communications).where(eq(communications.id, communication.id));
  const [beforeFinalDelete] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  const finalDelete = await fetch(`${baseUrl}/campaigns/${campaignId}/map`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rowVersion: beforeFinalDelete.rowVersion,
      activities: await mapActivities(new Set([activityIds[2], dependent.id])),
      connections: [],
    }),
  });
  assert.equal(finalDelete.status, 200);
  const [removedDependent] = await db.select().from(activities).where(eq(activities.id, dependent.id));
  assert.equal(removedDependent, undefined);
});

test("schedule recompute retains original calculated time and writes history", async () => {
  const rule = await fetch(`${baseUrl}/campaigns/${campaignId}/schedule-rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activityId: activityIds[1], anchorActivityId: activityIds[1], offsetDays: 1, offsetMinutes: 0,
      direction: "before", businessDayStrategy: "previous_business_day",
      audienceLocalTimezone: true, timezone: "America/New_York", targetSendTime: "09:00",
      anchorAt: "2026-11-02T15:00:00.000Z",
    }),
  });
  assert.equal(rule.status, 201);
  const created = await rule.json() as { rule: { id: string }; instance: { originalCalculatedAt: string; calculatedAt: string } };
  const recomputed = await fetch(`${baseUrl}/campaigns/${campaignId}/schedule-rules/recompute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId: created.rule.id, timezone: "America/New_York", anchorAt: "2026-11-05T15:00:00.000Z" }),
  });
  assert.equal(recomputed.status, 200);
  const [instance] = await db.select().from(scheduledInstances).where(eq(scheduledInstances.ruleId, created.rule.id));
  assert.equal(instance.originalCalculatedAt.toISOString(), created.instance.originalCalculatedAt);
  assert.notEqual(instance.calculatedAt.toISOString(), created.instance.calculatedAt);
  const history = await db.select().from(scheduledInstanceHistory).where(eq(scheduledInstanceHistory.scheduledInstanceId, instance.id));
  assert.equal(history.length, 1);

  const beforeAdjustment = instance;
  const adjustedTarget = new Date("2026-11-09T14:00:00.000Z");
  const adjustment = await fetch(`${baseUrl}/campaigns/${campaignId}/scheduled-instances/${instance.id}/adjust`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      calculatedAt: adjustedTarget.toISOString(),
      reason: "Customer requested a later send",
      rowVersion: beforeAdjustment.rowVersion,
    }),
  });
  assert.equal(adjustment.status, 200);
  const adjusted = await adjustment.json() as {
    calculatedAt: string;
    adjustedAt: string;
    adjustmentReason: string;
    rowVersion: number;
  };
  assert.equal(adjusted.calculatedAt, beforeAdjustment.calculatedAt.toISOString());
  assert.equal(adjusted.adjustedAt, adjustedTarget.toISOString());
  assert.equal(adjusted.adjustmentReason, "Customer requested a later send");
  assert.equal(adjusted.rowVersion, beforeAdjustment.rowVersion + 1);
  const [adjustedRow] = await db.select().from(scheduledInstances).where(eq(scheduledInstances.id, instance.id));
  assert.equal(effectiveScheduledAt(adjustedRow).toISOString(), adjustedTarget.toISOString());
  const adjustmentHistory = await db.select().from(scheduledInstanceHistory).where(
    eq(scheduledInstanceHistory.scheduledInstanceId, instance.id),
  );
  assert.equal(adjustmentHistory.length, 2);
  assert.equal(adjustmentHistory[1].previousCalculatedAt?.toISOString(), beforeAdjustment.calculatedAt.toISOString());
  assert.equal(adjustmentHistory[1].calculatedAt.toISOString(), adjustedTarget.toISOString());
  assert.match(adjustmentHistory[1].reason, /^manual adjustment:/);

  const staleAdjustment = await fetch(`${baseUrl}/campaigns/${campaignId}/scheduled-instances/${instance.id}/adjust`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      calculatedAt: "2026-11-10T14:00:00.000Z",
      reason: "Stale writer",
      rowVersion: beforeAdjustment.rowVersion,
    }),
  });
  assert.equal(staleAdjustment.status, 409);

  const recomputedAfterAdjustment = await fetch(`${baseUrl}/campaigns/${campaignId}/schedule-rules/recompute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ruleId: created.rule.id,
      timezone: "America/New_York",
      anchorAt: "2026-11-06T15:00:00.000Z",
      reason: "anchor moved after manual override",
    }),
  });
  assert.equal(recomputedAfterAdjustment.status, 200);
  const [cleared] = await db.select().from(scheduledInstances).where(eq(scheduledInstances.id, instance.id));
  assert.equal(cleared.adjustedAt, null);
  assert.equal(cleared.adjustmentReason, null);
  assert.notEqual(cleared.calculatedAt.toISOString(), adjustedTarget.toISOString());
  const fullHistory = await db.select().from(scheduledInstanceHistory).where(
    eq(scheduledInstanceHistory.scheduledInstanceId, instance.id),
  );
  assert.equal(fullHistory.length, 3);
  assert.equal(fullHistory[2].previousCalculatedAt?.toISOString(), adjustedTarget.toISOString());
  assert.match(fullHistory[2].reason, /manual adjustment cleared by recompute/);
});

test("anchor recompute does not match a rule's target activity when its explicit anchor differs", async () => {
  const explicitResponse = await fetch(`${baseUrl}/campaigns/${campaignId}/schedule-rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activityId: activityIds[1], anchorActivityId: activityIds[0], offsetDays: 1, offsetMinutes: 0,
      direction: "after", businessDayStrategy: "calendar", audienceLocalTimezone: false,
      timezone: "UTC", anchorAt: "2026-12-01T12:00:00.000Z",
    }),
  });
  assert.equal(explicitResponse.status, 201);
  const explicit = await explicitResponse.json() as { rule: { id: string } };
  const [explicitBefore] = await db.select().from(scheduledInstances).where(eq(scheduledInstances.ruleId, explicit.rule.id));

  const implicitResponse = await fetch(`${baseUrl}/campaigns/${campaignId}/schedule-rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activityId: activityIds[1], offsetDays: 1, offsetMinutes: 0,
      direction: "after", businessDayStrategy: "calendar", audienceLocalTimezone: false,
      timezone: "UTC", anchorAt: "2026-12-01T12:00:00.000Z",
    }),
  });
  assert.equal(implicitResponse.status, 201);
  const implicit = await implicitResponse.json() as { rule: { id: string } };

  const recompute = await fetch(`${baseUrl}/campaigns/${campaignId}/schedule-rules/recompute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activityId: activityIds[1],
      anchorAt: "2026-12-03T12:00:00.000Z",
      timezone: "UTC",
    }),
  });
  assert.equal(recompute.status, 200);

  const [explicitAfter] = await db.select().from(scheduledInstances).where(eq(scheduledInstances.ruleId, explicit.rule.id));
  assert.equal(explicitAfter.rowVersion, explicitBefore.rowVersion);
  assert.equal(explicitAfter.calculatedAt.toISOString(), explicitBefore.calculatedAt.toISOString());
  const implicitHistory = await db.select().from(scheduledInstanceHistory).where(
    eq(scheduledInstanceHistory.ruleId, implicit.rule.id),
  );
  assert.equal(implicitHistory.length, 1);
});

test("business-day strategies roll calendar offsets or count weekdays as documented", () => {
  const anchor = new Date("2026-07-03T12:00:00.000Z"); // Friday
  const base = {
    offsetDays: 2,
    offsetMinutes: 0,
    direction: "after" as const,
    audienceLocalTimezone: false,
    timezone: "UTC",
    targetSendTime: null,
  };
  const next = calculateScheduledAt(anchor, { ...base, businessDayStrategy: "next_business_day" });
  const previous = calculateScheduledAt(anchor, { ...base, businessDayStrategy: "previous_business_day" });
  const skipWeekends = calculateScheduledAt(anchor, { ...base, businessDayStrategy: "skip_weekends" });
  assert.equal(next.toISOString().slice(0, 10), "2026-07-06");
  assert.equal(previous.toISOString().slice(0, 10), "2026-07-03");
  assert.equal(skipWeekends.toISOString().slice(0, 10), "2026-07-07");
});