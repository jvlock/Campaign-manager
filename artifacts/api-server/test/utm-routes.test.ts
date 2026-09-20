import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  approvals, campaigns, db, taxonomyTerms, taxonomyVersions, utmLinks,
} from "@workspace/db";
import campaignsRouter from "../src/routes/campaigns";

const marker = randomUUID().slice(0, 8);
const termIds: string[] = [];
let campaignId = "";
let canonicalChannelId = "";
let canonicalChannelMetadata: Record<string, unknown> = {};
let productStableKey = "";
let campaignStableKey = "";
let subcampaignStableKey = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let base = "";

const post = async (body: unknown) => {
  const response = await fetch(`${base}/campaigns/${campaignId}/utm-links`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
};

before(async () => {
  const [version] = await db.select().from(taxonomyVersions).where(eq(taxonomyVersions.version, "2026.1"));
  assert.ok(version);
  const [campaign] = await db.insert(campaigns).values({
    name: `UTM route ${marker}`, scope: "Global", audience: "Test", outcome: "Test",
  }).returning();
  campaignId = campaign.id;

  const create = async (
    category: string,
    name: string,
    parentId?: string,
    sourceMetadata: Record<string, unknown> = {},
    stableKey?: string,
    shortcode = `${name}_${marker}`,
  ) => {
    const [term] = await db.insert(taxonomyTerms).values({
      versionId: version.id, category, label: `${name} ${marker}`,
      shortcode, stableKey, parentId, sourceMetadata,
    }).returning();
    termIds.push(term.id);
    await db.insert(approvals).values({
      recordType: "taxonomyTerm", recordId: term.id, stage: "Governance",
      status: "approved", approver: "test:declared",
    });
    return term;
  };
  productStableKey = `test:${marker}:product`;
  campaignStableKey = `test:${marker}:campaign`;
  subcampaignStableKey = `test:${marker}:subcampaign`;
  const product = await create("product_line", "Product", undefined, {}, productStableKey);
  const campaignCode = await create("campaign_shortcode", "Campaign", product.id, {}, campaignStableKey);
  await create("subcampaign", "Subcampaign", campaignCode.id, {}, subcampaignStableKey);
  const otherProduct = await create("product_line", "OtherProduct");
  await create("campaign_shortcode", "OtherCampaign", otherProduct.id, {}, undefined, `Campaign_${marker}`);
  await create("subcampaign", "WrongSubcampaign", product.id);
  await create("ads_subtype", "Ads");
  await create("utm_objective", "Objective");
  await create("audience", "Audience");
  await create("audience_segment", "Segment");
  await create("source", "Override");
  await create("display_partner", "Partner");
  const [canonicalChannel] = await db.select().from(taxonomyTerms).where(eq(taxonomyTerms.shortcode, "psg"));
  assert.ok(canonicalChannel);
  canonicalChannelId = canonicalChannel.id;
  canonicalChannelMetadata = canonicalChannel.sourceMetadata;
  await db.update(taxonomyTerms).set({
    sourceMetadata: { ...canonicalChannel.sourceMetadata, utmSource: "Google Ads", utmMedium: "Paid Search" },
  }).where(eq(taxonomyTerms.id, canonicalChannel.id));
  await db.insert(approvals).values({
    recordType: "taxonomyTerm", recordId: canonicalChannel.id, stage: "Governance",
    status: "approved", approver: "test:declared",
  });
  for (const [name, isDeprecated] of [["Unapproved", false], ["Inactive", true]] as const) {
    const [term] = await db.insert(taxonomyTerms).values({
      versionId: version.id, category: "channel", label: `${name} ${marker}`,
      shortcode: `${name}_${marker}`, isDeprecated,
      sourceMetadata: { formulaKey: "paid_search", utmSource: "Google", utmMedium: "CPC" },
    }).returning();
    termIds.push(term.id);
  }

  const app = express();
  app.use(express.json());
  app.use(campaignsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  await db.delete(utmLinks).where(eq(utmLinks.campaignId, campaignId));
  await db.delete(approvals).where(inArray(approvals.recordId, termIds));
  await db.delete(approvals).where(eq(approvals.recordId, canonicalChannelId));
  await db.update(taxonomyTerms).set({ sourceMetadata: canonicalChannelMetadata }).where(eq(taxonomyTerms.id, canonicalChannelId));
  await db.delete(taxonomyTerms).where(inArray(taxonomyTerms.id, termIds.reverse()));
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const governedRequest = () => ({
  channel: "psg",
  productLine: `Product_${marker}`,
  campaignShortcode: `Campaign_${marker}`,
  subcampaign: `Subcampaign_${marker}`,
  adsSubtype: `Ads_${marker}`,
  objective: `Objective_${marker}`,
  audience: `Audience_${marker}`,
  audienceSegment: `Segment_${marker}`,
  keyword: "{keyword}",
});

test("names an ungoverned channel and inserts nothing", async () => {
  const before = await db.select().from(utmLinks).where(eq(utmLinks.campaignId, campaignId));
  const result = await post({ channel: "Paid Search" });
  assert.equal(result.status, 422);
  assert.deepEqual(result.body.error, {
    field: "channel", code: "not_governed",
    message: "channel \"Paid Search\" is not a governed channel value",
  });
  const after = await db.select().from(utmLinks).where(eq(utmLinks.campaignId, campaignId));
  assert.equal(after.length, before.length);
});

test("allows unapproved active values for provisional preview but rejects inactive values", async () => {
  const unapproved = await post({ ...governedRequest(), channel: `Unapproved_${marker}` });
  assert.equal(unapproved.status, 200);
  assert.equal(unapproved.body.governance.governanceApproved, false);
  assert.equal(unapproved.body.governance.publishingEligible, false);
  assert.match(unapproved.body.governance.label, /PROVISIONAL/);
  const inactive = await post({ channel: `Inactive_${marker}` });
  assert.equal(inactive.status, 422);
  assert.equal(inactive.body.error.code, "inactive");
  assert.equal(inactive.body.error.field, "channel");
  assert.equal(inactive.body.error.message, `channel "Inactive_${marker}" is not an active channel value`);
});

test("returns parameters without destination and does not persist", async () => {
  const result = await post(governedRequest());
  assert.equal(result.status, 200);
  assert.equal(result.body.fullUrl, null);
  assert.equal(result.body.id, null);
  assert.match(result.body.message, /^Destination URL is required to build the full link\..*PROVISIONAL/);
  assert.equal(result.body.governance.governanceApproved, false);
  assert.equal(result.body.parameters.utm_source, "google-ads");
  assert.equal(result.body.parameters.utm_medium, "paid-search");
  assert.equal(result.body.parameters.utm_term, "{keyword}");
  assert.equal(JSON.stringify(result.body).includes("undefined"), false);
  assert.equal((await db.select().from(utmLinks).where(eq(utmLinks.campaignId, campaignId))).length, 0);
});

test("rejects direct final and approved aliases with the remediation message", async () => {
  for (const finality of [
    { final: true },
    { isFinal: "yes" },
    { approved: true },
    { approvalStatus: "approved" },
    { governanceApproved: true },
    { official: true },
    { publishExternally: true },
  ]) {
    const result = await post({ ...governedRequest(), ...finality });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "final_code_issuance_unavailable");
    assert.equal(
      result.body.error.message,
      "Final code issuance is not currently available pending remediation of the source governance system.",
    );
  }
});

test("provisional UTM CSV export carries labels and cannot imply external eligibility", async () => {
  const response = await fetch(`${base}/campaigns/${campaignId}/export/utm-csv`);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-governance-status"), "provisional-not-approved");
  assert.match(text, /Provisional label/);
  assert.match(text, /Governance approved,External publishing eligible/);
  for (const query of ["final=true", "approval_status=approved", "mode=official"]) {
    const rejected = await fetch(`${base}/campaigns/${campaignId}/export/utm-csv?${query}`);
    assert.equal(rejected.status, 409);
    assert.match(await rejected.text(), /Final code issuance is not currently available/);
  }
});

test("resolves stable keys and parent-scopes repeated campaign shortcodes", async () => {
  const stable = await post({
    ...governedRequest(),
    productLine: productStableKey,
    campaignShortcode: campaignStableKey,
    subcampaign: subcampaignStableKey,
  });
  assert.equal(stable.status, 200);

  const repeatedBareCode = await post(governedRequest());
  assert.equal(repeatedBareCode.status, 200);
});

test("persists a full link, uses approved source override, and passes Salesforce ID", async () => {
  const result = await post({
    ...governedRequest(), source: `Override_${marker}`, displayPartner: `Partner_${marker}`,
    destinationUrl: "https://example.com/path?existing=yes#section",
    salesforceCampaignId: "701ABCdef123456XYZ",
  });
  assert.equal(result.status, 201);
  const url = new URL(result.body.fullUrl);
  assert.equal(url.searchParams.get("existing"), "yes");
  assert.equal(url.searchParams.get("utm_source"), `partner_${marker}`);
  assert.equal(url.searchParams.get("utm_sf_cmp_id"), "701ABCdef123456XYZ");
  assert.equal(url.hash, "#section");
});

test("returns named validation errors for missing fields, malformed URL, and Salesforce ID", async () => {
  const missing = await post({ ...governedRequest(), audience: undefined });
  assert.equal(missing.status, 422);
  assert.equal(missing.body.error.field, "audience");
  const badUrl = await post({ ...governedRequest(), destinationUrl: "not-url" });
  assert.equal(badUrl.status, 400);
  assert.equal(badUrl.body.error.field, "destinationUrl");
  const badSalesforce = await post({ ...governedRequest(), salesforceCampaignId: "generated-code" });
  assert.equal(badSalesforce.status, 400);
  assert.equal(badSalesforce.body.error.field, "salesforceCampaignId");
  const hierarchy = await post({ ...governedRequest(), subcampaign: `WrongSubcampaign_${marker}` });
  assert.equal(hierarchy.status, 422);
  assert.deepEqual(hierarchy.body.error, {
    field: "subcampaign", code: "invalid_hierarchy",
    message: "subcampaign must be a child of campaignShortcode",
  });
});