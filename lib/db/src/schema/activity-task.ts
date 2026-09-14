import { integer, pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

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
  ...audit,
});

export type InsertActivityTask = typeof activityTasks.$inferInsert;
export type ActivityTask = typeof activityTasks.$inferSelect;