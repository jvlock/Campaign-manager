import assert from "node:assert/strict";
import { test } from "node:test";
import {
  foundationCampaignShortcodes,
  foundationProductLines,
  foundationSubcampaigns,
  foundationTaxonomySeed,
} from "../../../lib/db/src/seeds/foundation-taxonomy";

test("Foundation production fixture is the exact supplied 7/51/40 hierarchy", () => {
  assert.equal(foundationProductLines.length, 7);
  assert.equal(foundationCampaignShortcodes.length, 51);
  assert.equal(foundationSubcampaigns.length, 40);
  assert.equal(foundationTaxonomySeed.length, 98);

  const stableKeys = new Set(foundationTaxonomySeed.map((row) => row.stableKey));
  assert.equal(stableKeys.size, 98);
  const productKeys = new Set(foundationProductLines.map((row) => row.stableKey));
  const campaignKeys = new Set(foundationCampaignShortcodes.map((row) => row.stableKey));
  assert.ok(foundationCampaignShortcodes.every((row) => row.parentStableKey && productKeys.has(row.parentStableKey)));
  assert.ok(foundationSubcampaigns.every((row) => row.parentStableKey && campaignKeys.has(row.parentStableKey)));

  assert.equal(
    foundationCampaignShortcodes.find((row) => row.stableKey === "employer_brand")?.tagCode,
    "employer_brand",
  );
  assert.equal(foundationSubcampaigns.filter((row) => row.tagCode === "recurring-events").length, 2);
  assert.equal(foundationCampaignShortcodes.filter((row) => row.tagCode === "bau").length, 7);
});