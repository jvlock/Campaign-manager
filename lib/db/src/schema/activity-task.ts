import { boolean, doublePrecision, integer, pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

const id = () => uuid("id").defaultRandom().primaryKey();
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const activityTasks = pgTable("activity_tasks", {
  id: id(),
  campaignId: uuid("campaign_id").notNull(),
  activityId: uuid("activity_id").notNull(),
  name: text("name").notNull(),
  type: text("type").default("Other").notNull(),
  timing: text("timing").default("TBD").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  status: text("status").default("Estimated").notNull(),
  owner: text("owner").default("Campaign team").notNull(),
  stage: text("stage").default("Not Started").notNull(),
  blocked: boolean("blocked").default(false).notNull(),
  blockedReason: text("blocked_reason"),
  supportingOwner: text("supporting_owner").default("").notNull(),
  requestingTeam: text("requesting_team").default("").notNull(),
  requester: text("requester").default("").notNull(),
  notes: text("notes").default("").notNull(),
  trigger: text("trigger").default("gtm_launch").notNull(),
  offsetDays: integer("offset_days"),
  businessDayStrategy: text("business_day_strategy").default("calendar").notNull(),
  effortPoints: doublePrecision("effort_points").default(1).notNull(),
  ...audit,
});

export const activityTaskSettings = pgTable("activity_task_settings", {
  activityId: uuid("activity_id").primaryKey(),
  campaignId: uuid("campaign_id").notNull(),
  gtmLaunchAt: timestamp("gtm_launch_at", { withTimezone: true }),
  eventAt: timestamp("event_at", { withTimezone: true }),
  timezone: text("timezone").default("UTC").notNull(),
  tier: text("tier"),
});
export const taskDefaults = pgTable("task_defaults", {
  type: text("type").primaryKey(),
  offsetDays: integer("offset_days").notNull(),
  label: text("label").default("Configurable reference default").notNull(),
});
export const ownerCapacities = pgTable("owner_capacities", {
  owner: text("owner").primaryKey(),
  ceiling: doublePrecision("ceiling").default(10).notNull(),
});

export type InsertActivityTask = typeof activityTasks.$inferInsert;
export type ActivityTask = typeof activityTasks.$inferSelect;