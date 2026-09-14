import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import app from "../src/app";
import {
  activities,
  activityTasks,
  campaigns,
  communications,
  db,
} from "@workspace/db";
import { communicationDetails } from "@workspace/db/schema/communication-details";

let server: Server;
let baseUrl: string;
let campaignId: string;
let activityId: string;
let foreignActivityId: string;

before(async () => {
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: "Delivery verification campaign",
      scope: "Regional",
      region: "EMEA",
      audience: "Verification audience",
      outcome: "Verify delivery",
    })
    .returning();
  campaignId = campaign.id;

  const [activity] = await db
    .insert(activities)
    .values({
      campaignId,
      name: "Verification webinar",
      type: "Webinar",
      audience: "Verification audience",
      region: "EMEA",
      timing: "TBD",
      status: "Confirmed",
      owner: "Verification owner",
      x: "0",
      y: "0",
    })
    .returning();
  activityId = activity.id;

  const [foreignCampaign] = await db
    .insert(campaigns)
    .values({
      name: "Foreign delivery verification campaign",
      scope: "Global",
      region: "Global",
      audience: "Foreign audience",
      outcome: "Verify ownership",
    })
    .returning();
  const [foreignActivity] = await db
    .insert(activities)
    .values({
      campaignId: foreignCampaign.id,
      name: "Foreign activity",
      type: "Webinar",
      audience: "Foreign audience",
      region: "Global",
      timing: "TBD",
      status: "Confirmed",
      owner: "Verification owner",
      x: "0",
      y: "0",
    })
    .returning();
  foreignActivityId = foreignActivity.id;

  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Verification server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  server.close();
  await db.delete(communications).where(eq(communications.campaignId, campaignId));
  await db.delete(activityTasks).where(eq(activityTasks.campaignId, campaignId));
  await db.delete(activities).where(eq(activities.campaignId, campaignId));
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  const [foreign] = await db
    .select({ campaignId: activities.campaignId })
    .from(activities)
    .where(eq(activities.id, foreignActivityId));
  if (foreign) {
    await db.delete(activities).where(eq(activities.id, foreignActivityId));
    await db.delete(campaigns).where(eq(campaigns.id, foreign.campaignId));
  }
});

test("delivery validates input, persists children, and returns sort order", async () => {
  const invalid = await fetch(`${baseUrl}/campaigns/${campaignId}/communications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activityId,
      name: "Invalid status",
      status: "Open",
    }),
  });
  assert.equal(invalid.status, 400);

  const communicationResponse = await fetch(`${baseUrl}/campaigns/${campaignId}/communications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activityId,
      name: "Verification reminder",
      type: "Email",
      timing: "-2 days",
      sortOrder: 20,
      status: "Estimated",
      owner: "Verification owner",
    }),
  });
  assert.equal(communicationResponse.status, 201);
  const communication = await communicationResponse.json();
  assert.equal(communication.campaignId, campaignId);

  const taskResponse = await fetch(`${baseUrl}/campaigns/${campaignId}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activityId,
      name: "Verification tracking",
      type: "Tracking",
      timing: "-1 day",
      sortOrder: 10,
      status: "Confirmed",
      owner: "Verification owner",
    }),
  });
  assert.equal(taskResponse.status, 201);
  const task = await taskResponse.json();
  assert.equal(task.status, "Confirmed");

  const foreignActivityResponse = await fetch(`${baseUrl}/campaigns/${campaignId}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ activityId: foreignActivityId, name: "Rejected task" }),
  });
  assert.equal(foreignActivityResponse.status, 400);

  const patchResponse = await fetch(
    `${baseUrl}/campaigns/${campaignId}/communications/${communication.id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sortOrder: 5, status: "Known" }),
    },
  );
  assert.equal(patchResponse.status, 200);
  const patched = await patchResponse.json();
  assert.equal(patched.sortOrder, 5);
  assert.equal(patched.status, "Known");

  const [beforeInvalidPatch] = await db
    .select()
    .from(communications)
    .where(eq(communications.id, communication.id));
  const invalidEnrichment = await fetch(
    `${baseUrl}/campaigns/${campaignId}/communications/${communication.id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sortOrder: 999,
        blockingDependencyTaskIds: ["00000000-0000-4000-8000-000000000099"],
      }),
    },
  );
  assert.equal(invalidEnrichment.status, 400);
  const [afterInvalidPatch] = await db
    .select()
    .from(communications)
    .where(eq(communications.id, communication.id));
  assert.deepEqual(afterInvalidPatch, beforeInvalidPatch);
  const [detailAfterInvalidPatch] = await db
    .select()
    .from(communicationDetails)
    .where(eq(communicationDetails.communicationId, communication.id));
  assert.ok(detailAfterInvalidPatch);
  assert.equal(detailAfterInvalidPatch.blockingDependencyTaskIds.length, 0);

  const deliveryResponse = await fetch(`${baseUrl}/campaigns/${campaignId}/delivery`);
  assert.equal(deliveryResponse.status, 200);
  const delivery = await deliveryResponse.json();
  assert.deepEqual(delivery.communications.map((item: { sortOrder: number }) => item.sortOrder), [5]);
  assert.deepEqual(delivery.tasks.map((item: { sortOrder: number }) => item.sortOrder), [10]);
});