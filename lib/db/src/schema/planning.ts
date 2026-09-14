import { createInsertSchema } from "drizzle-zod";
import { boolean, foreignKey, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { activities, campaigns, communications } from "./campaign";

const id = () => uuid("id").defaultRandom().primaryKey();
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

/**
 * A schedule rule is deliberately independent from delivery child tables.  A
 * rule may target an activity, a communication, or both, and may anchor on a
 * different activity (for example a webinar session).
 */
export const scheduleRules = pgTable(
  "schedule_rules",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull(),
    activityId: uuid("activity_id"),
    communicationId: uuid("communication_id"),
    anchorActivityId: uuid("anchor_activity_id"),
    offsetDays: integer("offset_days").default(0).notNull(),
    offsetMinutes: integer("offset_minutes").default(0).notNull(),
    direction: text("direction").default("after").notNull(),
    businessDayStrategy: text("business_day_strategy").default("calendar").notNull(),
    audienceLocalTimezone: boolean("audience_local_timezone").default(false).notNull(),
    timezone: text("timezone").default("UTC").notNull(),
    targetSendTime: text("target_send_time"),
    enabled: boolean("enabled").default(true).notNull(),
    rowVersion: integer("row_version").default(1).notNull(),
    ...audit,
  },
  (table) => ({
    campaignForeignKey: foreignKey({
      columns: [table.campaignId],
      foreignColumns: [campaigns.id],
      name: "schedule_rules_campaign_fk",
    }),
    activityCampaignForeignKey: foreignKey({
      columns: [table.activityId, table.campaignId],
      foreignColumns: [activities.id, activities.campaignId],
      name: "schedule_rules_activity_campaign_fk",
    }),
    communicationCampaignForeignKey: foreignKey({
      columns: [table.communicationId, table.campaignId],
      foreignColumns: [communications.id, communications.campaignId],
      name: "schedule_rules_communication_campaign_fk",
    }),
    anchorActivityCampaignForeignKey: foreignKey({
      columns: [table.anchorActivityId, table.campaignId],
      foreignColumns: [activities.id, activities.campaignId],
      name: "schedule_rules_anchor_activity_campaign_fk",
    }),
  }),
);

/**
 * scheduledInstances.originalCalculatedAt is an audit value.  calculatedAt is
 * always the latest rule-derived result; adjustedAt is the effective manual
 * send override (when present). updatedAt records when an adjustment was
 * recorded, and application updates never overwrite originalCalculatedAt.
 */
export const scheduledInstances = pgTable(
  "scheduled_instances",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull(),
    ruleId: uuid("rule_id").notNull(),
    activityId: uuid("activity_id"),
    communicationId: uuid("communication_id"),
    originalCalculatedAt: timestamp("original_calculated_at", { withTimezone: true }).notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(),
    adjustedAt: timestamp("adjusted_at", { withTimezone: true }),
    adjustmentReason: text("adjustment_reason"),
    timezone: text("timezone").notNull(),
    status: text("status").default("scheduled").notNull(),
    rowVersion: integer("row_version").default(1).notNull(),
    ...audit,
  },
  (table) => ({
    campaignForeignKey: foreignKey({
      columns: [table.campaignId],
      foreignColumns: [campaigns.id],
      name: "scheduled_instances_campaign_fk",
    }),
    ruleCampaignForeignKey: foreignKey({
      columns: [table.ruleId, table.campaignId],
      foreignColumns: [scheduleRules.id, scheduleRules.campaignId],
      name: "scheduled_instances_rule_campaign_fk",
    }),
    activityCampaignForeignKey: foreignKey({
      columns: [table.activityId, table.campaignId],
      foreignColumns: [activities.id, activities.campaignId],
      name: "scheduled_instances_activity_campaign_fk",
    }),
    communicationCampaignForeignKey: foreignKey({
      columns: [table.communicationId, table.campaignId],
      foreignColumns: [communications.id, communications.campaignId],
      name: "scheduled_instances_communication_campaign_fk",
    }),
  }),
);

export const scheduledInstanceHistory = pgTable(
  "scheduled_instance_history",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull(),
    scheduledInstanceId: uuid("scheduled_instance_id").notNull(),
    ruleId: uuid("rule_id").notNull(),
    anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
    previousCalculatedAt: timestamp("previous_calculated_at", { withTimezone: true }),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    campaignForeignKey: foreignKey({
      columns: [table.campaignId],
      foreignColumns: [campaigns.id],
      name: "scheduled_instance_history_campaign_fk",
    }),
    instanceCampaignForeignKey: foreignKey({
      columns: [table.scheduledInstanceId, table.campaignId],
      foreignColumns: [scheduledInstances.id, scheduledInstances.campaignId],
      name: "scheduled_instance_history_instance_campaign_fk",
    }),
    ruleCampaignForeignKey: foreignKey({
      columns: [table.ruleId, table.campaignId],
      foreignColumns: [scheduleRules.id, scheduleRules.campaignId],
      name: "scheduled_instance_history_rule_campaign_fk",
    }),
  }),
);

export const insertScheduleRuleSchema = createInsertSchema(scheduleRules);
export const insertScheduledInstanceSchema = createInsertSchema(scheduledInstances);
export type ScheduleRule = typeof scheduleRules.$inferSelect;
export type InsertScheduleRule = typeof scheduleRules.$inferInsert;
export type ScheduledInstance = typeof scheduledInstances.$inferSelect;
export type ScheduledInstanceHistory = typeof scheduledInstanceHistory.$inferSelect;