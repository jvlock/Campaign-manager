import { foreignKey, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { assets, campaigns, communications, landingPages } from "./campaign";

const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const ctas = pgTable("ctas", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  name: text("name").notNull(),
  buttonText: text("button_text").notNull(),
  landingPageId: uuid("landing_page_id"),
  destinationUrl: text("destination_url"),
  owner: text("owner").notNull(),
  status: text("status").notNull().default("Not Started"),
  publishBy: text("publish_by"),
  legacySourceKey: text("legacy_source_key").unique(),
  sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>().default({}).notNull(),
  ...audit,
}, (table) => ({
  idCampaignUnique: unique("ctas_id_campaign_unique").on(table.id, table.campaignId),
  landingPageCampaignFk: foreignKey({
    columns: [table.landingPageId, table.campaignId],
    foreignColumns: [landingPages.id, landingPages.campaignId],
    name: "ctas_landing_page_campaign_fk",
  }),
}));

export const communicationCtas = pgTable("communication_ctas", {
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  communicationId: uuid("communication_id").notNull(),
  ctaId: uuid("cta_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.communicationId, table.ctaId], name: "communication_ctas_pk" }),
  communicationCampaignFk: foreignKey({
    columns: [table.communicationId, table.campaignId],
    foreignColumns: [communications.id, communications.campaignId],
    name: "communication_ctas_communication_campaign_fk",
  }),
  ctaCampaignFk: foreignKey({
    columns: [table.ctaId, table.campaignId],
    foreignColumns: [ctas.id, ctas.campaignId],
    name: "communication_ctas_cta_campaign_fk",
  }),
}));

export const communicationLandingPages = pgTable("communication_landing_pages", {
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  communicationId: uuid("communication_id").notNull(),
  landingPageId: uuid("landing_page_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.communicationId, table.landingPageId], name: "communication_landing_pages_pk" }),
  communicationCampaignFk: foreignKey({
    columns: [table.communicationId, table.campaignId],
    foreignColumns: [communications.id, communications.campaignId],
    name: "communication_landing_pages_communication_campaign_fk",
  }),
  landingPageCampaignFk: foreignKey({
    columns: [table.landingPageId, table.campaignId],
    foreignColumns: [landingPages.id, landingPages.campaignId],
    name: "communication_landing_pages_landing_page_campaign_fk",
  }),
}));

export const landingPageContentAssets = pgTable("landing_page_content_assets", {
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  landingPageId: uuid("landing_page_id").notNull(),
  contentAssetId: uuid("content_asset_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.landingPageId, table.contentAssetId], name: "landing_page_content_assets_pk" }),
  landingPageCampaignFk: foreignKey({
    columns: [table.landingPageId, table.campaignId],
    foreignColumns: [landingPages.id, landingPages.campaignId],
    name: "landing_page_content_assets_landing_page_campaign_fk",
  }),
  assetCampaignFk: foreignKey({
    columns: [table.contentAssetId, table.campaignId],
    foreignColumns: [assets.id, assets.campaignId],
    name: "landing_page_content_assets_asset_campaign_fk",
  }),
}));