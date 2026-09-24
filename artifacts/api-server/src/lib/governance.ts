import {
  activities,
  approvals,
  assets,
  budgets,
  campaigns,
  comments,
  conflicts,
  db,
  governanceAuditEvents,
  landingPages,
  kpis,
  taxonomyImportBatches,
  taxonomyImportCandidates,
  taxonomyCategories,
  taxonomyTerms,
  taxonomyVersions,
  communications,
} from "@workspace/db";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { pagination } from "./pagination";
import {
  GovernanceQuarantineError,
  PROVISIONAL_GOVERNANCE,
  assertNoFinalityRequest,
  assertNoSourceMetadataEscalation,
  quarantineApprovalResponse,
} from "./governance-quarantine";

export const RECORD_TYPES = [
  "campaign",
  "activity",
  "communication",
  "asset",
  "landingPage",
  "kpi",
  "budget",
  "conflict",
  "taxonomyTerm",
  "taxonomyVersion",
  "importBatch",
  "importCandidate",
] as const;

export type GovernanceRecordType = (typeof RECORD_TYPES)[number];

const RECORD_TYPE_ALIASES: Record<string, GovernanceRecordType> = {
  campaign: "campaign",
  campaigns: "campaign",
  activity: "activity",
  activities: "activity",
  communication: "communication",
  communications: "communication",
  asset: "asset",
  assets: "asset",
  landingPage: "landingPage",
  landing_page: "landingPage",
  "landing-page": "landingPage",
  kpi: "kpi",
  budget: "budget",
  conflict: "conflict",
  taxonomyTerm: "taxonomyTerm",
  taxonomy_term: "taxonomyTerm",
  taxonomyVersion: "taxonomyVersion",
  taxonomy_version: "taxonomyVersion",
  importBatch: "importBatch",
  import_batch: "importBatch",
  importCandidate: "importCandidate",
  import_candidate: "importCandidate",
};

export class GovernanceError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "GovernanceError";
    this.status = status;
    this.details = details;
  }
}

type Executor = any;

export function normalizeRecordType(value: unknown): GovernanceRecordType {
  if (typeof value !== "string") {
    throw new GovernanceError("recordType is required and must be a supported value");
  }
  const normalized = RECORD_TYPE_ALIASES[value.trim()];
  if (!normalized) {
    throw new GovernanceError(
      `Unsupported recordType. Expected one of: ${RECORD_TYPES.join(", ")}`,
    );
  }
  return normalized;
}

/**
 * Authentication is intentionally not implied here: the current application
 * has no authentication middleware.  Mutations require an explicitly supplied
 * actor so that audit records are never anonymous.
 */
export function validateActor(value: unknown): string {
  if (typeof value !== "string") {
    throw new GovernanceError(
      "actor is required; authentication is not configured, so supply the acting user explicitly",
    );
  }
  const actor = value.trim();
  if (!actor || actor.length > 200) {
    throw new GovernanceError("actor must be between 1 and 200 characters");
  }
  return actor;
}

export function validateReason(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GovernanceError("reason is required for every governance mutation");
  }
  const reason = value.trim();
  if (reason.length > 2_000) {
    throw new GovernanceError("reason must be 2,000 characters or fewer");
  }
  return reason;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new GovernanceError(`${field} must be a UUID`);
  }
  return value;
}

function snapshot(value: unknown): unknown {
  if (value === undefined || value === null) return value ?? null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function auditValue(value: unknown): any {
  return snapshot(value);
}

function sourceMetadataResponse(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function termResponse(term: any) {
  return {
    id: term.id,
    versionId: term.versionId,
    category: term.category,
    label: term.label,
    shortcode: term.shortcode,
    stableKey: term.stableKey ?? null,
    parentId: term.parentId,
    supersededBy: term.supersededBy,
    legacyCodes: Array.isArray(term.legacyCodes) ? term.legacyCodes : [],
    sourceMetadata: sourceMetadataResponse(term.sourceMetadata),
    // Deliberate server overlay: production may still contain legacy rows after
    // schema-only Publish sync, so stored legacy metadata is never authority.
    source_environment: "development",
    verification_status: "provisional",
    publishing_eligible: false,
    source_reference: "Campaign Governance Foundation, migrated via audit",
    requires_business_validation: true,
    governance: PROVISIONAL_GOVERNANCE,
    isDeprecated: Boolean(term.isDeprecated),
    deprecatedAt: term.deprecatedAt,
    deprecationReason: term.deprecationReason,
    createdAt: term.createdAt,
    updatedAt: term.updatedAt,
  };
}

function termSemanticState(term: any) {
  return {
    category: term.category,
    label: term.label,
    shortcode: term.shortcode,
    stableKey: term.stableKey ?? null,
    parentId: term.parentId ?? null,
    supersededBy: term.supersededBy ?? null,
    legacyCodes: Array.isArray(term.legacyCodes) ? term.legacyCodes : [],
    sourceMetadata: sourceMetadataResponse(term.sourceMetadata),
    isDeprecated: Boolean(term.isDeprecated),
    deprecatedAt: term.deprecatedAt ?? null,
    deprecationReason: term.deprecationReason ?? null,
  };
}

function semanticTermChanged(before: any, after: any) {
  return JSON.stringify(termSemanticState(before)) !== JSON.stringify(termSemanticState(after));
}

async function findVersion(tx: Executor, input: { versionId?: unknown; version?: unknown }) {
  let row;
  if (input.versionId !== undefined) {
    const versionId = uuid(input.versionId, "versionId");
    [row] = await tx.select().from(taxonomyVersions).where(eq(taxonomyVersions.id, versionId));
  } else if (typeof input.version === "string" && input.version.trim()) {
    [row] = await tx
      .select()
      .from(taxonomyVersions)
      .where(eq(taxonomyVersions.version, input.version.trim()));
  } else {
    throw new GovernanceError("versionId or version is required");
  }
  if (!row) throw new GovernanceError("Taxonomy version not found", 404);
  return row;
}

async function termsForVersion(tx: Executor, versionId: string) {
  return tx.select().from(taxonomyTerms).where(eq(taxonomyTerms.versionId, versionId));
}

async function lockTaxonomyVersion(tx: Executor, versionId: string) {
  // A taxonomy version is the serialization boundary for code namespace
  // writes.  This keeps validation and insertion atomic when two imports or
  // term mutations arrive concurrently.
  await tx.execute(sql`SELECT id FROM taxonomy_versions WHERE id = ${versionId} FOR UPDATE`);
}

async function importNamespaceTerms(
  tx: Executor,
  versionId: string,
  excludeBatchId?: string,
) {
  const terms = await termsForVersion(tx, versionId);
  const batches = await tx
    .select({ id: taxonomyImportBatches.id })
    .from(taxonomyImportBatches)
    .where(eq(taxonomyImportBatches.versionId, versionId));
  const otherBatchIds = batches
    .map((batch: { id: string }) => batch.id)
    .filter((id: string) => id !== excludeBatchId);
  if (!otherBatchIds.length) return terms;
  const candidates = await tx
    .select()
    .from(taxonomyImportCandidates)
    .where(inArray(taxonomyImportCandidates.batchId, otherBatchIds));
  return [
    ...terms,
    ...candidates
      // A committed candidate is represented by its taxonomy term and must not
      // remain as a second namespace owner during stable-key replay.
      .filter((candidate: any) => candidate.status !== "rejected" && candidate.status !== "committed")
      .map((candidate: any) => ({
        id: candidate.id,
        shortcode: typeof candidate.payload?.shortcode === "string" ? candidate.payload.shortcode : "",
        label: typeof candidate.payload?.label === "string" ? candidate.payload.label : "",
        category: typeof candidate.payload?.category === "string" ? candidate.payload.category : "",
        stableKey: typeof candidate.payload?.stableKey === "string" ? candidate.payload.stableKey : null,
        parentId: typeof candidate.payload?.parentStableKey === "string"
          ? candidate.payload.parentStableKey
          : typeof candidate.payload?.parentId === "string" ? candidate.payload.parentId : null,
        legacyCodes: Array.isArray(candidate.payload?.legacyCodes) ? candidate.payload.legacyCodes : [],
      })),
  ];
}

async function assertTermInVersion(
  tx: Executor,
  termId: string,
  versionId: string,
  field: string,
) {
  const [term] = await tx
    .select()
    .from(taxonomyTerms)
    .where(and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.versionId, versionId)));
  if (!term) throw new GovernanceError(`${field} must belong to the same taxonomy version`, 400);
  return term;
}

