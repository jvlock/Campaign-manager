import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTIVITY_TYPE_CONFIGURATIONS,
  ActivityModelError,
  GOVERNED_CHANNELS,
  MCP_INTENTS,
  assertMcpSafe,
  normalizeCampaignInheritance,
  renderActivityName,
  validateActivityModel,
} from "../src/lib/activity-model";

const paidRequired = ["objective", "campaign", "audienceOrAdGroup", "creative", "placement", "platformId", "landingPage"];

test("catalog contains only the 13 channels and 13 production activity types", () => {
  assert.deepEqual(GOVERNED_CHANNELS.map(({ id, displayName, type }) => [id, displayName, type]), [
    ["psg", "Paid Search: Google", "paid"], ["psl", "Paid Social: LinkedIn", "paid"],
    ["disp", "Display", "paid"], ["orglin", "Organic Social: LinkedIn", "organic"],
    ["adv", "Advocacy Social", "organic"], ["eml", "Email: Pardot", "email"],
    ["emlc", "Email: Certain", "email"], ["emlp", "Email: Partner", "email"],
    ["evlv", "Event: In-Person", "event"], ["evind", "Event: Industry", "event"],
    ["evvrt", "Event: Virtual On24", "event"], ["app", "In-App", "app"], ["mcp", "MCP", "app"],
  ]);
  assert.equal(ACTIVITY_TYPE_CONFIGURATIONS.length, 13);
  assert.deepEqual(
    ACTIVITY_TYPE_CONFIGURATIONS.map(({ id, namingTemplate, requiredFields }) => [
      id, namingTemplate, requiredFields.map((field) => field.key),
    ]),
    [
      ["email", "{campaign}-{activityType}-{name}", ["emailType"]],
      ["paid-search", "{campaign}-paid-search-{name}", [...paidRequired]],
      ["paid-social", "{campaign}-paid-social-{name}", [...paidRequired]],
      ["display-content-partnerships", "{campaign}-display-{name}", ["campaign", "audienceOrAdGroup", "creative", "placement", "platformId", "objective", "landingPage"]],
      ["organic-social", "{campaign}-organic-{name}", ["socialFormat"]],
      ["employee-advocacy", "{campaign}-advocacy-{name}", ["advocacyProgram"]],
      ["events", "{campaign}-{eventType}-{name}", ["eventType"]],
      ["webinar", "{campaign}-webinar-{name}", []],
      ["sales-cadences", "{campaign}-{salesType}-{name}", ["salesType"]],
      ["in-app", "{campaign}-in-app-{name}", ["placement"]],
      ["mcp", "{campaign}-mcp-{intentCategory}", ["intentCategory"]],
      ["website", "{campaign}-web-{name}", ["pageType"]],
      ["partner-marketing", "{campaign}-partner-{name}", ["partner"]],
    ],
  );
  assert.equal(ACTIVITY_TYPE_CONFIGURATIONS.some((item) => /^(future-channel-|conditional-|activation-orchestrator-|task14-governed-)/.test(item.id)), false);
});

test("renderer substitutes exactly, lets answers override builtins, and accepts primitive false and zero", () => {
  assert.equal(
    renderActivityName("{campaign}-{activityType}-{name}-{zero}-{flag}", {
      campaign: "Campaign Name", activityType: "email", name: "Welcome", zero: 0, flag: false,
    }, { campaign: "Override Campaign" }),
    "Override Campaign-email-Welcome-0-false",
  );
  assert.throws(
    () => renderActivityName("{constructor}", {}, {}),
    (error: unknown) => error instanceof ActivityModelError && error.code === "unknown_placeholder",
  );
  assert.throws(
    () => renderActivityName("{missing}", {}, {}),
    (error: unknown) => error instanceof ActivityModelError && error.field === "missing" && error.code === "unknown_placeholder",
  );
  assert.throws(
    () => renderActivityName("{value}", { value: null }, {}),
    (error: unknown) => error instanceof ActivityModelError && error.code === "null_placeholder",
  );
  assert.throws(
    () => renderActivityName("{value}", { value: ["not", "primitive"] }, {}),
    (error: unknown) => error instanceof ActivityModelError && error.code === "object_placeholder",
  );
});

test("MCP needs no raw name, uses exact intents, and recursively rejects prompt data", () => {
  const model = validateActivityModel({
    activityTypeId: "mcp", name: undefined, answers: { intentCategory: "evaluation" },
    campaignName: "Campaign", inherited: { owner: "must not leak", region: "EMEA", language: "en" },
  });
  assert.equal(model.generatedName, "Campaign-mcp-evaluation");
  assert.equal("owner" in model.effectiveInheritance, false);
  assert.deepEqual(MCP_INTENTS, ["awareness", "consideration", "evaluation", "conversion", "retention"]);
  for (const bad of [
    { rawPrompt: "x" }, { nested: [{ safe: "contains prompt text here" }] }, { prompt_value: "x" },
  ]) {
    assert.throws(() => assertMcpSafe(bad), (error: unknown) =>
      error instanceof ActivityModelError && error.code === "mcp_prompt_data_prohibited");
  }
});

test("required fields, controlled options, override allowlists and override shapes are strict", () => {
  assert.throws(
    () => validateActivityModel({ activityTypeId: "email", name: "Welcome", answers: {}, campaignName: "Campaign", inherited: {} }),
    (error: unknown) => error instanceof ActivityModelError && error.field === "emailType",
  );
  assert.throws(
    () => validateActivityModel({ activityTypeId: "email", name: "Welcome", answers: { emailType: "invented" }, campaignName: "Campaign", inherited: {} }),
    (error: unknown) => error instanceof ActivityModelError && error.code === "invalid_option",
  );
  assert.throws(
    () => validateActivityModel({ activityTypeId: "organic-social", name: "Post", answers: { socialFormat: "post" }, overrides: { owner: "x" }, campaignName: "Campaign", inherited: {} }),
    (error: unknown) => error instanceof ActivityModelError && error.code === "override_not_allowed",
  );
  assert.throws(
    () => validateActivityModel({ activityTypeId: "website", name: "Page", answers: { pageType: "landing" }, overrides: { productValueIds: ["ok", 2] }, campaignName: "Campaign", inherited: {} }),
    (error: unknown) => error instanceof ActivityModelError && error.code === "invalid_type",
  );
});

test("campaign inheritance accepts only the eight typed governed keys", () => {
  const value = normalizeCampaignInheritance(
    { owner: "Existing", invented: "discarded" },
    {
      deliveryStartDate: "2027-02-28", deliveryEndDate: null,
      productValueIds: ["one", "two"], region: "EMEA", language: "fr",
      primaryCta: "Register", landingDestination: null,
    },
  );
  assert.deepEqual(value, {
    owner: "Existing", deliveryStartDate: "2027-02-28", deliveryEndDate: null,
    productValueIds: ["one", "two"], region: "EMEA", language: "fr",
    primaryCta: "Register", landingDestination: null,
  });
  assert.throws(
    () => normalizeCampaignInheritance({}, { deliveryStartDate: "2027-02-30" }),
    (error: unknown) => error instanceof ActivityModelError && error.code === "invalid_date",
  );
});