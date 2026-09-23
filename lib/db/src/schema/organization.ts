import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { activities, campaigns, users } from "./campaign";

const id = () => uuid("id").defaultRandom().primaryKey();
const time = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => time("created_at").defaultNow().notNull();
const user = (name: string) => uuid(name).references(() => users.id);

// Versioned migration 0022 owns cross-row checks, partial uniqueness and immutable
// legacy registries. Use migrations, not schema push, for this foundation.
export const organizationUnits = pgTable("organization_units", {
  id: id(), name: text("name").notNull(), kind: text("kind").notNull(),
  parentId: uuid("parent_id"), status: text("status").default("active").notNull(),
  accountableOwnerId: user("accountable_owner_id"),
  rowVersion: integer("row_version").default(1).notNull(),
  createdAt: createdAt(), updatedAt: time("updated_at").defaultNow().notNull(),
});
export const organizationMemberships = pgTable("organization_memberships", {
  id: id(), unitId: uuid("unit_id").notNull().references(() => organizationUnits.id),
  userId: user("user_id").notNull(), status: text("status").default("active").notNull(),
  verifiedBy: user("verified_by").notNull(), verifiedAt: time("verified_at").defaultNow().notNull(),
  revokedAt: time("revoked_at"), rowVersion: integer("row_version").default(1).notNull(),
  createdAt: createdAt(),
});
export const organizationGrants = pgTable("organization_grants", {
  id: id(), membershipId: uuid("membership_id").references(() => organizationMemberships.id),
  recipientGroupId: uuid("recipient_group_id").references(() => organizationUnits.id),
  unitId: uuid("unit_id").references(() => organizationUnits.id),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  activityId: uuid("activity_id").references(() => activities.id),
  role: text("role"), action: text("action"), status: text("status").default("active").notNull(),
  grantedBy: user("granted_by").notNull(), revokedAt: time("revoked_at"),
  expiresAt: time("expires_at"), createdAt: createdAt(),
});
const ownership = () => ({
  groupId: uuid("group_id").notNull().references(() => organizationUnits.id),
  accountableOwnerId: user("accountable_owner_id").notNull(),
  // Null means historical creator unknown; never infer from the old owner label.
  createdBy: user("created_by"),
  rowVersion: integer("row_version").default(1).notNull(),
  reassessmentRequired: boolean("reassessment_required").default(false).notNull(),
  createdAt: createdAt(), updatedAt: time("updated_at").defaultNow().notNull(),
});
export const campaignOwnership = pgTable("campaign_ownership", {
  campaignId: uuid("campaign_id").primaryKey().references(() => campaigns.id), ...ownership(),
});
export const campaignGroupParticipation = pgTable("campaign_group_participation", {
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  groupId: uuid("group_id").notNull().references(() => organizationUnits.id),
  createdBy: user("created_by").notNull(), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.campaignId, t.groupId] })]);
export const activityOwnership = pgTable("activity_ownership", {
  activityId: uuid("activity_id").primaryKey().references(() => activities.id),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  ...ownership(), calendarVisibility: text("calendar_visibility").default("private").notNull(),
});
export const organizationAudit = pgTable("organization_audit", {
  id: id(), actorId: user("actor_id").notNull(), action: text("action").notNull(),
  unitId: uuid("unit_id").references(() => organizationUnits.id),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  activityId: uuid("activity_id").references(() => activities.id),
  details: jsonb("details").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: createdAt(),
});
export const organizationTransfers = pgTable("organization_transfers", {
  id: id(), campaignId: uuid("campaign_id").references(() => campaigns.id),
  activityId: uuid("activity_id").references(() => activities.id),
  sourceGroupId: uuid("source_group_id").notNull().references(() => organizationUnits.id),
  destinationGroupId: uuid("destination_group_id").notNull().references(() => organizationUnits.id),
  requestedBy: user("requested_by").notNull(), acceptedBy: user("accepted_by"),
  acceptedAt: time("accepted_at"), status: text("status").default("pending").notNull(),
  rowVersion: integer("row_version").default(1).notNull(), createdAt: createdAt(),
});
export const legacyCampaigns = pgTable("legacy_campaigns", {
  campaignId: uuid("campaign_id").primaryKey().references(() => campaigns.id),
  recordedAt: time("recorded_at").defaultNow().notNull(),
});
export const legacyActivities = pgTable("legacy_activities", {
  activityId: uuid("activity_id").primaryKey().references(() => activities.id),
  recordedAt: time("recorded_at").defaultNow().notNull(),
});