async function assertTaxonomyHierarchy(
  tx: Executor,
  versionId: string,
  category: string,
  parentId: string | null,
) {
  const expectedParentCategory = category === "campaign_shortcode"
    ? "product_line"
    : category === "subcampaign" ? "campaign_shortcode" : null;
  if (category === "product_line" && parentId) {
    throw new GovernanceError("product_line cannot have a taxonomy parent");
  }
  if (expectedParentCategory && !parentId) {
    throw new GovernanceError(`${category} requires a ${expectedParentCategory} parent`);
  }
  if (expectedParentCategory && parentId) {
    const parent = await assertTermInVersion(tx, parentId, versionId, "parentId");
    if (parent.category !== expectedParentCategory) {
      throw new GovernanceError(`${category} parent must be a ${expectedParentCategory}`);
    }
  }
}

async function assertNoTermCycle(
  tx: Executor,
  versionId: string,
  startId: string | null | undefined,
  selfId: string,
  edge: "parent" | "supersededBy",
) {
  if (!startId) return;
  let currentId: string | null = startId;
  const seen = new Set<string>();
  while (currentId) {
    if (currentId === selfId || seen.has(currentId)) {
      throw new GovernanceError(`${edge} reference would create a taxonomy cycle`);
    }
    seen.add(currentId);
    const current = await assertTermInVersion(tx, currentId, versionId, edge);
    currentId = edge === "parent" ? current.parentId : current.supersededBy;
  }
}

async function assertCodesAvailable(
  tx: Executor,
  versionId: string,
  codes: string[],
  selfId?: string,
) {
  const normalizedCodes = codes.map((code) => code.trim()).filter(Boolean);
  if (new Set(normalizedCodes).size !== normalizedCodes.length) {
    throw new GovernanceError("A taxonomy term cannot reuse a shortcode in its legacyCodes", 409);
  }
  const terms = await termsForVersion(tx, versionId);
  for (const code of normalizedCodes) {
    const collision = terms.find((term: any) =>
      term.id !== selfId
      && (term.shortcode === code || (Array.isArray(term.legacyCodes) && term.legacyCodes.includes(code))),
    );
    if (collision) {
      throw new GovernanceError(`Taxonomy code ${code} is already used by another term`, 409);
    }
  }
}

async function assertNamespaceAvailable(
  tx: Executor,
  versionId: string,
  codes: string[],
  selfId?: string,
  selfCandidateId?: string,
) {
  await assertCodesAvailable(tx, versionId, codes, selfId);
  const terms = await importNamespaceTerms(tx, versionId);
  const normalizedCodes = codes.map((code) => code.trim()).filter(Boolean);
  for (const code of normalizedCodes) {
    const collision = terms.find((term: any) =>
      term.id !== selfId
      && term.id !== selfCandidateId
      && (term.shortcode === code || (Array.isArray(term.legacyCodes) && term.legacyCodes.includes(code))),
    );
    if (collision) {
      throw new GovernanceError(`Taxonomy code ${code} is already used by another term or import candidate`, 409);
    }
  }
}

async function insertAudit(
  tx: Executor,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    actor: string;
    reason: string;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(governanceAuditEvents).values({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actor: input.actor,
    reason: input.reason,
    before: auditValue(input.before),
    after: auditValue(input.after),
    metadata: {
      ...(input.metadata ?? {}),
      actorProvenance: "declared",
    },
  });
}

