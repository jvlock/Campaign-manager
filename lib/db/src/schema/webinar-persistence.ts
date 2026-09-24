import { boolean, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./campaign";
import { webinarSessions } from "./webinar";

// Constraints, append-only triggers and deferred audit enforcement live in 0024.
export const webinarPersistenceBindings = pgTable("webinar_persistence_bindings", {
  sessionId: uuid("session_id").primaryKey(),
  campaignId: uuid("campaign_id").notNull(),
  standardId: text("standard_id"),
  standardVersion: text("standard_version"),
  revision: integer("revision").notNull().default(0),
}, t => [
  unique().on(t.sessionId, t.campaignId),
  foreignKey({ columns: [t.sessionId, t.campaignId], foreignColumns: [webinarSessions.id, webinarSessions.campaignId] }),
]);

export const webinarPersistenceRecords = pgTable("webinar_persistence_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  revision: integer("revision").notNull(),
  kind: text("kind").notNull(),
  standardId: text("standard_id"),
  standardVersion: text("standard_version"),
  calculationAt: timestamp("calculation_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  inputFingerprint: text("input_fingerprint").notNull(),
  payload: jsonb("payload").notNull(),
  parentId: uuid("parent_id"),
  releaseId: uuid("release_id"),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  attribution: text("attribution").notNull().default("unverified-development"),
  operational: boolean("operational").notNull().default(false),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  retentionClass: text("retention_class").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [
  unique().on(t.id, t.sessionId, t.campaignId),
  unique().on(t.sessionId, t.revision),
  unique().on(t.sessionId, t.idempotencyKey),
  unique().on(t.sessionId, t.kind, t.inputFingerprint, t.calculationAt),
  foreignKey({ columns: [t.sessionId, t.campaignId], foreignColumns: [webinarPersistenceBindings.sessionId, webinarPersistenceBindings.campaignId] }),
]);

export const webinarPersistenceAudit = pgTable("webinar_persistence_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordId: uuid("record_id").notNull().unique(),
  campaignId: uuid("campaign_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  retentionClass: text("retention_class").notNull().default("audit"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [foreignKey({
  columns: [t.recordId, t.sessionId, t.campaignId],
  foreignColumns: [webinarPersistenceRecords.id, webinarPersistenceRecords.sessionId, webinarPersistenceRecords.campaignId],
})]);