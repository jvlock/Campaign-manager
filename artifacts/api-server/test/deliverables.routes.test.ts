import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import app from "../src/app";
import {
  activities,
  activityTasks,
  assets,
  audiences,
  campaigns,
  communicationCtas,
  communicationDetails,
  communicationLandingPages,
  communications,
  ctas,
  db,
  landingPageContentAssets,
  landingPages,
} from "@workspace/db";

let server: Server;
let baseUrl: string;
let campaignId: string;
let foreignCampaignId: string;
let activityId: string;
const communicationIds: string[] = [];
const createdIds = { ctas: [] as string[], pages: [] as string[], assets: [] as string[] };

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  const [campaign, foreign] = await db.insert(campaigns).values([
    { name: `Deliverables test ${Date.now()}`, scope: "Regional", region: "EMEA", audience: "Test", outcome: "Test dependencies" },
    { name: `Deliverables foreign ${Date.now()}`, scope: "Global", region: "Global", audience: "Foreign", outcome: "Ownership" },
  ]).returning();
  campaignId = campaign.id;
  foreignCampaignId = foreign.id;
  const [activity] = await db.insert(activities).values({
    campaignId, name: "Event follow-up", type: "Email", audience: "Test", region: "EMEA",
    timing: "TBD", status: "Estimated", owner: "Campaign team", x: "0", y: "0",
  }).returning();
  activityId = activity.id;
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  server.close();
  if (communicationIds.length) {
    await db.delete(communicationCtas).where(inArray(communicationCtas.communicationId, communicationIds));
    await db.delete(communicationLandingPages).where(inArray(communicationLandingPages.communicationId, communicationIds));
    await db.delete(communicationDetails).where(inArray(communicationDetails.communicationId, communicationIds));
    await db.delete(communications).where(inArray(communications.id, communicationIds));
  }
  if (createdIds.pages.length) await db.delete(landingPageContentAssets).where(inArray(landingPageContentAssets.landingPageId, createdIds.pages));
  if (createdIds.ctas.length) await db.delete(ctas).where(inArray(ctas.id, createdIds.ctas));
  if (createdIds.pages.length) await db.delete(landingPages).where(inArray(landingPages.id, createdIds.pages));
  if (createdIds.assets.length) await db.delete(assets).where(inArray(assets.id, createdIds.assets));
  await db.delete(activityTasks).where(eq(activityTasks.campaignId, campaignId));
  await db.delete(audiences).where(eq(audiences.campaignId, campaignId));
  await db.delete(activities).where(eq(activities.campaignId, campaignId));
  await db.delete(campaigns).where(inArray(campaigns.id, [campaignId, foreignCampaignId]));
});