export async function listGovernanceAudit(filters: {
  entityType?: unknown;
  entityId?: unknown;
  limit?: unknown;
  offset?: unknown;
}) {
  const conditions: SQL[] = [];
  if (filters.entityType !== undefined) {
    if (typeof filters.entityType !== "string" || !filters.entityType.trim()) {
      throw new GovernanceError("entityType must be a non-empty string");
    }
    conditions.push(eq(governanceAuditEvents.entityType, filters.entityType.trim()));
  }
  if (filters.entityId !== undefined) {
    conditions.push(eq(governanceAuditEvents.entityId, uuid(filters.entityId, "entityId")));
  }
  const page = pagination(filters);
  return db.transaction(async tx => {
  const rows = await tx
    .select()
    .from(governanceAuditEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(governanceAuditEvents.id)
    .limit(page.limit).offset(page.offset);
  const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(governanceAuditEvents)
    .where(conditions.length ? and(...conditions) : undefined);
  return { page, total: count.total, items: rows.map((row) => ({
    ...row,
    before: row.before ?? null,
    after: row.after ?? null,
    actorProvenance: (row.metadata as Record<string, unknown> | null)?.actorProvenance ?? "declared",
  })) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function listTerms(input: { versionId?: unknown; version?: unknown }) {
  const version = input.versionId !== undefined || input.version !== undefined
    ? await findVersion(db, input)
    : (await db.select().from(taxonomyVersions)
      .where(sql`${taxonomyVersions.effectiveAt} <= now() AND (${taxonomyVersions.deprecatedAt} IS NULL OR ${taxonomyVersions.deprecatedAt} > now())`)
      .orderBy(desc(taxonomyVersions.effectiveAt)).limit(1))[0];
  if (!version) throw new GovernanceError("No currently effective taxonomy version", 404);
  const [terms, categories] = await Promise.all([
    termsForVersion(db, version.id),
    db.select().from(taxonomyCategories),
  ]);
  return {
    version: version.version,
    versionId: version.id,
    categories: categories.map((category) => category.key).sort(),
    terms: terms.map(termResponse),
  };
}

export async function createTerm(input: {
  actor: unknown;
  reason: unknown;
  versionId?: unknown;
  version?: unknown;
  category: unknown;
  label: unknown;
  shortcode: unknown;
  stableKey?: unknown;
  parentId?: unknown;
  supersededBy?: unknown;
  legacyCodes?: unknown;
}) {
  assertNoFinalityRequest(input, "taxonomyTerm");
  const rawInput = input as typeof input & {
    sourceMetadata?: unknown;
    source_metadata?: unknown;
    "source-metadata"?: unknown;
  };
  assertNoSourceMetadataEscalation(
    rawInput.sourceMetadata ?? rawInput.source_metadata ?? rawInput["source-metadata"],
    "taxonomyTerm.sourceMetadata",
  );
  const actor = validateActor(input.actor);
  const reason = validateReason(input.reason);
  if (typeof input.category !== "string" || !input.category.trim()) {
    throw new GovernanceError("category is required");
  }
  const category = input.category.trim();
  if (typeof input.label !== "string" || !input.label.trim()) {
    throw new GovernanceError("label is required");
  }
  const label = input.label.trim();
  if (typeof input.shortcode !== "string" || !input.shortcode.trim()) {
    throw new GovernanceError("shortcode is required");
  }
  const version = await findVersion(db, input);
  const shortcode = input.shortcode.trim();
  const stableKey = input.stableKey === undefined || input.stableKey === null
    ? null
    : typeof input.stableKey === "string" && input.stableKey.trim()
      ? input.stableKey.trim()
      : (() => { throw new GovernanceError("stableKey must be a non-empty string"); })();
  const legacyCodes = Array.isArray(input.legacyCodes)
    ? [...new Set(input.legacyCodes.filter((code): code is string => typeof code === "string" && Boolean(code.trim())).map((code) => code.trim()))]
    : [];
  return db.transaction(async (tx) => {
    await lockTaxonomyVersion(tx, version.id);
    const parentId = input.parentId === undefined || input.parentId === null ? null : uuid(input.parentId, "parentId");
    const supersededBy = input.supersededBy === undefined || input.supersededBy === null ? null : uuid(input.supersededBy, "supersededBy");
    if (parentId) await assertTermInVersion(tx, parentId, version.id, "parentId");
    await assertTaxonomyHierarchy(tx, version.id, category, parentId);
    if (supersededBy) await assertTermInVersion(tx, supersededBy, version.id, "supersededBy");
    const existing = (await termsForVersion(tx, version.id)).find((term: any) =>
      term.category === category && term.parentId === parentId && term.shortcode === shortcode);
    if (existing) throw new GovernanceError("A term with this shortcode already exists under this taxonomy parent", 409);
    if (stableKey) {
      const stableCollision = (await termsForVersion(tx, version.id)).find((term: any) => term.stableKey === stableKey);
      if (stableCollision) throw new GovernanceError("A term with this stableKey already exists in the taxonomy version", 409);
    }
    await assertNamespaceAvailable(tx, version.id, legacyCodes);
    const [created] = await tx
      .insert(taxonomyTerms)
      .values({
        versionId: version.id,
        category,
        label,
        shortcode,
        stableKey,
        parentId,
        supersededBy,
        legacyCodes,
      })
      .returning();
    await insertAudit(tx, {
      entityType: "taxonomyTerm",
      entityId: created.id,
      action: "create",
      actor,
      reason,
      before: null,
      after: termResponse(created),
    });
    return termResponse(created);
  });
}

export async function updateTerm(
  termIdInput: unknown,
  input: {
    actor: unknown;
    reason: unknown;
    action?: unknown;
    category?: unknown;
    label?: unknown;
    shortcode?: unknown;
    stableKey?: unknown;
    parentId?: unknown;
    supersededBy?: unknown;
    legacyCodes?: unknown;
  },
) {
  assertNoFinalityRequest(input, "taxonomyTerm");
  const rawInput = input as typeof input & {
    sourceMetadata?: unknown;
    source_metadata?: unknown;
    "source-metadata"?: unknown;
  };
  assertNoSourceMetadataEscalation(
    rawInput.sourceMetadata ?? rawInput.source_metadata ?? rawInput["source-metadata"],
    "taxonomyTerm.sourceMetadata",
  );
  const termId = uuid(termIdInput, "termId");
  const actor = validateActor(input.actor);
  const reason = validateReason(input.reason);
  return db.transaction(async (tx) => {
    let [current] = await tx.select().from(taxonomyTerms).where(eq(taxonomyTerms.id, termId));
    if (!current) throw new GovernanceError("Taxonomy term not found", 404);
    await lockTaxonomyVersion(tx, current.versionId);
    // Read again after the version lock so a queued writer never applies a
    // stale rename/legacy-code snapshot.
    [current] = await tx.select().from(taxonomyTerms).where(eq(taxonomyTerms.id, termId));
    if (!current) throw new GovernanceError("Taxonomy term not found", 404);
    const action = typeof input.action === "string" ? input.action : "update";
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.stableKey !== undefined && input.stableKey !== current.stableKey) {
      throw new GovernanceError("stableKey is immutable", 409);
    }
    if (input.category !== undefined) {
      if (typeof input.category !== "string" || !input.category.trim()) throw new GovernanceError("category must be non-empty");
      if (current.stableKey && input.category.trim() !== current.category) {
        throw new GovernanceError("category is immutable for stable-keyed terms", 409);
      }
      patch.category = input.category.trim();
    }
    if (input.label !== undefined) {
      if (typeof input.label !== "string" || !input.label.trim()) throw new GovernanceError("label must be non-empty");
      patch.label = input.label.trim();
    }
    if (input.shortcode !== undefined) {
      if (typeof input.shortcode !== "string" || !input.shortcode.trim()) throw new GovernanceError("shortcode must be non-empty");
      const shortcode = input.shortcode.trim();
      patch.shortcode = shortcode;
      if (shortcode !== current.shortcode) {
        const oldCodes = Array.isArray(current.legacyCodes) ? current.legacyCodes : [];
        patch.legacyCodes = [...new Set([...oldCodes, current.shortcode])];
      }
    }
    if (input.parentId !== undefined) {
      const parentId = input.parentId === null ? null : uuid(input.parentId, "parentId");
      if (current.stableKey && parentId !== current.parentId) {
        throw new GovernanceError("parentId is immutable for stable-keyed terms", 409);
      }
      if (parentId) await assertTermInVersion(tx, parentId, current.versionId, "parentId");
      await assertNoTermCycle(tx, current.versionId, parentId, current.id, "parent");
      patch.parentId = parentId;
    }
    if (input.supersededBy !== undefined) {
      const supersededBy = input.supersededBy === null ? null : uuid(input.supersededBy, "supersededBy");
      if (supersededBy) await assertTermInVersion(tx, supersededBy, current.versionId, "supersededBy");
      await assertNoTermCycle(tx, current.versionId, supersededBy, current.id, "supersededBy");
      patch.supersededBy = supersededBy;
    }
    if (input.legacyCodes !== undefined) {
      if (!Array.isArray(input.legacyCodes) || input.legacyCodes.some((code) => typeof code !== "string" || !code.trim())) {
        throw new GovernanceError("legacyCodes must be an array of non-empty strings");
      }
      patch.legacyCodes = [...new Set(input.legacyCodes.map((code) => code.trim()))];
    }
    const nextShortcode = typeof patch.shortcode === "string" ? patch.shortcode : current.shortcode;
    const nextCategory = typeof patch.category === "string" ? patch.category : current.category;
    const nextParentId = Object.prototype.hasOwnProperty.call(patch, "parentId") ? patch.parentId : current.parentId;
    await assertTaxonomyHierarchy(tx, current.versionId, nextCategory, nextParentId as string | null);
    const scopedCollision = (await termsForVersion(tx, current.versionId)).find((term: any) =>
      term.id !== current.id
      && term.category === nextCategory
      && term.parentId === nextParentId
      && term.shortcode === nextShortcode);
    if (scopedCollision) throw new GovernanceError("A term with this shortcode already exists under this taxonomy parent", 409);
    let nextLegacyCodes = Array.isArray(patch.legacyCodes)
      ? patch.legacyCodes as string[]
      : Array.isArray(current.legacyCodes) ? current.legacyCodes : [];
    if (nextShortcode !== current.shortcode && !nextLegacyCodes.includes(current.shortcode)) {
      // A rename always leaves the prior shortcode resolvable, even when a
      // caller supplies an explicit replacement legacyCodes array.
      nextLegacyCodes = [...nextLegacyCodes, current.shortcode];
      patch.legacyCodes = nextLegacyCodes;
    }
    await assertNamespaceAvailable(tx, current.versionId, nextLegacyCodes, current.id);
    if (action === "deprecate") {
      patch.isDeprecated = true;
      patch.deprecatedAt = new Date();
      patch.deprecationReason = reason;
    } else if (action === "restore") {
      patch.isDeprecated = false;
      patch.deprecatedAt = null;
      patch.deprecationReason = null;
    } else if (action === "rename" && input.shortcode === undefined && input.label === undefined) {
      throw new GovernanceError("rename requires a new label or shortcode");
    }
    const [updated] = await tx
      .update(taxonomyTerms)
      .set(patch as any)
      .where(eq(taxonomyTerms.id, termId))
      .returning();
    const invalidatedApprovals = semanticTermChanged(current, updated)
      ? await tx.delete(approvals).where(and(
        inArray(approvals.recordType, ["taxonomyTerm", "taxonomy_term"]),
        eq(approvals.recordId, termId),
      )).returning({ id: approvals.id })
      : [];
    await insertAudit(tx, {
      entityType: "taxonomyTerm",
      entityId: termId,
      action,
      actor,
      reason,
      before: termResponse(current),
      after: termResponse(updated),
      metadata: { invalidatedApprovalCount: invalidatedApprovals.length },
    });
    return termResponse(updated);
  });
}

export async function resolveTerm(input: {
  versionId?: unknown;
  version?: unknown;
  code: unknown;
}) {
  if (typeof input.code !== "string" || !input.code.trim()) throw new GovernanceError("code is required");
  const version = await findVersion(db, input);
  const terms = await termsForVersion(db, version.id);
  const code = input.code.trim();
  const stableMatches = terms.filter((term: any) => term.stableKey === code);
  const matches = stableMatches.length
    ? stableMatches
    : terms.filter((term: any) => term.shortcode === code || (Array.isArray(term.legacyCodes) && term.legacyCodes.includes(code)));
  if (!matches.length) throw new GovernanceError("Taxonomy code not found", 404);
  if (matches.length > 1) throw new GovernanceError("Taxonomy code is ambiguous in this taxonomy version", 409);
  const chain: any[] = [];
  const seen = new Set<string>();
  let current: any = matches[0];
  while (current) {
    if (seen.has(current.id)) throw new GovernanceError("Taxonomy supersession chain contains a cycle", 409);
    seen.add(current.id);
    chain.push(termResponse(current));
    if (!current.supersededBy) break;
    current = terms.find((term: any) => term.id === current.supersededBy);
    if (!current) throw new GovernanceError("Taxonomy supersededBy target is invalid", 409);
  }
  return {
    input: code,
    version: version.version,
    versionId: version.id,
    resolved: chain[chain.length - 1],
    chain,
    validation: "resolved_for_provisional_preview_only",
    governance: PROVISIONAL_GOVERNANCE,
  };
}

export type ImportCandidateInput = {
  sourceKey?: unknown;
  category?: unknown;
  label?: unknown;
  shortcode?: unknown;
  stableKey?: unknown;
  parentStableKey?: unknown;
  sourceMetadata?: unknown;
  parentId?: unknown;
  parentShortcode?: unknown;
  legacyCodes?: unknown;
  [key: string]: unknown;
};

type ImportConflictResult = {
  sourceKey: string;
  payload: Record<string, unknown>;
  status: "staged" | "conflict";
  conflictType: string | null;
  conflicts: string[];
};

function candidatePayload(candidate: ImportCandidateInput): Record<string, unknown> {
  return { ...candidate };
}

export function detectImportConflicts(
  candidates: ImportCandidateInput[],
  existingTerms: Array<{
    shortcode: string;
    label: string;
    category: string;
    legacyCodes?: unknown;
    id?: string;
    stableKey?: string | null;
    parentId?: string | null;
  }>,
): ImportConflictResult[] {
  const candidateCodes = (candidate: ImportCandidateInput) => {
    const shortcode = typeof candidate.shortcode === "string" ? candidate.shortcode.trim() : "";
    const legacyCodes = Array.isArray(candidate.legacyCodes)
      ? candidate.legacyCodes
        .filter((code): code is string => typeof code === "string" && Boolean(code.trim()))
        .map((code) => code.trim())
      : [];
    return [...new Set([shortcode, ...legacyCodes].filter(Boolean))];
  };
  type CodeOwner = {
    kind: "term" | "candidate";
    index: number;
    primary: boolean;
    category: string;
    parentScope: string | null;
  };
  const owners = new Map<string, CodeOwner[]>();
  const addOwner = (code: string, owner: CodeOwner) => {
    const current = owners.get(code) ?? [];
    current.push(owner);
    owners.set(code, current);
  };
  existingTerms.forEach((term, index) => {
    const parentScope = term.parentId
      ? existingTerms.find((candidate) => candidate.id === term.parentId)?.stableKey ?? term.parentId
      : null;
    if (term.shortcode) addOwner(term.shortcode.trim(), { kind: "term", index, primary: true, category: term.category, parentScope });
    if (Array.isArray(term.legacyCodes)) {
      term.legacyCodes
        .filter((code): code is string => typeof code === "string" && Boolean(code.trim()))
        .forEach((code) => addOwner(code.trim(), { kind: "term", index, primary: false, category: term.category, parentScope }));
    }
  });
  candidates.forEach((candidate, index) => {
    const shortcode = typeof candidate.shortcode === "string" ? candidate.shortcode.trim() : "";
    candidateCodes(candidate).forEach((code) => addOwner(code, {
      kind: "candidate",
      index,
      primary: code === shortcode,
      category: typeof candidate.category === "string" ? candidate.category.trim() : "",
      parentScope: typeof candidate.parentStableKey === "string"
        ? candidate.parentStableKey.trim()
        : typeof candidate.parentId === "string" ? candidate.parentId : null,
    }));
  });
  return candidates.map((candidate, index) => {
    const payload = candidatePayload(candidate);
    const sourceKey = typeof candidate.sourceKey === "string" && candidate.sourceKey.trim()
      ? candidate.sourceKey.trim()
      : `${String(candidate.category ?? "")}:${String(candidate.shortcode ?? "")}:${index}`;
    const conflicts: string[] = [];
    if (typeof candidate.category !== "string" || !candidate.category.trim()) conflicts.push("missing_category");
    if (typeof candidate.label !== "string" || !candidate.label.trim()) conflicts.push("missing_label");
    if (typeof candidate.shortcode !== "string" || !candidate.shortcode.trim()) conflicts.push("missing_shortcode");
    const shortcode = typeof candidate.shortcode === "string" ? candidate.shortcode.trim() : "";
    const stableKey = typeof candidate.stableKey === "string" ? candidate.stableKey.trim() : "";
    const existingStableIndex = stableKey
      ? existingTerms.findIndex((term) => term.stableKey === stableKey)
      : -1;
    if (stableKey && candidates.some((other, otherIndex) =>
      otherIndex !== index
      && typeof other.stableKey === "string"
      && other.stableKey.trim() === stableKey)) {
      conflicts.push("duplicate_candidate_stable_key");
    }
    if (existingStableIndex >= 0) {
      const existingStable = existingTerms[existingStableIndex];
      const candidateParentScope = typeof candidate.parentStableKey === "string"
        ? candidate.parentStableKey.trim()
        : typeof candidate.parentId === "string" ? candidate.parentId : null;
      const existingParentScope = existingStable.parentId
        ? existingTerms.find((term) => term.id === existingStable.parentId)?.stableKey ?? existingStable.parentId
        : null;
      if (existingStable.category !== String(candidate.category ?? "").trim()) conflicts.push("stable_key_category_mismatch");
      if (existingParentScope !== candidateParentScope) conflicts.push("stable_key_parent_mismatch");
    }
    const codes = candidateCodes(candidate);
    const rawCodes = [
      shortcode,
      ...(Array.isArray(candidate.legacyCodes)
        ? candidate.legacyCodes.filter((code): code is string => typeof code === "string").map((code) => code.trim())
        : []),
    ].filter(Boolean);
    if (rawCodes.length !== new Set(rawCodes).size) {
      conflicts.push("candidate_code_overlap");
    }
    for (const code of codes) {
      const codeOwners = owners.get(code) ?? [];
      const stableScoped = typeof candidate.stableKey === "string" && Boolean(candidate.stableKey.trim());
      const candidateParentScope = typeof candidate.parentStableKey === "string"
        ? candidate.parentStableKey.trim()
        : typeof candidate.parentId === "string" ? candidate.parentId : null;
      const relevantOwners = codeOwners.filter((owner) => {
        if (owner.kind === "term" && owner.index === existingStableIndex) return false;
        if (!stableScoped || code !== shortcode || !owner.primary) return true;
        return owner.category === String(candidate.category ?? "").trim() && owner.parentScope === candidateParentScope;
      });
      if (relevantOwners.some((owner) => owner.kind === "term")) {
        conflicts.push(
          code === shortcode
          && relevantOwners.some((owner) => owner.kind === "term" && owner.primary)
            ? "existing_shortcode"
            : "existing_code",
        );
      }
      if (relevantOwners.some((owner) => owner.kind === "candidate" && owner.index !== index)) {
        conflicts.push("duplicate_candidate_code");
        if (code === shortcode && relevantOwners.some((owner) => owner.kind === "candidate" && owner.index !== index && owner.primary)) {
          conflicts.push("duplicate_candidate_shortcode");
        }
      }
    }
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    if (label && existingTerms.some((term, termIndex) =>
      termIndex !== existingStableIndex
      && term.label === label
      && term.category === String(candidate.category ?? "").trim())) {
      conflicts.push("existing_category_label");
    }
    const uniqueConflicts = [...new Set(conflicts)];
    const conflictType = uniqueConflicts.length ? uniqueConflicts[0] : null;
    return {
      sourceKey,
      payload,
      status: uniqueConflicts.length ? "conflict" : "staged",
      conflictType,
      conflicts: uniqueConflicts,
    };
  });
}

export async function createImportBatch(input: {
  actor: unknown;
  reason: unknown;
  versionId?: unknown;
  version?: unknown;
  sourceName: unknown;
  idempotencyKey?: unknown;
  candidates: unknown;
}) {
  const actor = validateActor(input.actor);
  const reason = validateReason(input.reason);
  if (typeof input.sourceName !== "string" || !input.sourceName.trim()) throw new GovernanceError("sourceName is required");
  const sourceName = input.sourceName.trim();
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) throw new GovernanceError("candidates must be a non-empty array");
  if (input.candidates.length > 10_000) throw new GovernanceError("An import batch cannot contain more than 10,000 candidates");
  const version = await findVersion(db, input);
  const idempotencyKey = input.idempotencyKey === undefined ? null : String(input.idempotencyKey).trim();
  const normalized = input.candidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new GovernanceError("Each candidate must be an object");
    assertNoFinalityRequest(candidate, "candidate");
    const normalizedCandidate = candidate as ImportCandidateInput;
    assertNoSourceMetadataEscalation(normalizedCandidate.sourceMetadata, "candidate.sourceMetadata");
    return normalizedCandidate;
  });
  return db.transaction(async (tx) => {
    await lockTaxonomyVersion(tx, version.id);
    if (idempotencyKey) {
      const [existingBatch] = await tx
        .select()
        .from(taxonomyImportBatches)
        .where(eq(taxonomyImportBatches.idempotencyKey, idempotencyKey));
      if (existingBatch) {
        if (existingBatch.versionId !== version.id) {
          throw new GovernanceError("idempotencyKey is already used for another taxonomy version", 409);
        }
        const existingCandidates = await tx
          .select()
          .from(taxonomyImportCandidates)
          .where(eq(taxonomyImportCandidates.batchId, existingBatch.id));
        return { batch: existingBatch, candidates: existingCandidates, idempotent: true };
      }
    }
    const existingTerms = await importNamespaceTerms(tx, version.id);
    const detected = detectImportConflicts(normalized, existingTerms);
    const [batch] = await tx
      .insert(taxonomyImportBatches)
      .values({
        versionId: version.id,
        sourceName,
        idempotencyKey: idempotencyKey || null,
        status: "staged",
        actor,
        reason,
      })
      .returning();
    const candidates = [];
    for (const item of detected) {
      const [candidate] = await tx
        .insert(taxonomyImportCandidates)
        .values({
          batchId: batch.id,
          sourceKey: item.sourceKey,
          payload: item.payload,
          status: item.status,
          conflictType: item.conflictType,
          conflicts: item.conflicts,
        })
        .returning();
      candidates.push(candidate);
      await insertAudit(tx, {
        entityType: "importCandidate",
        entityId: candidate.id,
        action: "stage",
        actor,
        reason,
        before: null,
        after: candidate,
        metadata: { batchId: batch.id },
      });
    }
    await insertAudit(tx, {
      entityType: "importBatch",
      entityId: batch.id,
      action: "stage",
      actor,
      reason,
      before: null,
      after: { ...batch, candidateCount: candidates.length, conflictCount: detected.filter((item) => item.conflicts.length).length },
    });
    return { batch, candidates, idempotent: false };
  });
}

export async function getImportBatch(batchIdInput: unknown) {
  const batchId = uuid(batchIdInput, "batchId");
  const [batch] = await db.select().from(taxonomyImportBatches).where(eq(taxonomyImportBatches.id, batchId));
  if (!batch) throw new GovernanceError("Import batch not found", 404);
  const candidates = await db.select().from(taxonomyImportCandidates).where(eq(taxonomyImportCandidates.batchId, batchId));
  return { batch, candidates };
}

export async function reviewImportCandidate(
  batchIdInput: unknown,
  candidateIdInput: unknown,
  input: {
    actor: unknown;
    reason: unknown;
    status?: unknown;
    note?: unknown;
    resolveConflict?: unknown;
    payload?: unknown;
  },
) {
  const batchId = uuid(batchIdInput, "batchId");
  const candidateId = uuid(candidateIdInput, "candidateId");
  const actor = validateActor(input.actor);
  const reason = validateReason(input.reason);
  if (input.status === "approved" || input.status === "final" || input.status === "official") {
    throw new GovernanceQuarantineError("status");
  }
  if (
    input.status !== undefined
    && input.status !== "business_review_complete"
    && input.status !== "rejected"
    && input.status !== "staged"
    && input.status !== "conflict"
  ) {
    throw new GovernanceError("status must be business_review_complete, rejected, staged, or conflict");
  }
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(taxonomyImportBatches)
      .where(eq(taxonomyImportBatches.id, batchId));
    if (!batch) throw new GovernanceError("Import batch not found", 404);
    await lockTaxonomyVersion(tx, batch.versionId);
    const [candidate] = await tx
      .select()
      .from(taxonomyImportCandidates)
      .where(and(eq(taxonomyImportCandidates.id, candidateId), eq(taxonomyImportCandidates.batchId, batchId)));
    if (!candidate) throw new GovernanceError("Import candidate not found", 404);
    let payload = candidate.payload;
    let conflicts = candidate.conflicts;
    let conflictType = candidate.conflictType;
    if (input.payload !== undefined) {
      if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
        throw new GovernanceError("payload must be an object");
      }
      payload = input.payload as Record<string, unknown>;
      const [siblings, existingTerms] = await Promise.all([
        tx
          .select()
          .from(taxonomyImportCandidates)
          .where(eq(taxonomyImportCandidates.batchId, batchId)),
        importNamespaceTerms(tx, batch.versionId, batchId),
      ]);
      const candidateInputs = siblings.map((sibling: any) => sibling.id === candidate.id ? payload : sibling.payload);
      const detected = detectImportConflicts(candidateInputs, existingTerms);
      const position = siblings.findIndex((sibling: any) => sibling.id === candidate.id);
      conflicts = detected[position]?.conflicts ?? [];
      conflictType = detected[position]?.conflictType ?? null;
    }
    const requestedStatus: string = input.status === undefined
      ? (conflicts.length > 0 ? "conflict" : candidate.status === "conflict" ? "staged" : candidate.status)
      : input.status === "business_review_complete" ? "staged" : input.status as string;
    if (input.status === "business_review_complete" && conflicts.length > 0 && input.resolveConflict !== true) {
      throw new GovernanceError("Conflicted candidates require resolveConflict=true before business review can complete");
    }
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      assertNoSourceMetadataEscalation((payload as Record<string, unknown>).sourceMetadata, "payload.sourceMetadata");
    }
    const reviewNote = input.status === "business_review_complete"
      ? `BUSINESS_REVIEW_COMPLETE${input.note === undefined ? "" : `\n${String(input.note)}`}`
      : input.note === undefined ? candidate.reviewNote : String(input.note);
    const before = { ...candidate };
    const [updated] = await tx
      .update(taxonomyImportCandidates)
      .set({
        status: requestedStatus,
        payload,
        conflictType,
        conflicts,
        reviewNote,
        updatedAt: new Date(),
      })
      .where(eq(taxonomyImportCandidates.id, candidateId))
      .returning();
    await insertAudit(tx, {
      entityType: "importCandidate",
      entityId: candidateId,
      action: "review",
      actor,
      reason,
      before,
      after: updated,
      metadata: { batchId },
    });
    return updated;
  });
}

