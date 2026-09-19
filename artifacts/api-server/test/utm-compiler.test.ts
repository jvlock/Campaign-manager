import assert from "node:assert/strict";
import { test } from "node:test";
import { appendUtm, compileUtm, J, normalizeGoverned, UtmInputError, type CompiledUtmInput } from "../src/lib/utm-compiler";

const common = {
  product_line: "index",
  subcampaign: "climate",
  campaign_shortcode: "launch",
  ads_subtype: "search-ad",
  utm_objective: "awareness",
  audience: "investors",
  audience_segment: "asset-managers",
  utm_region: "emea",
  creative_type: "banner",
  image_size: "300x250",
  content_type: "article",
  creative_cta: "learn-more",
  owner: "digital",
  newsletter_version: "v2",
  link_position: "hero",
  email_type: "pre-event",
  capture_source: "qr",
} as const;

const input = (formula: CompiledUtmInput["formula"], values = common): CompiledUtmInput => ({
  formula, values, channelSource: "google", channelMedium: "cpc",
  keyword: "{keyword}", sendDate: "2026-10-20", automationName: "Lead Flow",
  eventName: "Climate Forum", eventDate: "2026-11-04",
  creativeDescription: "Booth QR Code", eventCta: "Register Now",
});

test("J omits falsey entries and governed normalization never emits undefined", () => {
  assert.equal(J("one", undefined, "", false, "two"), "one_two");
  assert.equal(normalizeGoverned("Asset Managers"), "asset-managers");
  assert.equal(J("one", undefined), "one");
});

test("compiles every supported formula literally", () => {
  assert.deepEqual(compileUtm(input("paid_search")), {
    parameters: {
      utm_source: "google", utm_medium: "cpc",
      utm_campaign: "index_climate_launch_search-ad_awareness_emea",
      utm_content: "index_climate_launch_search-ad_awareness_investors_asset-managers_emea",
      utm_term: "{keyword}",
    },
    automationName: null,
  });
  const social = compileUtm(input("paid_social"));
  assert.equal(social.parameters.utm_campaign, "index_climate_launch_search-ad_awareness");
  assert.equal(social.parameters.utm_content, "index_climate_launch_search-ad_awareness_investors_asset-managers_emea");
  assert.equal(social.parameters.utm_term, "banner_300x250_article_learn-more");
  assert.deepEqual(compileUtm(input("display")), social);

  const newsletter = compileUtm(input("newsletter_email"));
  assert.equal(newsletter.parameters.utm_campaign, "digital_index_climate_launch_nwsltr_awareness_investors_2026-10-20_v2");
  assert.equal(newsletter.parameters.utm_content, "hero_index_climate_launch_article");

  const nurture = compileUtm(input("nurture_email"));
  assert.equal(nurture.parameters.utm_campaign, "digital_index_climate_launch_nurt_awareness_investors_2026-10-20_Lead Flow");
  assert.equal(nurture.automationName, "digital_index_climate_launch_nurt_2026-10-20_Lead Flow");
  assert.equal("utm_content" in nurture.parameters, false);

  for (const formula of ["pre_event_email", "post_event_email"] as const) {
    const eventEmail = compileUtm(input(formula));
    assert.equal(eventEmail.parameters.utm_campaign, "digital_index_climate_launch_pre-event_awareness_investors_2026-10-20_Climate Forum");
    assert.equal(eventEmail.parameters.utm_content, "index_climate_launch_learn-more_article");
  }
  const event = compileUtm(input("events"));
  assert.equal(event.parameters.utm_campaign, "index_climate_launch_emea_2026-11-04_Climate Forum");
  assert.equal(event.parameters.utm_content, "qr_Booth QR Code_Register Now");
});

test("preserves destination query and hash and validates URL, dates, and free text", () => {
  const url = appendUtm("https://example.com/path?existing=yes#section", { utm_source: "google", utm_term: "{keyword}" });
  assert.equal(url, "https://example.com/path?existing=yes&utm_source=google&utm_term=%7Bkeyword%7D#section");
  assert.throws(() => appendUtm("not a URL", {}), (error: unknown) => error instanceof UtmInputError && error.field === "destinationUrl");
  assert.throws(() => compileUtm({ ...input("newsletter_email"), sendDate: "20-10-2026" }), (error: unknown) => error instanceof UtmInputError && error.field === "sendDate");
  assert.throws(() => compileUtm({ ...input("paid_search"), keyword: "undefined" }), (error: unknown) => error instanceof UtmInputError && error.field === "keyword");
});

test("replaces all compiler-owned parameters so nurture cannot retain stale values", () => {
  const nurture = compileUtm(input("nurture_email"));
  const url = new URL(appendUtm(
    "https://example.com/path?keep=yes&utm_source=old&utm_medium=old&utm_campaign=old&utm_content=stale&utm_term=stale&utm_sf_cmp_id=701OLDOLDOLDOLD#section",
    nurture.parameters,
  ));
  assert.equal(url.searchParams.get("keep"), "yes");
  assert.equal(url.searchParams.get("utm_source"), "google");
  assert.equal(url.searchParams.get("utm_medium"), "cpc");
  assert.equal(url.searchParams.get("utm_campaign"), nurture.parameters.utm_campaign);
  assert.equal(url.searchParams.has("utm_content"), false);
  assert.equal(url.searchParams.has("utm_term"), false);
  assert.equal(url.searchParams.has("utm_sf_cmp_id"), false);
  assert.equal(url.hash, "#section");
});

test("passes Salesforce ID through without generating one", () => {
  const absent = compileUtm(input("paid_search"));
  assert.equal("utm_sf_cmp_id" in absent.parameters, false);
  const supplied = compileUtm({ ...input("paid_search"), salesforceCampaignId: "701ABCdef123456XYZ" });
  assert.equal(supplied.parameters.utm_sf_cmp_id, "701ABCdef123456XYZ");
});