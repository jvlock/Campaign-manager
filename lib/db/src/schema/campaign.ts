import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  timing: text("timing").default("TBD").notNull(), owner: text("owner").default("Campaign team").notNull(), ...audit,
});
export const campaignRegions = pgTable("campaign_regions", { id: id(), campaignId: uuid("campaign_id").notNull(), region: text("region").notNull(), configuration: jsonb("configuration").default({}).notNull(), ...audit });
export const campaignStrategy = pgTable("campaign_strategy", { id: id(), campaignId: uuid("campaign_id").notNull().unique(), data: jsonb("data").default({}).notNull(), inheritance: jsonb("inheritance").default({}).notNull(), ...audit });
export const audiences = pgTable("audiences", { id: id(), campaignId: uuid("campaign_id").notNull(), name: text("name").notNull(), region: text("region").notNull(), ...audit });
export const activities = pgTable("activities", {
  id: id(), campaignId: uuid("campaign_id").notNull(), name: text("name").notNull(), type: text("type").notNull(),
  audience: text("audience").notNull(), region: text("region").notNull(), timing: text("timing").notNull(),
  status: text("status").notNull(), owner: text("owner").notNull(), conflict: boolean("conflict").default(false).notNull(),
  decisionStatus: text("decision_status").default("Estimated").notNull(), x: numeric("x").notNull(), y: numeric("y").notNull(), ...audit,
});
export const activityConnections = pgTable("activity_connections", {
  id: id(), campaignId: uuid("campaign_id").notNull(), source: uuid("source").notNull(), target: uuid("target").notNull(),
  trigger: text("trigger").notNull(), timing: text("timing").notNull(), exclusions: jsonb("exclusions").default([]).notNull(),
  sentence: text("sentence").notNull(), ...audit,
});
export const communications = pgTable("communications", { id: id(), campaignId: uuid("campaign_id").notNull(), activityId: uuid("activity_id"), name: text("name").notNull(), status: text("status").notNull(), ...audit });
export const assets = pgTable("assets", { id: id(), campaignId: uuid("campaign_id").notNull(), name: text("name").notNull(), reusable: boolean("reusable").default(false).notNull(), status: text("status").notNull(), ...audit });
export const landingPages = pgTable("landing_pages", { id: id(), campaignId: uuid("campaign_id").notNull(), name: text("name").notNull(), url: text("url"), status: text("status").notNull(), ...audit });
export const kpis = pgTable("kpis", { id: id(), campaignId: uuid("campaign_id").notNull(), name: text("name").notNull(), target: numeric("target"), status: text("status").notNull(), ...audit });
export const budgets = pgTable("budgets", { id: id(), campaignId: uuid("campaign_id").notNull(), amount: numeric("amount"), currency: text("currency").default("USD").notNull(), status: text("status").notNull(), ...audit });
export const conflicts = pgTable("conflicts", { id: id(), classification: text("classification").notNull(), severity: text("severity").notNull(), title: text("title").notNull(), reason: text("reason").notNull(), campaignIds: jsonb("campaign_ids").notNull(), dates: text("dates").notNull(), recommendation: text("recommendation").notNull(), owner: text("owner").notNull(), status: text("status").notNull(), ...audit });
export const conflictResolutions = pgTable("conflict_resolutions", { id: id(), conflictId: uuid("conflict_id").notNull(), resolution: text("resolution").notNull(), owner: text("owner").notNull(), ...audit });
export const approvals = pgTable("approvals", { id: id(), campaignId: uuid("campaign_id").notNull(), stage: text("stage").notNull(), status: text("status").notNull(), approver: text("approver").notNull(), ...audit });
export const taxonomyVersions = pgTable("taxonomy_versions", { id: id(), version: text("version").notNull().unique(), effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(), deprecatedAt: timestamp("deprecated_at", { withTimezone: true }), ...audit });
export const taxonomyTerms = pgTable("taxonomy_terms", { id: id(), versionId: uuid("version_id").notNull(), category: text("category").notNull(), label: text("label").notNull(), shortcode: text("shortcode").notNull(), parentId: uuid("parent_id"), ...audit });
export const utmLinks = pgTable("utm_links", { id: id(), campaignId: uuid("campaign_id").notNull(), destinationUrl: text("destination_url").notNull(), fullUrl: text("full_url").notNull(), taxonomyVersion: text("taxonomy_version").notNull(), generatedValues: jsonb("generated_values").notNull(), validation: text("validation").notNull(), status: text("status").notNull(), publishedAt: timestamp("published_at", { withTimezone: true }), ...audit });
export const changeLog = pgTable("change_log", { id: id(), entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(), action: text("action").notNull(), changes: jsonb("changes").notNull(), actor: text("actor").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() });