async function validateImportPayload(
  tx: Executor,
  versionId: string,
  payload: Record<string, unknown>,
  candidateId?: string,
) {
  if (typeof payload.category !== "string" || !payload.category.trim()) throw new GovernanceError("Candidate category is required");
  if (typeof payload.label !== "string" || !payload.label.trim()) throw new GovernanceError("Candidate label is required");
  if (typeof payload.shortcode !== "string" || !payload.shortcode.trim()) throw new GovernanceError("Candidate shortcode is required");
  const shortcode = payload.shortcode.trim();
  const stableKey = payload.stableKey === undefined || payload.stableKey === null || payload.stableKey === ""
    ? null
    : typeof payload.stableKey === "string" && payload.stableKey.trim()
      ? payload.stableKey.trim()
      : (() => { throw new GovernanceError("Candidate stableKey must be a non-empty string"); })();
  let parentId = payload.parentId === undefined || payload.parentId === null || payload.parentId === "" ? null : uuid(payload.parentId, "parentId");
  if (!parentId && typeof payload.parentStableKey === "string" && payload.parentStableKey.trim()) {
    const matches = await tx.select().from(taxonomyTerms).where(and(
      eq(taxonomyTerms.versionId, versionId),
      eq(taxonomyTerms.stableKey, payload.parentStableKey.trim()),
    ));
    if (matches.length !== 1) throw new GovernanceError(`Parent stableKey ${payload.parentStableKey} was not found uniquely`);
    parentId = matches[0].id;
  }
  if (!parentId && typeof payload.parentShortcode === "string" && payload.parentShortcode.trim()) {
    const parentShortcode = payload.parentShortcode.trim();
    const expectedParentCategory = payload.category.trim() === "campaign_shortcode"
      ? "product_line"
      : payload.category.trim() === "subcampaign" ? "campaign_shortcode" : null;
    const matches = (await tx.select().from(taxonomyTerms).where(and(
      eq(taxonomyTerms.versionId, versionId),
      eq(taxonomyTerms.shortcode, parentShortcode),
    ))).filter((term: any) => !expectedParentCategory || term.category === expectedParentCategory);
    if (!matches.length) {
      throw new GovernanceError(
        expectedParentCategory
          ? `Parent shortcode ${parentShortcode} was not found in category ${expectedParentCategory}`
          : `Parent shortcode ${parentShortcode} was not found`,
      );
    }
    if (matches.length > 1) {
      throw new GovernanceError(
        `Parent shortcode ${parentShortcode} is ambiguous; supply parentStableKey or parentId`,
        409,
      );
    }
    parentId = matches[0].id;
  }
  if (parentId) await assertTermInVersion(tx, parentId, versionId, "parentId");
  const legacyCodes = Array.isArray(payload.legacyCodes)
    ? payload.legacyCodes.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : [];
  const category = payload.category.trim();
  await assertTaxonomyHierarchy(tx, versionId, category, parentId);
  let existingStableTerm: typeof taxonomyTerms.$inferSelect | null = null;
  if (stableKey) {
    const matches = await tx.select().from(taxonomyTerms).where(and(
      eq(taxonomyTerms.versionId, versionId),
      eq(taxonomyTerms.stableKey, stableKey),
    ));
    existingStableTerm = matches[0] ?? null;
    if (existingStableTerm && existingStableTerm.category !== category) {
      throw new GovernanceError("A stableKey cannot change taxonomy category", 409);
    }
    if (existingStableTerm && existingStableTerm.parentId !== parentId) {
      throw new GovernanceError("A stableKey cannot change taxonomy parent", 409);
    }
    const scopedCollision = (await termsForVersion(tx, versionId)).find((term: any) =>
      term.id !== existingStableTerm?.id
      && term.category === category
      && term.parentId === parentId
      && term.shortcode === shortcode);
    if (scopedCollision) throw new GovernanceError("Candidate shortcode already exists under this taxonomy parent", 409);
    await assertNamespaceAvailable(tx, versionId, legacyCodes, existingStableTerm?.id, candidateId);
  } else {
    await assertNamespaceAvailable(tx, versionId, [shortcode, ...legacyCodes], undefined, candidateId);
  }
  const supersededBy = payload.supersededBy === undefined || payload.supersededBy === null || payload.supersededBy === ""
    ? null
    : uuid(payload.supersededBy, "supersededBy");
  if (supersededBy) await assertTermInVersion(tx, supersededBy, versionId, "supersededBy");
  if (
    payload.sourceMetadata !== undefined
    && (!payload.sourceMetadata || typeof payload.sourceMetadata !== "object" || Array.isArray(payload.sourceMetadata))
  ) {
    throw new GovernanceError("Candidate sourceMetadata must be an object when supplied");
  }
  assertNoSourceMetadataEscalation(
    (payload as Record<string, unknown>).sourceMetadata,
    "payload.sourceMetadata",
  );
  return {
    category,
    label: payload.label.trim(),
    shortcode,
    stableKey,
    parentId,
    supersededBy,
    legacyCodes: [...new Set(legacyCodes)],
    sourceMetadata: payload.sourceMetadata === undefined
      ? undefined
      : payload.sourceMetadata as Record<string, unknown>,
    existingStableTerm,
  };
}

