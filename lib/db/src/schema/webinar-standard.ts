import { boolean, foreignKey, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { campaigns, communications, activities } from "./campaign";
import { webinarPeople, webinarSessions } from "./webinar";
import { scheduleRules } from "./planning";

export const STANDARD_WEBINAR_KEYS = [
  "registration_confirmation",
  "recruitment_1",
  "recruitment_2",
  "recruitment_3",
  "final_recruitment",
  "registered_reminder",
  "final_reminder",
  "attendee_followup",
  "no_show_followup",
] as const;

export type WebinarStandardKey = (typeof STANDARD_WEBINAR_KEYS)[number];
export const DEFAULT_WEBINAR_STANDARD_KEYS = [
  "recruitment_1",
  "recruitment_2",
  "registered_reminder",
  "final_reminder",
  "attendee_followup",
] as const;
export type DefaultWebinarStandardKey = (typeof DEFAULT_WEBINAR_STANDARD_KEYS)[number];
export type WebinarStandardContent = {
  subject: string;
  preheader: string;
  hero: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  internalAssetName: string;
};
export type WebinarStandardVariantContent = {
  slot: number;
  content: WebinarStandardContent;
};
export type WebinarStandardVariant = {
  slot: number;
  name: string;
  inUse: boolean;
  audienceDefinition: string;
  messageAngle: string;
  valueProposition: string;
};
export type WebinarStandardPilotLimits = Record<keyof WebinarStandardContent, number>;

export const DEFAULT_WEBINAR_STANDARD_LIMITS: WebinarStandardPilotLimits = {
  subject: 50,
  preheader: 90,
  hero: 60,
  body: 1200,
  ctaLabel: 25,
  ctaUrl: 2000,
  internalAssetName: 120,
};

export const DEFAULT_WEBINAR_STANDARD_VARIANTS: WebinarStandardVariant[] = [
  {
    slot: 1,
    name: "Default",
    inUse: true,
    audienceDefinition: "All eligible webinar audience",
    messageAngle: "",
    valueProposition: "",
  },
];

export const webinarStandardConfigs = pgTable("webinar_standard_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().unique().references(() => webinarSessions.id, { onDelete: "cascade" }),
  pilotLimits: jsonb("pilot_limits").$type<WebinarStandardPilotLimits>().notNull().default(DEFAULT_WEBINAR_STANDARD_LIMITS),
  variants: jsonb("variants").$type<WebinarStandardVariant[]>().notNull().default(DEFAULT_WEBINAR_STANDARD_VARIANTS),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sessionCampaignForeignKey: foreignKey({
    columns: [table.sessionId, table.campaignId],
    foreignColumns: [webinarSessions.id, webinarSessions.campaignId],
    name: "webinar_standard_configs_session_campaign_fk",
  }),
}));

export const webinarStandardCommunications = pgTable(
  "webinar_standard_communications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => webinarSessions.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    status: text("status").notNull().default("DRAFT"),
    audienceRule: text("audience_rule").notNull(),
    timingKind: text("timing_kind").notNull(),
    offsetValue: integer("offset_value").notNull().default(0),
    offsetUnit: text("offset_unit").notNull(),
    direction: text("direction").notNull(),
    weekendAdjustment: text("weekend_adjustment").notNull(),
    locked: boolean("locked").notNull().default(true),
    variants: jsonb("variants").$type<WebinarStandardVariantContent[]>().notNull().default([]),
    communicationId: uuid("communication_id").references(() => communications.id, { onDelete: "set null" }),
    legacyCommunicationId: uuid("legacy_communication_id"),
    scheduleRuleId: uuid("schedule_rule_id").references(() => scheduleRules.id, { onDelete: "set null" }),
    originalScheduledAt: timestamp("original_scheduled_at", { withTimezone: true }),
    currentScheduledAt: timestamp("current_scheduled_at", { withTimezone: true }),
    effectiveScheduledAt: timestamp("effective_scheduled_at", { withTimezone: true }),
    scheduleStatus: text("schedule_status").notNull().default("scheduled"),
    skipReason: text("skip_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idCampaignUnique: uniqueIndex("webinar_standard_communications_id_campaign_idx").on(table.id, table.campaignId),
    sessionKeyUnique: uniqueIndex("webinar_standard_communications_session_key_idx").on(table.sessionId, table.key),
    sessionSortUnique: uniqueIndex("webinar_standard_communications_session_sort_idx").on(table.sessionId, table.sortOrder),
    sessionCampaignForeignKey: foreignKey({
      columns: [table.sessionId, table.campaignId],
      foreignColumns: [webinarSessions.id, webinarSessions.campaignId],
      name: "webinar_standard_communications_session_campaign_fk",
    }),
    activityCampaignForeignKey: foreignKey({
      columns: [table.activityId, table.campaignId],
      foreignColumns: [activities.id, activities.campaignId],
      name: "webinar_standard_communications_activity_campaign_fk",
    }),
    communicationCampaignForeignKey: foreignKey({
      columns: [table.communicationId, table.campaignId],
      foreignColumns: [communications.id, communications.campaignId],
      name: "webinar_standard_communications_communication_campaign_fk",
    }),
    scheduleRuleCampaignForeignKey: foreignKey({
      columns: [table.scheduleRuleId, table.campaignId],
      foreignColumns: [scheduleRules.id, scheduleRules.campaignId],
      name: "webinar_standard_communications_schedule_rule_campaign_fk",
    }),
  }),
);

export const webinarStandardTriggerEvents = pgTable(
  "webinar_standard_trigger_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => webinarSessions.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    standardCommunicationId: uuid("standard_communication_id").notNull().references(() => webinarStandardCommunications.id, { onDelete: "cascade" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionCampaignForeignKey: foreignKey({
      columns: [table.sessionId, table.campaignId],
      foreignColumns: [webinarSessions.id, webinarSessions.campaignId],
      name: "webinar_standard_trigger_events_session_campaign_fk",
    }),
    personCampaignForeignKey: foreignKey({
      columns: [table.personId, table.campaignId],
      foreignColumns: [webinarPeople.id, webinarPeople.campaignId],
      name: "webinar_standard_trigger_events_person_campaign_fk",
    }),
    standardCommunicationCampaignForeignKey: foreignKey({
      columns: [table.standardCommunicationId, table.campaignId],
      foreignColumns: [webinarStandardCommunications.id, webinarStandardCommunications.campaignId],
      name: "webinar_standard_trigger_events_communication_campaign_fk",
    }),
  }),
);

export type WebinarStandardConfig = typeof webinarStandardConfigs.$inferSelect;
export type InsertWebinarStandardConfig = typeof webinarStandardConfigs.$inferInsert;
export type WebinarStandardCommunication = typeof webinarStandardCommunications.$inferSelect;
export type InsertWebinarStandardCommunication = typeof webinarStandardCommunications.$inferInsert;