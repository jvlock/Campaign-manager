import { boolean, date, foreignKey, integer, jsonb, pgTable, text, time, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { activities, audiences, campaigns } from "./campaign";

export type WebinarSpeaker = { name: string; role?: string; organization?: string };

/**
 * A session owns the version of the fixed webinar communication sequence it
 * was provisioned with.  This is deliberately persisted on the session rather
 * than inferred from its current rows: legacy sessions must never be silently
 * converted when the default for new sessions changes.
 */
export const WEBINAR_TEMPLATE_VERSIONS = ["legacy_9", "default_5"] as const;
export type WebinarTemplateVersion = (typeof WEBINAR_TEMPLATE_VERSIONS)[number];
export const LEGACY_WEBINAR_TEMPLATE_VERSION: WebinarTemplateVersion = "legacy_9";
export const DEFAULT_NEW_WEBINAR_TEMPLATE_VERSION: WebinarTemplateVersion = "default_5";

export const webinarSessions = pgTable(
  "webinar_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sessionDate: date("session_date").notNull(),
    startTime: time("start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    timezone: text("timezone").notNull(),
    platform: text("platform").notNull(),
    speakers: jsonb("speakers").$type<WebinarSpeaker[]>().notNull().default([]),
    recruitmentLaunchAt: timestamp("recruitment_launch_at", { withTimezone: true }),
    templateVersion: text("template_version").notNull().default(LEGACY_WEBINAR_TEMPLATE_VERSION),
    registrationRule: jsonb("registration_rule")
      .$type<{
        suppressRecruitmentAfterRegistration: boolean;
        registeredBranch?: string;
        attendedBranch?: string;
        noShowBranch?: string;
      }>()
      .notNull()
      .default({ suppressRecruitmentAfterRegistration: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    campaignActivityNameUnique: uniqueIndex("webinar_sessions_campaign_activity_name_idx").on(
      table.campaignId,
      table.activityId,
      table.name,
    ),
    idCampaignUnique: unique("webinar_sessions_id_campaign_unique").on(table.id, table.campaignId),
    activityCampaignForeignKey: foreignKey({
      columns: [table.activityId, table.campaignId],
      foreignColumns: [activities.id, activities.campaignId],
      name: "webinar_sessions_activity_campaign_fk",
    }),
  }),
);

/**
 * People are intentionally campaign-scoped and synthetic-only.  No contact
 * details are stored: these records model planning branches, not a sending
 * audience or an external CRM.
 */
export const webinarPeople = pgTable(
  "webinar_people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    audienceBranchId: uuid("audience_branch_id").notNull().references(() => audiences.id),
    name: text("name").notNull(),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    campaignPersonNameUnique: uniqueIndex("webinar_people_campaign_name_idx").on(table.campaignId, table.name),
    idCampaignUnique: unique("webinar_people_id_campaign_unique").on(table.id, table.campaignId),
    audienceCampaignForeignKey: foreignKey({
      columns: [table.audienceBranchId, table.campaignId],
      foreignColumns: [audiences.id, audiences.campaignId],
      name: "webinar_people_audience_campaign_fk",
    }),
  }),
);

export const webinarRegistrationResults = pgTable(
  "webinar_registration_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => webinarSessions.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull().references(() => webinarPeople.id, { onDelete: "cascade" }),
    result: text("result").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    firstRegisteredAt: timestamp("first_registered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionPersonUnique: uniqueIndex("webinar_registration_results_session_person_idx").on(table.sessionId, table.personId),
    sessionCampaignForeignKey: foreignKey({
      columns: [table.sessionId, table.campaignId],
      foreignColumns: [webinarSessions.id, webinarSessions.campaignId],
      name: "webinar_registration_results_session_campaign_fk",
    }),
    personCampaignForeignKey: foreignKey({
      columns: [table.personId, table.campaignId],
      foreignColumns: [webinarPeople.id, webinarPeople.campaignId],
      name: "webinar_registration_results_person_campaign_fk",
    }),
  }),
);

export const webinarAttendanceResults = pgTable(
  "webinar_attendance_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => webinarSessions.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull().references(() => webinarPeople.id, { onDelete: "cascade" }),
    result: text("result").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionPersonUnique: uniqueIndex("webinar_attendance_results_session_person_idx").on(table.sessionId, table.personId),
    sessionCampaignForeignKey: foreignKey({
      columns: [table.sessionId, table.campaignId],
      foreignColumns: [webinarSessions.id, webinarSessions.campaignId],
      name: "webinar_attendance_results_session_campaign_fk",
    }),
    personCampaignForeignKey: foreignKey({
      columns: [table.personId, table.campaignId],
      foreignColumns: [webinarPeople.id, webinarPeople.campaignId],
      name: "webinar_attendance_results_person_campaign_fk",
    }),
  }),
);

export type WebinarSession = typeof webinarSessions.$inferSelect;
export type InsertWebinarSession = typeof webinarSessions.$inferInsert;
export type WebinarPerson = typeof webinarPeople.$inferSelect;
export type WebinarRegistrationResult = typeof webinarRegistrationResults.$inferSelect;
export type WebinarAttendanceResult = typeof webinarAttendanceResults.$inferSelect;

// Friendly domain aliases for callers that refer to the two result ledgers as
// registrations and attendances.  Both remain separate physical tables.
export const webinarRegistrations = webinarRegistrationResults;
export const webinarAttendances = webinarAttendanceResults;