export async function commitImportBatch(
  batchIdInput: unknown,
  input: { actor: unknown; reason: unknown },
) {
  const batchId = uuid(batchIdInput, "batchId");
  const actor = validateActor(input.actor);
  const reason = validateReason(input.reason);
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(taxonomyImportBatches).where(eq(taxonomyImportBatches.id, batchId));
    if (!batch) throw new GovernanceError("Import batch not found", 404);
    await lockTaxonomyVersion(tx, batch.versionId);
    const candidates = await tx.select().from(taxonomyImportCandidates).where(eq(taxonomyImportCandidates.batchId, batchId));
    const committed = [];
    for (const candidate of candidates) {
      if (candidate.committedTermId) {
        committed.push(candidate.committedTermId);
        continue;
      }
      const businessReviewComplete = candidate.status === "staged"
        && candidate.reviewNote?.startsWith("BUSINESS_REVIEW_COMPLETE");
      if (!businessReviewComplete) continue;
      const validated = await validateImportPayload(tx, batch.versionId, candidate.payload, candidate.id);
      const beforeTerm = validated.existingStableTerm;
      let term: typeof taxonomyTerms.$inferSelect;
      let invalidatedApprovalCount = 0;
      if (beforeTerm) {
        const updateValues: Record<string, unknown> = {
          label: validated.label,
          shortcode: validated.shortcode,
          supersededBy: validated.supersededBy,
          legacyCodes: validated.legacyCodes,
          updatedAt: new Date(),
        };
        if (validated.sourceMetadata !== undefined) {
          updateValues.sourceMetadata = validated.sourceMetadata;
        }
        [term] = await tx
          .update(taxonomyTerms)
          .set(updateValues)
          .where(eq(taxonomyTerms.id, beforeTerm.id))
          .returning();
        const invalidatedApprovals = semanticTermChanged(beforeTerm, term)
          ? await tx.delete(approvals).where(and(
            inArray(approvals.recordType, ["taxonomyTerm", "taxonomy_term"]),
            eq(approvals.recordId, term.id),
          )).returning({ id: approvals.id })
          : [];
        invalidatedApprovalCount = invalidatedApprovals.length;
      } else {
        [term] = await tx
          .insert(taxonomyTerms)
          .values({
            versionId: batch.versionId,
            category: validated.category,
            label: validated.label,
            shortcode: validated.shortcode,
            stableKey: validated.stableKey,
            parentId: validated.parentId,
            supersededBy: validated.supersededBy,
            legacyCodes: validated.legacyCodes,
            sourceMetadata: validated.sourceMetadata ?? {},
          })
          .returning();
      }
      const [committedCandidate] = await tx
        .update(taxonomyImportCandidates)
        .set({ status: "committed", committedTermId: term.id, updatedAt: new Date() })
        .where(eq(taxonomyImportCandidates.id, candidate.id))
        .returning();
      await insertAudit(tx, {
        entityType: "importCandidate",
        entityId: candidate.id,
        action: "commit",
        actor,
        reason,
        before: candidate,
        after: committedCandidate,
        metadata: { batchId, committedTermId: term.id },
      });
      await insertAudit(tx, {
        entityType: "taxonomyTerm",
        entityId: term.id,
        action: beforeTerm ? "import_update" : "import_commit",
        actor,
        reason,
        before: beforeTerm ? termResponse(beforeTerm) : null,
        after: termResponse(term),
        metadata: {
          batchId,
          candidateId: candidate.id,
          sourceKey: candidate.sourceKey,
          invalidatedApprovalCount,
        },
      });
      committed.push(term.id);
    }
    const afterCandidates = await tx.select().from(taxonomyImportCandidates).where(eq(taxonomyImportCandidates.batchId, batchId));
    const allDone = afterCandidates.every((candidate: any) => candidate.status === "committed" || candidate.status === "rejected");
    const [updatedBatch] = await tx
      .update(taxonomyImportBatches)
      .set({ status: allDone ? "committed" : "partially_committed", updatedAt: new Date() })
      .where(eq(taxonomyImportBatches.id, batchId))
      .returning();
    await insertAudit(tx, {
      entityType: "importBatch",
      entityId: batchId,
      action: "commit",
      actor,
      reason,
      before: batch,
      after: updatedBatch,
      metadata: { committedCandidateCount: committed.length },
    });
    return { batch: updatedBatch, candidates: afterCandidates, committedTermIds: committed };
  });
}

