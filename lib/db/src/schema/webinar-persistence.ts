import { boolean, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./campaign";
import { webinarPeople, webinarSessions } from "./webinar";

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

// 0025 adds only immutable fixture/source/obligation/history records alongside the application
// registration and attendance current projections; it does not fork their model.
export const webinarSyntheticFixtures = pgTable("webinar_synthetic_fixtures", {
  personId: uuid("person_id").primaryKey().references(() => webinarPeople.id),
  campaignId: uuid("campaign_id").notNull(),
  fixtureKey: text("fixture_key").notNull(),
  provenance: text("provenance").notNull().default("synthetic-participant-simulator"),
  audienceClass: text("audience_class").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique().on(t.campaignId, t.fixtureKey),
  unique().on(t.personId, t.campaignId),
  foreignKey({ columns: [t.personId, t.campaignId], foreignColumns: [webinarPeople.id, webinarPeople.campaignId] }),
]);

export const webinarLifecycleEvents = pgTable("webinar_lifecycle_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  personId: uuid("person_id"),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  eventKey: text("event_key").notNull(),
  action: text("action").notNull(),
  sourceSystem: text("source_system").notNull().default("synthetic-simulator"),
  sourceReference: text("source_reference").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
}, t => [
  unique().on(t.sessionId, t.eventKey),
  unique().on(t.sessionId, t.sourceSystem, t.sourceReference),
  unique().on(t.id, t.campaignId, t.sessionId),
  foreignKey({ columns: [t.sessionId, t.campaignId], foreignColumns: [webinarPersistenceBindings.sessionId, webinarPersistenceBindings.campaignId] }),
  foreignKey({ columns: [t.personId, t.campaignId], foreignColumns: [webinarSyntheticFixtures.personId, webinarSyntheticFixtures.campaignId] }),
]);

export const webinarLifecycleObligations = pgTable("webinar_lifecycle_obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  personId: uuid("person_id").notNull(),
  communicationId: text("communication_id").notNull(),
  kind: text("kind").notNull(),
  disposition: text("disposition").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  reason: text("reason").notNull(),
  sourceEventId: uuid("source_event_id").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique().on(t.sourceEventId, t.personId, t.communicationId),
  foreignKey({ columns: [t.sourceEventId, t.campaignId, t.sessionId],
    foreignColumns: [webinarLifecycleEvents.id, webinarLifecycleEvents.campaignId, webinarLifecycleEvents.sessionId] }),
  foreignKey({ columns: [t.personId, t.campaignId],
    foreignColumns: [webinarSyntheticFixtures.personId, webinarSyntheticFixtures.campaignId] }),
]);

export const webinarLifecycleSnapshots = pgTable("webinar_lifecycle_snapshots", {
  eventId: uuid("event_id").notNull().references(() => webinarLifecycleEvents.id),
  snapshotId: uuid("snapshot_id").notNull().unique().references(() => webinarPersistenceRecords.id),
  personId: uuid("person_id").references(() => webinarSyntheticFixtures.personId),
}, t => [primaryKey({ columns: [t.eventId, t.snapshotId] }), unique().on(t.eventId, t.personId)]);

/** Synthetic-only prior execution evidence; never an operational send table. */
export const webinarSyntheticExecutions = pgTable("webinar_synthetic_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  personId: uuid("person_id").notNull(),
  communicationId: text("communication_id").notNull(),
  kind: text("kind").notNull(),
  syntheticMessageReference: uuid("synthetic_message_reference").notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
  sourceEventId: uuid("source_event_id").notNull(),
  provenance: text("provenance").notNull().default("synthetic-fixture-history"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique().on(t.sessionId, t.personId, t.communicationId),
  unique().on(t.sessionId, t.syntheticMessageReference),
  foreignKey({ columns: [t.sourceEventId, t.campaignId, t.sessionId],
    foreignColumns: [webinarLifecycleEvents.id, webinarLifecycleEvents.campaignId, webinarLifecycleEvents.sessionId] }),
  foreignKey({ columns: [t.personId, t.campaignId],
    foreignColumns: [webinarSyntheticFixtures.personId, webinarSyntheticFixtures.campaignId] }),
]);