test("shared CTA and landing-page dependencies derive readiness and release safely", async () => {
  for (let index = 1; index <= 7; index += 1) {
    const created = await request(`/campaigns/${campaignId}/communications`, "POST", {
      activityId, name: `Follow-up email ${index}`, type: "Email", status: "Estimated",
    });
    assert.equal(created.status, 201);
    communicationIds.push(created.body.id);
  }

  const content = await request(`/campaigns/${campaignId}/content-assets`, "POST", {
    name: "Cookbook PDF", brief: "Final downloadable cookbook", owner: "Content owner",
    status: "Drafted", publishBy: "2027-02-01",
  });
  assert.equal(content.status, 201);
  createdIds.assets.push(content.body.id);

  const handraisePage = await request(`/campaigns/${campaignId}/landing-pages`, "POST", {
    name: "Yes, let's talk", headline: "Confirm your interest",
    supportingCopyNeeds: "Explain sales follow-up", personalizationRequirements: "Prefill recipient identity and campaign source for downstream tracking",
    owner: "Web owner", status: "Drafted", publishBy: "2027-02-02",
    publishedUrl: "https://example.com/talk", contentAssetIds: [],
  });
  assert.equal(handraisePage.status, 201);
  createdIds.pages.push(handraisePage.body.id);

  const cookbookPage = await request(`/campaigns/${campaignId}/landing-pages`, "POST", {
    name: "Cookbook download", headline: "Get the cookbook",
    supportingCopyNeeds: "Describe cookbook contents", personalizationRequirements: "Track known-recipient download intent",
    owner: "Web owner", status: "Published", publishBy: "2027-02-03",
    publishedUrl: "https://example.com/cookbook", contentAssetIds: [content.body.id],
  });
  assert.equal(cookbookPage.status, 201);
  createdIds.pages.push(cookbookPage.body.id);

  const handraiseCta = await request(`/campaigns/${campaignId}/ctas`, "POST", {
    name: "Talk to sales", buttonText: "Yes, let's talk", landingPageId: handraisePage.body.id,
    owner: "Email owner", status: "Published", publishBy: "2027-02-02",
  });
  const cookbookCta = await request(`/campaigns/${campaignId}/ctas`, "POST", {
    name: "Download cookbook", buttonText: "Get the cookbook", landingPageId: cookbookPage.body.id,
    owner: "Email owner", status: "Published", publishBy: "2027-02-03",
  });
  assert.equal(handraiseCta.status, 201);
  assert.equal(cookbookCta.status, 201);
  createdIds.ctas.push(handraiseCta.body.id, cookbookCta.body.id);

  for (const communicationId of communicationIds.slice(0, 4)) {
    const linked = await request(`/campaigns/${campaignId}/communications/${communicationId}/dependencies`, "PUT", {
      ctaIds: [handraiseCta.body.id], landingPageIds: [],
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.dependencyReadiness, "Blocked");
  }
  for (const communicationId of communicationIds.slice(4)) {
    const linked = await request(`/campaigns/${campaignId}/communications/${communicationId}/dependencies`, "PUT", {
      ctaIds: [cookbookCta.body.id, handraiseCta.body.id], landingPageIds: [],
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.dependencyReadiness, "Blocked");
  }

  const aggregate = await request(`/campaigns/${campaignId}/deliverables`);
  assert.equal(aggregate.status, 200);
  assert.equal(aggregate.body.ctas.find((row: any) => row.id === handraiseCta.body.id).communicationIds.length, 7);
  assert.equal(aggregate.body.landingPages.find((row: any) => row.id === cookbookPage.body.id).communicationIds.length, 3);
  assert.ok(aggregate.body.communications[6].blockers.some((row: any) => row.id === content.body.id));

  const blockedRelease = await request(`/campaigns/${campaignId}/communications/${communicationIds[0]}/release`, "POST");
  assert.equal(blockedRelease.status, 409);
  assert.equal(blockedRelease.body.error.code, "communication_blocked");

  assert.equal((await request(`/campaigns/${campaignId}/landing-pages/${handraisePage.body.id}`, "PATCH", { status: "Published" })).status, 200);
  assert.equal((await request(`/campaigns/${campaignId}/content-assets/${content.body.id}`, "PATCH", { status: "Published" })).status, 200);
  const ready = await request(`/campaigns/${campaignId}/deliverables`);
  assert.ok(ready.body.communications.every((row: any) => row.dependencyReadiness === "Ready"));

  const released = await request(`/campaigns/${campaignId}/communications/${communicationIds[6]}/release`, "POST");
  assert.equal(released.status, 200);
  assert.equal(released.body.releaseState, "Released");
  assert.equal(released.body.externalSending, false);

  const task = await request(`/campaigns/${campaignId}/tasks`, "POST", {
    activityId, name: "Final dependency review", type: "Approval", timing: "TBD",
    sortOrder: 0, status: "Confirmed", owner: "Owner", stage: "Complete",
  });
  assert.equal(task.status, 201);
  const attachedTask = await request(`/campaigns/${campaignId}/communications/${communicationIds[0]}`, "PATCH", {
    blockingDependencyTaskIds: [task.body.id],
  });
  assert.equal(attachedTask.status, 200);
  assert.equal((await request(`/campaigns/${campaignId}/communications/${communicationIds[0]}/release`, "POST")).status, 200);
  assert.equal((await request(`/campaigns/${campaignId}/tasks/${task.body.id}`, "PATCH", { stage: "In Progress" })).status, 200);
  const [regressedDetail] = await db.select().from(communicationDetails)
    .where(eq(communicationDetails.communicationId, communicationIds[0]));
  assert.equal(regressedDetail.releaseState, "Draft");
  const taskRegression = await request(`/campaigns/${campaignId}/deliverables`);
  assert.ok(taskRegression.body.communications
    .find((row: any) => row.communicationId === communicationIds[0]).blockers
    .some((row: any) => row.code === "task_not_complete" && row.id === task.body.id));

  assert.equal((await request(`/campaigns/${campaignId}/content-assets/${content.body.id}`, "PATCH", { status: "In Review" })).status, 200);
  const regressed = await request(`/campaigns/${campaignId}/deliverables`);
  const regressedCommunication = regressed.body.communications.find((row: any) => row.communicationId === communicationIds[6]);
  assert.equal(regressedCommunication.dependencyReadiness, "Blocked");
  assert.equal(regressedCommunication.releaseState, "Draft");

  const campaign = await request(`/campaigns/${campaignId}`);
  const live = await request(`/campaigns/${campaignId}`, "PATCH", { rowVersion: campaign.body.rowVersion, lifecycle: "Live" });
  assert.equal(live.status, 409);
  assert.equal(live.body.error.code, "communications_blocked");
});

test("validation and reference protections reject unsafe writes", async () => {
  const publishedWithoutUrl = await request(`/campaigns/${campaignId}/landing-pages`, "POST", {
    name: "No destination", headline: "", supportingCopyNeeds: "", personalizationRequirements: "",
    owner: "Owner", status: "Published", publishBy: null, publishedUrl: null, contentAssetIds: [],
  });
  assert.equal(publishedWithoutUrl.status, 400);

  const invalidStatus = await request(`/campaigns/${campaignId}/content-assets`, "POST", {
    name: "Bad", brief: "", owner: "Owner", status: "Done", publishBy: null,
  });
  assert.equal(invalidStatus.status, 400);
  const invalidDate = await request(`/campaigns/${campaignId}/content-assets`, "POST", {
    name: "Bad date", brief: "", owner: "Owner", status: "Not Started", publishBy: "2027-02-30",
  });
  assert.equal(invalidDate.status, 400);
  const invalidUrl = await request(`/campaigns/${campaignId}/ctas`, "POST", {
    name: "Bad URL", buttonText: "Click", destinationUrl: "javascript:alert(1)",
    owner: "Owner", status: "Not Started", publishBy: null,
  });
  assert.equal(invalidUrl.status, 400);

  const [foreignPage] = await db.insert(landingPages).values({
    campaignId: foreignCampaignId, name: "Foreign", headline: "", supportingCopyNeeds: "",
    personalizationRequirements: "", owner: "Owner", status: "Not Started",
  }).returning();
  const crossCampaign = await request(`/campaigns/${campaignId}/ctas`, "POST", {
    name: "Cross campaign", buttonText: "Click", landingPageId: foreignPage.id,
    owner: "Owner", status: "Not Started", publishBy: null,
  });
  assert.equal(crossCampaign.status, 400);
  assert.equal(crossCampaign.body.error.code, "cross_campaign_or_missing");
  await db.delete(landingPages).where(eq(landingPages.id, foreignPage.id));

  const referencedDelete = await request(`/campaigns/${campaignId}/ctas/${createdIds.ctas[0]}`, "DELETE");
  assert.equal(referencedDelete.status, 409);
  assert.equal(referencedDelete.body.error.code, "deliverable_referenced");

  const beforeQuickCreate = await request(`/campaigns/${campaignId}/deliverables`);
  const existingIds = beforeQuickCreate.body.communications
    .find((row: any) => row.communicationId === communicationIds[0]).ctaIds;
  const quickCta = await request(`/campaigns/${campaignId}/communications/${communicationIds[0]}/ctas`, "POST", {
    name: "Secondary action", buttonText: "View details", destinationUrl: "https://example.com/details",
    owner: "Owner", status: "Published", publishBy: null,
  });
  assert.equal(quickCta.status, 201);
  createdIds.ctas.push(quickCta.body.id);
  const afterQuickCreate = await request(`/campaigns/${campaignId}/deliverables`);
  const quickIds = afterQuickCreate.body.communications
    .find((row: any) => row.communicationId === communicationIds[0]).ctaIds;
  assert.ok(existingIds.every((id: string) => quickIds.includes(id)));
  assert.ok(quickIds.includes(quickCta.body.id));

  const ctaCount = afterQuickCreate.body.ctas.length;
  const failedQuickCta = await request(`/campaigns/${campaignId}/communications/${randomUUID()}/ctas`, "POST", {
    name: "Must roll back", buttonText: "No orphan", destinationUrl: "https://example.com/no-orphan",
    owner: "Owner", status: "Published", publishBy: null,
  });
  assert.equal(failedQuickCta.status, 404);
  assert.equal((await request(`/campaigns/${campaignId}/deliverables`)).body.ctas.length, ctaCount);

  const pageCount = afterQuickCreate.body.landingPages.length;
  const failedQuickPage = await request(`/campaigns/${campaignId}/communications/${communicationIds[0]}/landing-pages`, "POST", {
    name: "Must roll back page", headline: "", supportingCopyNeeds: "", personalizationRequirements: "",
    owner: "Owner", status: "Drafted", publishBy: null, publishedUrl: null,
    contentAssetIds: [randomUUID()],
  });
  assert.equal(failedQuickPage.status, 400);
  assert.equal((await request(`/campaigns/${campaignId}/deliverables`)).body.landingPages.length, pageCount);

  const [legacyPage] = await db.insert(landingPages).values({
    campaignId, name: "Legacy published page without URL", headline: "", supportingCopyNeeds: "",
    personalizationRequirements: "", owner: "Owner", status: "Published", url: null,
  }).returning();
  createdIds.pages.push(legacyPage.id);
  await db.insert(communicationLandingPages).values({
    campaignId, communicationId: communicationIds[0], landingPageId: legacyPage.id,
  });
  const legacyReadiness = await request(`/campaigns/${campaignId}/deliverables`);
  assert.ok(legacyReadiness.body.communications
    .find((row: any) => row.communicationId === communicationIds[0]).blockers
    .some((row: any) => row.code === "landing_page_destination_unavailable"));
  assert.equal(
    (await request(`/campaigns/${campaignId}/communications/${communicationIds[0]}/release`, "POST")).status,
    409,
  );
  await db.delete(communicationLandingPages).where(eq(communicationLandingPages.landingPageId, legacyPage.id));

  const missingTaskId = randomUUID();
  const [detail] = await db.select().from(communicationDetails)
    .where(eq(communicationDetails.communicationId, communicationIds[0]));
  await db.update(communicationDetails).set({ blockingDependencyTaskIds: [missingTaskId] })
    .where(eq(communicationDetails.communicationId, communicationIds[0]));
  const missingTaskReadiness = await request(`/campaigns/${campaignId}/deliverables`);
  assert.ok(missingTaskReadiness.body.communications
    .find((row: any) => row.communicationId === communicationIds[0]).blockers
    .some((row: any) => row.code === "task_reference_missing" && row.id === missingTaskId));
  await db.update(communicationDetails).set({ blockingDependencyTaskIds: detail.blockingDependencyTaskIds })
    .where(eq(communicationDetails.communicationId, communicationIds[0]));
});