async function recordExists(tx: Executor, recordType: GovernanceRecordType, recordId: string) {
  let rows: any[] = [];
  switch (recordType) {
    case "campaign": rows = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, recordId)); break;
    case "activity": rows = await tx.select({ id: activities.id }).from(activities).where(eq(activities.id, recordId)); break;
    case "communication": rows = await tx.select({ id: communications.id }).from(communications).where(eq(communications.id, recordId)); break;
    case "asset": rows = await tx.select({ id: assets.id }).from(assets).where(eq(assets.id, recordId)); break;
    case "landingPage": rows = await tx.select({ id: landingPages.id }).from(landingPages).where(eq(landingPages.id, recordId)); break;
    case "kpi": rows = await tx.select({ id: kpis.id }).from(kpis).where(eq(kpis.id, recordId)); break;
    case "budget": rows = await tx.select({ id: budgets.id }).from(budgets).where(eq(budgets.id, recordId)); break;
    case "conflict": rows = await tx.select({ id: conflicts.id }).from(conflicts).where(eq(conflicts.id, recordId)); break;
    case "taxonomyTerm": rows = await tx.select({ id: taxonomyTerms.id }).from(taxonomyTerms).where(eq(taxonomyTerms.id, recordId)); break;
    case "taxonomyVersion": rows = await tx.select({ id: taxonomyVersions.id }).from(taxonomyVersions).where(eq(taxonomyVersions.id, recordId)); break;
    case "importBatch": rows = await tx.select({ id: taxonomyImportBatches.id }).from(taxonomyImportBatches).where(eq(taxonomyImportBatches.id, recordId)); break;
    case "importCandidate": rows = await tx.select({ id: taxonomyImportCandidates.id }).from(taxonomyImportCandidates).where(eq(taxonomyImportCandidates.id, recordId)); break;
  }
  return rows.length > 0;
}

