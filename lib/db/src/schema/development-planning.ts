import { boolean, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./campaign";
import { organizationUnits } from "./organization";

export const developmentPlanningEnvironment = pgTable("development_planning_environment", {
  id: boolean("id").primaryKey().default(true),
  marker: text("marker").notNull(),
  defaultGroupId: uuid("default_group_id").notNull().references(() => organizationUnits.id),
  creatorId: uuid("creator_id").notNull().references(() => users.id),
  accountableOwnerId: uuid("accountable_owner_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const developmentRecordRegistry = pgTable("development_record_registry", {
  entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(),
  attribution: text("attribution").notNull().default("unverified-development"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [primaryKey({ columns: [t.entityType, t.entityId] })]);
export const developmentSimulations = pgTable("development_simulations", {
  id: uuid("id").primaryKey().defaultRandom(), entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(), label: text("label").notNull().default("UNVERIFIED DEVELOPMENT SIMULATION"),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});