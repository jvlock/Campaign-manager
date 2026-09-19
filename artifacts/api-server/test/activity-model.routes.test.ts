import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import { activities, activityConnections, campaigns, campaignStrategy, db, taxonomyTerms } from "@workspace/db";
import campaignsRouter from "../src/routes/campaigns";

let campaignId = "";
let base = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;
const extraCampaignIds: string[] = [];

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

before(async () => {
  const [campaign] = await db.insert(campaigns).values({
    name: `Canonical Campaign ${randomUUID().slice(0, 6)}`, scope: "Global",
    audience: "Test", outcome: "Test", owner: "Campaign Owner", region: "Global",
  }).returning();
  campaignId = campaign.id;
  await db.insert(campaignStrategy).values({
    campaignId,
    data: {},
    inheritance: { language: "en", deliveryStartDate: "2026-11-01", productValueIds: ["pv-1"] },
  });
  const app = express();
  app.use(express.json());
  app.use(campaignsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  for (const id of extraCampaignIds) {
    await db.delete(activityConnections).where(eq(activityConnections.campaignId, id));
    await db.delete(activities).where(eq(activities.campaignId, id));
    await db.delete(campaignStrategy).where(eq(campaignStrategy.campaignId, id));
    await db.delete(campaigns).where(eq(campaigns.id, id));
  }
  await db.delete(activities).where(eq(activities.campaignId, campaignId));
  await db.delete(campaignStrategy).where(eq(campaignStrategy.campaignId, campaignId));
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("catalog exposes the authoritative exact counts", async () => {
  const result = await request("/activity-model/catalog");
  assert.equal(result.status, 200);
  assert.equal(result.body.channels.length, 13);
  assert.equal(result.body.activityTypes.length, 12);
  assert.deepEqual(result.body.channels[0], { id: "psg", displayName: "Paid Search: Google", type: "paid" });
});

test("migration retires only exact lowercase-category generic channels without deleting history", async () => {
  const lowercaseLegacy = await db.select().from(taxonomyTerms).where(and(
    eq(taxonomyTerms.category, "channel"),
    inArray(taxonomyTerms.shortcode, ["EMAIL", "WEBINAR"]),
  ));
  assert.equal(lowercaseLegacy.length, 2);
  assert.ok(lowercaseLegacy.every((term) => term.isDeprecated && term.deprecatedAt));
  const [uppercaseHistorical] = await db.select().from(taxonomyTerms).where(and(
    eq(taxonomyTerms.category, "Channel"),
    eq(taxonomyTerms.shortcode, "EML"),
  ));
  assert.ok(uppercaseHistorical);
  assert.equal(uppercaseHistorical.isDeprecated, false);
});

test("creates MCP without a name, stores raw/generated separately, and map save never double-prefixes", async () => {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  const created = await request(`/campaigns/${campaignId}/activities`, "POST", {
    rowVersion: campaign.rowVersion, activityTypeId: "mcp",
    answers: { intentCategory: "evaluation" }, overrides: {},
    audience: "Test", region: "Global", timing: "TBD", status: "Estimated",
    owner: "Campaign Owner", position: { x: 20, y: 30 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, `${campaign.name}-mcp-evaluation`);
  assert.equal(created.body.generatedName, `${campaign.name}-mcp-evaluation`);
  assert.equal(created.body.namingInput, null);
  assert.equal(created.body.effectiveInheritance.owner, undefined);
  assert.equal(created.body.effectiveInheritance.language, "en");

  const detail = await request(`/campaigns/${campaignId}`);
  const node = detail.body.map.activities.find((item: any) => item.id === created.body.id);
  const saved = await request(`/campaigns/${campaignId}/map`, "PUT", {
    rowVersion: detail.body.rowVersion,
    activities: [{ ...node, answers: { intentCategory: "retention" } }],
    connections: [],
  });
  assert.equal(saved.status, 200);
  const updated = saved.body.activities.find((item: any) => item.id === created.body.id);
  assert.equal(updated.name, `${campaign.name}-mcp-retention`);
  assert.equal(updated.name.includes(`${campaign.name}-mcp-${campaign.name}`), false);
});

test("GET map roundtrip preserves explicit-null legacy rows while appending a canonical activity", async () => {
  const created = await request("/campaigns", "POST", {
    name: `Legacy roundtrip ${randomUUID().slice(0, 6)}`,
    scope: "Global", audience: "Roundtrip audience", outcome: "Roundtrip outcome",
  });
  assert.equal(created.status, 201);
  extraCampaignIds.push(created.body.id);

  const detail = await request(`/campaigns/${created.body.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.map.activities.length, 2);
  assert.ok(detail.body.map.activities.every((node: any) => node.activityTypeId === null));
  const legacyIds = detail.body.map.activities.map((node: any) => node.id);
  const newId = randomUUID();
  const saved = await request(`/campaigns/${created.body.id}/map`, "PUT", {
    rowVersion: detail.body.rowVersion,
    activities: [
      ...detail.body.map.activities,
      {
        id: newId, name: "Welcome", namingInput: "Welcome",
        type: "email", activityTypeId: "email",
        answers: { emailType: "activation" }, overrides: {},
        audience: "Roundtrip audience", region: "Global", timing: "TBD",
        status: "Estimated", owner: "Campaign team", conflict: false,
        decisionStatus: "Estimated", position: { x: 300, y: 200 },
      },
    ],
    connections: detail.body.map.connections,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.activities.length, 3);
  assert.ok(legacyIds.every((id: string) => saved.body.activities.some((node: any) => node.id === id && node.activityTypeId === null)));
  const canonical = saved.body.activities.find((node: any) => node.id === newId);
  assert.equal(canonical.name, `${created.body.name}-email-Welcome`);
  assert.equal(canonical.generatedName, `${created.body.name}-email-Welcome`);
});

test("MCP scans the whole raw request and naming errors are named", async () => {
  const detail = await request(`/campaigns/${campaignId}`);
  const blocked = await request(`/campaigns/${campaignId}/activities`, "POST", {
    rowVersion: detail.body.rowVersion, activityTypeId: "mcp",
    answers: { intentCategory: "awareness" }, nested: { promptText: "secret" },
    audience: "Test", region: "Global", timing: "TBD", status: "Estimated",
    owner: "Campaign Owner", position: { x: 0, y: 0 },
  });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.error.code, "mcp_prompt_data_prohibited");
  const badName = await request("/activity-model/render-name", "POST", {
    template: "{campaign}-{constructor}", builtins: { campaign: "Campaign" }, answers: {},
  });
  assert.equal(badName.status, 400);
  assert.deepEqual(badName.body.error, {
    field: "constructor", code: "unknown_placeholder",
    message: "Unknown naming placeholder: constructor",
  });
});

test("campaign inheritance is normalized, rename rerenders canonical names, and stale map versions advance", async () => {
  const before = await request(`/campaigns/${campaignId}`);
  const mcp = before.body.map.activities.find((item: any) => item.activityTypeId === "mcp");
  const renamed = await request(`/campaigns/${campaignId}`, "PATCH", {
    rowVersion: before.body.rowVersion,
    name: "Renamed Canonical Campaign",
    inheritance: {
      deliveryStartDate: "2027-01-02", productValueIds: ["pv-2"],
      region: "EMEA", language: "fr", primaryCta: "Register",
      landingDestination: "https://example.com",
    },
  });
  assert.equal(renamed.status, 200);
  const updated = renamed.body.map.activities.find((item: any) => item.id === mcp.id);
  assert.equal(updated.name, "Renamed Canonical Campaign-mcp-retention");
  assert.equal(updated.rowVersion, mcp.rowVersion + 1);
  assert.equal(updated.effectiveInheritance.language, "fr");
  assert.equal(updated.effectiveInheritance.primaryCta, undefined);
  assert.deepEqual(renamed.body.inheritance.productValueIds, ["pv-2"]);
  assert.equal(renamed.body.inheritance.primaryCta, "Register");
});

test("persisted MCP cannot bypass type validation or acquire prompt data through campaign inheritance", async () => {
  const detail = await request(`/campaigns/${campaignId}`);
  const mcp = detail.body.map.activities.find((item: any) => item.activityTypeId === "mcp");
  const emptyType = await request(`/campaigns/${campaignId}/map`, "PUT", {
    rowVersion: detail.body.rowVersion,
    activities: [{ ...mcp, activityTypeId: "" }],
    connections: [],
  });
  assert.equal(emptyType.status, 400);
  assert.equal(emptyType.body.error.code, "invalid_activity_type");
  const nullType = await request(`/campaigns/${campaignId}/map`, "PUT", {
    rowVersion: detail.body.rowVersion,
    activities: [{ ...mcp, activityTypeId: null }],
    connections: [],
  });
  assert.equal(nullType.status, 400);
  assert.equal(nullType.body.error.code, "invalid_activity_type");

  const promptInheritance = await request(`/campaigns/${campaignId}`, "PATCH", {
    rowVersion: detail.body.rowVersion,
    inheritance: { language: "contains prompt text" },
  });
  assert.equal(promptInheritance.status, 400);
  assert.equal(promptInheritance.body.error.code, "mcp_prompt_data_prohibited");

  await db.update(activities).set({ effectiveInheritance: { language: "raw prompt" } }).where(eq(activities.id, mcp.id));
  const live = await request(`/campaigns/${campaignId}`, "PATCH", {
    rowVersion: detail.body.rowVersion, lifecycle: "Live",
  });
  assert.equal(live.status, 400);
  assert.equal(live.body.error.code, "mcp_prompt_data_prohibited");
});

test("campaign inheritance rejects unknown keys and invalid typed values", async () => {
  const detail = await request(`/campaigns/${campaignId}`);
  const unknown = await request(`/campaigns/${campaignId}`, "PATCH", {
    rowVersion: detail.body.rowVersion, inheritance: { inventedDefault: "x" },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, "unknown_inheritance_field");
  const invalid = await request(`/campaigns/${campaignId}`, "PATCH", {
    rowVersion: detail.body.rowVersion, inheritance: { productValueIds: ["ok", 1] },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "invalid_type");
});