export async function assertRecordTarget(
  tx: Executor,
  recordTypeInput: unknown,
  recordIdInput: unknown,
) {
  const recordType = normalizeRecordType(recordTypeInput);
  const recordId = uuid(recordIdInput, "recordId");
  if (!(await recordExists(tx, recordType, recordId))) throw new GovernanceError("Target record was not found", 404);
  return { recordType, recordId };
}

export async function listApprovals(input: { recordType?: unknown; recordId?: unknown }) {
  if (input.recordType === undefined && input.recordId === undefined) {
    const rows = await db.select().from(approvals).orderBy(desc(approvals.createdAt));
    return rows.map((row) => ["campaign", "activity", "taxonomyTerm", "taxonomy_term", "taxonomyVersion", "taxonomy_version"]
      .includes(row.recordType) ? quarantineApprovalResponse(row) : row);
  }
  const target = await assertRecordTarget(db, input.recordType, input.recordId);
  const rows = await db.select().from(approvals)
    .where(and(eq(approvals.recordType, target.recordType), eq(approvals.recordId, target.recordId)))
    .orderBy(desc(approvals.createdAt));
  return ["campaign", "activity", "taxonomyTerm", "taxonomyVersion"].includes(target.recordType)
    ? rows.map(quarantineApprovalResponse)
    : rows;
}

