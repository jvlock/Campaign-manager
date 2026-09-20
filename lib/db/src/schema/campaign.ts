import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").defaultRandom().primaryKey();
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable("users", { id: id(), name: text("name").notNull(), email: text("email").notNull().unique(), role: text("role").default("marketer").notNull(), ...audit });
export const campaigns = pgTable("campaigns", {
  id: id(), parentId: uuid("parent_id"), name: text("name").notNull(), scope: text("scope").notNull(),
  region: text("region").default("Global").notNull(), audience: text("audience").notNull(), outcome: text("outcome").notNull(),
  lifecycle: text("lifecycle").default("Idea").notNull(), readiness: integer("readiness").default(20).notNull(),
  timing: text("timing").default("TBD").notNull(), owner: text("owner").default("Campaign team").notNull(),
  normalizedName: text("normalized_name").generatedAlwaysAs(sql`lower(regexp_replace(name, '[^[:alnum:]]', '', 'g'))`),
  rowVersion: integer("row_version").default(1).notNull(), ...audit,
});
export const campaignRegions = pgTable("campaign_regions", { id: id(), campaignId: uuid("campaign_id").notNull(), region: text("region").notNull(), configuration: jsonb("configuration").default({}).notNull(), ...audit });
export const campaignStrategy = pgTable("campaign_strategy", { id: id(), campaignId: uuid("campaign_id").notNull().unique(), data: jsonb("data").default({}).notNull(), inheritance: jsonb("inheritance").default({}).notNull(), ...audit });
export const audiences = pgTable("audiences", {
  id: id(),
  campaignId: uuid("campaign_id").notNull(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  ...audit,
}, (table) => ({
  idCampaignUnique: unique("audiences_id_campaign_unique").on(table.id, table.campaignId),
}));
export const activities = pgTable("activities", {
  id: id(), campaignId: uuid("campaign_id").notNull(), name: text("name").notNull(), type: text("type").notNull(),
  audience: text("audience").notNull(), region: text("region").notNull(), timing: text("timing").notNull(),
  status: text("status").notNull(), owner: text("owner").notNull(), conflict: boolean("conflict").default(false).notNull(),
  decisionStatus: text("decision_status").default("Estimated").notNull(), x: numeric("x").notNull(), y: numeric("y").notNull(),
  activityTypeId: text("activity_type_id"),
  activityAnswers: jsonb("activity_answers").$type<Record<string, unknown>>().default({}).notNull(),
  activityOverrides: jsonb("activity_overrides").$type<Record<string, unknown>>().default({}).notNull(),
  generatedName: text("generated_name"),
  namingInput: text("naming_input"),
  effectiveInheritance: jsonb("effective_inheritance").$type<Record<string, unknown>>().default({}).notNull(),
  rowVersion: integer("row_version").default(1).notNull(), ...audit,
}, (table) => ({
  idCampaignUnique: unique("activities_id_campaign_unique").on(table.id, table.campaignId),
}));
export const activityConnections = pgTable("activity_connections", {
  id: id(), campaignId: uuid("campaign_id").notNull(), source: uuid("source").notNull(), target: uuid("target").notNull(),
  trigger: text("trigger").notNull(), timing: text("timing").notNull(), exclusions: jsonb("exclusions").default([]).notNull(),
  sentence: text("sentence").notNull(), parentBranchId: uuid("parent_branch_id"),
  entryCondition: jsonb("entry_condition").default({}).notNull(),
  suppressionRule: jsonb("suppression_rule").default({}).notNull(), ...audit,
});
export const communications = pgTable("communications", {
  id: id(),
  campaignId: uuid("campaign_id").notNull(),
  activityId: uuid("activity_id").notNull(),
  name: text("name").notNull(),
  type: text("type").default("Other").notNull(),
  timing: text("timing").default("TBD").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  status: text("status").default("Estimated").notNull(),
  owner: text("owner").default("Campaign team").notNull(),
  ...audit,
}, (table) => ({
  idCampaignUnique: unique("communications_id_campaign_unique").on(table.id, table.campaignId),
}));
export const assets = pgTable("assets", {
  id: id(), campaignId: uuid("campaign_id").notNull(), name: text("name").notNull(),
  reusable: boolean("reusable").default(true).notNull(), status: text("status").notNull(),
  brief: text("brief").default("").notNull(), owner: text("owner").default("Campaign team").notNull(),
  publishBy: text("publish_by"), ...audit,
}, (table) => ({
  idCampaignUnique: unique("assets_id_campaign_unique").on(table.id, table.campaignId),
}));
export const landingPages = pgTable("landing_pages", {
  id: id(), campaignId: uuid("campaign_id").notNull(), name: text("name").notNull(),
  url: text("url"), status: text("status").notNull(),
  headline: text("headline").default("").notNull(),
  supportingCopyNeeds: text("supporting_copy_needs").default("").notNull(),
  personalizationRequirements: text("personalization_requirements").default("").notNull(),
  owner: text("owner").default("Campaign team").notNull(), publishBy: text("publish_by"), ...audit,
}, (table) => ({
  idCampaignUnique: unique("landing_pages_id_campaign_unique").on(table.id, table.campaignId),
}));
export const kpis = pgTable("kpis", { id: id(), campaignId: uuid("campaign_id").notNull(), name: text("name").notNull(), target: numeric("target"), status: text("status").notNull(), ...audit });
export const budgets = pgTable("budgets", { id: id(), campaignId: uuid("campaign_id").notNull(), amount: numeric("amount"), currency: text("currency").default("USD").notNull(), status: text("status").notNull(), ...audit });
export const conflicts = pgTable("conflicts", { id: id(), classification: text("classification").notNull(), severity: text("severity").notNull(), title: text("title").notNull(), reason: text("reason").notNull(), campaignIds: jsonb("campaign_ids").notNull(), dates: text("dates").notNull(), recommendation: text("recommendation").notNull(), owner: text("owner").notNull(), status: text("status").notNull(), ...audit });
export const conflictResolutions = pgTable("conflict_resolutions", { id: id(), conflictId: uuid("conflict_id").notNull(), resolution: text("resolution").notNull(), owner: text("owner").notNull(), ...audit });
export const taxonomyVersions = pgTable("taxonomy_versions", { id: id(), version: text("version").notNull().unique(), effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(), deprecatedAt: timestamp("deprecated_at", { withTimezone: true }), ...audit });
export const utmLinks = pgTable("utm_links", { id: id(), campaignId: uuid("campaign_id").notNull(), destinationUrl: text("destination_url").notNull(), fullUrl: text("full_url").notNull(), taxonomyVersion: text("taxonomy_version").notNull(), generatedValues: jsonb("generated_values").notNull(), validation: text("validation").notNull(), status: text("status").notNull(), publishedAt: timestamp("published_at", { withTimezone: true }), ...audit });
export const changeLog = pgTable("change_log", { id: id(), entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(), action: text("action").notNull(), changes: jsonb("changes").notNull(), actor: text("actor").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() });

// Kept in this module so the existing schema/index.ts export remains compatible
// while the planning tables can be added without changing another agent's file.
export * from "./planning";
