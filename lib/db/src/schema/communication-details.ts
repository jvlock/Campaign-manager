import { boolean, foreignKey, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audiences, campaigns, communications } from "./campaign";

/**
 * Delivery details deliberately live in a one-to-one extension table.  The
 * legacy communications row remains the source of identity, ordering and
 * user-owned delivery fields while this table carries the operational
 * contract needed by the webinar and QA workflows.
 */
export const communicationDetails = pgTable("communication_details", {
  id: uuid("id").defaultRandom().primaryKey(),
  communicationId: uuid("communication_id").notNull().unique().references(() => communications.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  audienceBranchId: uuid("audience_branch_id").notNull().references(() => audiences.id, { onDelete: "cascade" }),
  communicationType: text("communication_type").notNull().default("Other"),
  channel: text("channel"),
  approvalStatus: text("approval_status").notNull().default("Not started"),
  qaAudienceConfirmed: boolean("qa_audience_confirmed").notNull().default(false),
  qaContentApproved: boolean("qa_content_approved").notNull().default(false),
  qaLinksVerified: boolean("qa_links_verified").notNull().default(false),
  qaTimingVerified: boolean("qa_timing_verified").notNull().default(false),
  qaOwnerConfirmed: boolean("qa_owner_confirmed").notNull().default(false),
  blockingDependencyTaskIds: jsonb("blocking_dependency_task_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    communicationCampaignForeignKey: foreignKey({
      columns: [table.communicationId, table.campaignId],
      foreignColumns: [communications.id, communications.campaignId],
      name: "communication_details_communication_campaign_fk",
    }),
    audienceCampaignForeignKey: foreignKey({
      columns: [table.audienceBranchId, table.campaignId],
      foreignColumns: [audiences.id, audiences.campaignId],
      name: "communication_details_audience_campaign_fk",
    }).onDelete("cascade"),
  }),
);

export type CommunicationDetails = typeof communicationDetails.$inferSelect;
export type InsertCommunicationDetails = typeof communicationDetails.$inferInsert;