export async function createApproval(input: {
  actor: unknown;
  reason: unknown;
  recordType: unknown;
  recordId: unknown;
  stage: unknown;
  status: unknown;
  approver: unknown;
}) {
  const actor = validateActor(input.actor);
  const reason = validateReason(input.reason);
  if (typeof input.stage !== "string" || !input.stage.trim()) throw new GovernanceError("stage is required");
  if (typeof input.status !== "string" || !input.status.trim()) throw new GovernanceError("status is required");
  if (typeof input.approver !== "string" || !input.approver.trim()) throw new GovernanceError("approver is required");
  const stage = input.stage.trim();
  const status = input.status.trim();
  const approver = input.approver.trim();
  return db.transaction(async (tx) => {
    const target = await assertRecordTarget(tx, input.recordType, input.recordId);
    if (
      ["campaign", "activity", "taxonomyTerm", "taxonomyVersion"].includes(target.recordType)
      && ["approved", "final", "official"].includes(status.toLowerCase())
    ) {
      throw new GovernanceQuarantineError("status");
    }
    const [created] = await tx.insert(approvals).values({
      recordType: target.recordType,
      recordId: target.recordId,
      stage,
      status,
      approver,
      campaignId: target.recordType === "campaign" ? target.recordId : null,
    }).returning();
    await insertAudit(tx, { entityType: "approval", entityId: created.id, action: "create", actor, reason, before: null, after: created });
    return created;
  });
}

export async function updateApproval(
  approvalIdInput: unknown,
  input: { actor: unknown; reason: unknown; stage?: unknown; status?: unknown; approver?: unknown },
) {
  const approvalId = uuid(approvalIdInput, "approvalId");
  const actor = validateActor(input.actor);
  const reason = validateReason(input.reason);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(approvals).where(eq(approvals.id, approvalId));
    if (!current) throw new GovernanceError("Approval not found", 404);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const field of ["stage", "status", "approver"] as const) {
      if (input[field] !== undefined) {
        if (typeof input[field] !== "string" || !input[field].trim()) throw new GovernanceError(`${field} must be non-empty`);
        patch[field] = input[field].trim();
      }
    }
    const nextStatus = typeof patch.status === "string" ? patch.status : current.status;
    const recordType = normalizeRecordType(current.recordType);
    if (
      ["campaign", "activity", "taxonomyTerm", "taxonomyVersion"].includes(recordType)
      && ["approved", "final", "official"].includes(nextStatus.toLowerCase())
    ) {
      throw new GovernanceQuarantineError("status");
    }
    const [updated] = await tx.update(approvals).set(patch as any).where(eq(approvals.id, approvalId)).returning();
    await insertAudit(tx, { entityType: "approval", entityId: approvalId, action: "update", actor, reason, before: current, after: updated });
    return updated;
  });
}

export async function listComments(input: { recordType: unknown; recordId: unknown }) {
  const target = await assertRecordTarget(db, input.recordType, input.recordId);
  return db.select().from(comments).where(and(eq(comments.recordType, target.recordType), eq(comments.recordId, target.recordId))).orderBy(comments.createdAt);
}

export async function createComment(input: {
  actor: unknown;
  reason: unknown;
  recordType: unknown;
  recordId: unknown;
  body: unknown;
}) {
  const actor = validateActor(input.actor);
  const reason = validateReason(input.reason);
  if (typeof input.body !== "string" || !input.body.trim()) throw new GovernanceError("body is required");
  const commentBody = input.body.trim();
  return db.transaction(async (tx) => {
    const target = await assertRecordTarget(tx, input.recordType, input.recordId);
    const [created] = await tx.insert(comments).values({
      recordType: target.recordType,
      recordId: target.recordId,
      body: commentBody,
      actor,
    }).returning();
    await insertAudit(tx, { entityType: "comment", entityId: created.id, action: "create", actor, reason, before: null, after: created });
    return created;
  });
}

export async function updateComment(
  commentIdInput: unknown,
  input: { actor: unknown; reason: unknown; body: unknown },
) {
  const commentId = uuid(commentIdInput, "commentId");
  const actor = validateActor(input.actor);
  const reason = validateReason(input.reason);
  if (typeof input.body !== "string" || !input.body.trim()) throw new GovernanceError("body is required");
  const commentBody = input.body.trim();
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(comments).where(eq(comments.id, commentId));
    if (!current) throw new GovernanceError("Comment not found", 404);
    const [updated] = await tx.update(comments).set({ body: commentBody, updatedAt: new Date() }).where(eq(comments.id, commentId)).returning();
    await insertAudit(tx, { entityType: "comment", entityId: commentId, action: "update", actor, reason, before: current, after: updated });
    return updated;
  });
}
