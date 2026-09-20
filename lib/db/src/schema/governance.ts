import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { taxonomyVersions } from "./campaign";

const id = () => uuid("id").defaultRandom().primaryKey();
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export type TaxonomyTermSourceMetadata = {
  sourceLabel?: string;
  codeProvenance?: string;
  source_environment?: "development";
  verification_status?: "provisional";
  publishing_eligible?: false;
  source_reference?: string;
  requires_business_validation?: true;
  [key: string]: unknown;
};

export type GovernanceQuarantineMetadata = {
  source_environment: "development";
  verification_status: "provisional";
  publishing_eligible: false;
  source_reference: "Campaign Governance Foundation, migrated via audit";
  requires_business_validation: true;
};

/**
 * The governance representation of taxonomy_terms deliberately lives in this
 * module rather than campaign.ts.  There must only be one Drizzle declaration
 * for the taxonomy_terms table; consumers should import this declaration after
 * the legacy declaration in campaign.ts is removed.
 */
export const taxonomyTerms = pgTable(
  "taxonomy_terms",
  {
    id: id(),
    versionId: uuid("version_id").notNull(),
    category: text("category").notNull(),
    label: text("label").notNull(),
    shortcode: text("shortcode").notNull(),
    stableKey: text("stable_key"),
    parentId: uuid("parent_id"),
    supersededBy: uuid("superseded_by"),
    legacyCodes: jsonb("legacy_codes").$type<string[]>().default([]).notNull(),
    sourceMetadata: jsonb("source_metadata").$type<TaxonomyTermSourceMetadata>().default({}).notNull(),
    isDeprecated: boolean("is_deprecated").default(false).notNull(),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    deprecationReason: text("deprecation_reason"),
    ...audit,
  },
  (table) => ({
    versionReference: foreignKey({
      columns: [table.versionId],
      foreignColumns: [taxonomyVersions.id],
      name: "taxonomy_terms_version_id_fk",
    }),
    parentReference: foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "taxonomy_terms_parent_id_fk",
    }),
    supersededByReference: foreignKey({
      columns: [table.supersededBy],
      foreignColumns: [table.id],
      name: "taxonomy_terms_superseded_by_fk",
    }),
    versionStableKeyIndex: uniqueIndex("taxonomy_terms_version_stable_key_uq").on(
      table.versionId,
      table.stableKey,
    ),
    hierarchyLookupIndex: index("taxonomy_terms_hierarchy_lookup_idx").on(
      table.versionId,
      table.category,
      table.parentId,
      table.shortcode,
    ),
    versionIndex: index("taxonomy_terms_version_idx").on(table.versionId),
  }),
);

export const governedChannels = pgTable("governed_channels", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  type: text("type").notNull(),
  sourceMetadata: jsonb("source_metadata")
    .$type<TaxonomyTermSourceMetadata & GovernanceQuarantineMetadata>()
    .default({
      source_environment: "development",
      verification_status: "provisional",
      publishing_eligible: false,
      source_reference: "Campaign Governance Foundation, migrated via audit",
      requires_business_validation: true,
    })
    .notNull(),
  ...audit,
});

export const taxonomyCategories = pgTable("taxonomy_categories", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  ...audit,
});

/**
 * Approvals are polymorphic.  campaign_id remains nullable for compatibility
 * with older clients and rows, while record_type/record_id are the canonical
 * target fields after migration 0004.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    campaignId: uuid("campaign_id"),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    approver: text("approver").notNull(),
    ...audit,
  },
  (table) => ({
    targetIndex: index("approvals_record_target_idx").on(table.recordType, table.recordId),
  }),
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    body: text("body").notNull(),
    actor: text("actor").notNull(),
    ...audit,
  },
  (table) => ({
    targetIndex: index("comments_record_target_idx").on(table.recordType, table.recordId),
  }),
);

export const governanceAuditEvents = pgTable(
  "governance_audit_events",
  {
    id: id(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    entityIndex: index("governance_audit_events_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  }),
);

// A short alias is useful to callers that use "governanceAudit" as the
// resource name, without declaring a second Drizzle table.
export const governanceAudit = governanceAuditEvents;

export const taxonomyImportBatches = pgTable(
  "taxonomy_import_batches",
  {
    id: id(),
    versionId: uuid("version_id").notNull(),
    sourceName: text("source_name").notNull(),
    idempotencyKey: text("idempotency_key"),
    status: text("status").default("staged").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    ...audit,
  },
  (table) => ({
    idempotencyIndex: uniqueIndex("taxonomy_import_batches_idempotency_uq").on(
      table.idempotencyKey,
    ),
    versionIndex: index("taxonomy_import_batches_version_idx").on(table.versionId),
  }),
);

export const taxonomyImportCandidates = pgTable(
  "taxonomy_import_candidates",
  {
    id: id(),
    batchId: uuid("batch_id").notNull(),
    sourceKey: text("source_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").default("staged").notNull(),
    conflictType: text("conflict_type"),
    conflicts: jsonb("conflicts").$type<string[]>().default([]).notNull(),
    reviewNote: text("review_note"),
    committedTermId: uuid("committed_term_id"),
    ...audit,
  },
  (table) => ({
    batchSourceKeyIndex: uniqueIndex("taxonomy_import_candidates_batch_source_key_uq").on(
      table.batchId,
      table.sourceKey,
    ),
    batchIndex: index("taxonomy_import_candidates_batch_idx").on(table.batchId),
  }),
);

export type GovernanceTaxonomyTerm = typeof taxonomyTerms.$inferSelect;
export type GovernanceApproval = typeof approvals.$inferSelect;
export type GovernanceComment = typeof comments.$inferSelect;
export type GovernanceAuditEvent = typeof governanceAuditEvents.$inferSelect;
export type TaxonomyImportBatch = typeof taxonomyImportBatches.$inferSelect;
export type TaxonomyImportCandidate = typeof taxonomyImportCandidates.$inferSelect;
