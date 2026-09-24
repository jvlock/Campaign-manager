import { createHash } from "node:crypto";
import { z } from "zod";
import { pool, assertPlanningDatabaseIsolation, planningAccessMode } from "@workspace/db";
import { captureWebinarRelease } from "./webinar-release-provenance";
import { simulationSnapshotSchema } from "./webinar-simulation-snapshot";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
// Opaque identifiers only: no URLs, free-form commentary, email, content or participant copies.
const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
const exactVersion = z.string().regex(/^\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9.-]+)?$/);
const uuid = z.string().uuid();
const acquireClient = () => pool.connect();
export type WebinarTransactionClient = Awaited<ReturnType<typeof acquireClient>>;
const reference = z.object({
  kind: z.literal("source"), sourceSystem: token, sourceType: z.enum(["occurrence", "content", "foundation", "delivery", "measurement"]),
  sourceId: uuid, sourceVersion: token, sourceHash: hash,
  observedAt: z.string().datetime(), status: z.enum(["available", "missing", "expired"]),
}).strict();
export const persistencePayload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), state: z.enum(["draft", "planned", "superseded"]), planFingerprint: hash,
    eventStatus: z.enum(["draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled"]).optional(),
    simulationEligibility: z.literal("new-synthetic-occurrence").optional(),
  }).strict(),
  reference,
  z.object({ kind: z.literal("evidence"), evidenceType: z.enum(["qa", "manual-review", "source-observation"]), contentFingerprint: hash, result: z.enum(["pass", "fail", "unknown"]) }).strict(),
  z.object({ kind: z.literal("exception-request"), ruleId: token, findingFingerprint: hash, reasonCode: token }).strict(),
  z.object({ kind: z.literal("exception-disposition"), disposition: z.enum(["approved", "denied"]), reasonCode: token }).strict(),
  z.object({ kind: z.literal("readiness"), stage: z.enum(["setup", "recruitment", "follow-up", "completion"]), result: z.enum(["ready", "not-ready", "unknown"]), resultFingerprint: hash, evidenceIds: z.array(uuid).max(500), exceptionIds: z.array(uuid).max(500), simulation: simulationSnapshotSchema.optional() }).strict(),
  z.object({ kind: z.literal("completion"), result: z.enum(["complete", "incomplete", "unknown"]), resultFingerprint: hash, evidenceIds: z.array(uuid).max(500), exceptionIds: z.array(uuid).max(500), simulation: simulationSnapshotSchema.optional() }).strict(),
  // The server captures every release field. Supplied digests/manifests are rejected.
  z.object({ kind: z.literal("release") }).strict(),
  z.object({ kind: z.literal("legal-hold"), held: z.boolean(), reasonCode: token }).strict(),
]);
const mutation = z.object({
  campaignId: uuid, sessionId: uuid, actorId: uuid,
  expectedRevision: z.number().int().nonnegative(), idempotencyKey: token,
  standard: z.object({ id: token, version: exactVersion }).strict().nullable(),
  // Source-input identity for deduplication, NOT the server-generated release digest.
  calculationAt: z.string().datetime(), inputFingerprint: hash,
  parentId: uuid.optional(), releaseId: uuid.optional(),
  operational: z.literal(false), payload: persistencePayload,
}).strict();
export type PersistenceMutation = z.infer<typeof mutation>;
export type RetentionPolicy = { decisionMonths: number; provenanceMonths: number; auditMonths: number; recomputableMonths: number };
export const baselineRetention: RetentionPolicy = { decisionMonths: 84, provenanceMonths: 84, auditMonths: 84, recomputableMonths: 24 };
export function retentionExpiration(category: "decision" | "provenance" | "audit" | "recomputable", recordedAt: Date, policy: RetentionPolicy = baselineRetention): Date {
  const key = `${category}Months` as keyof RetentionPolicy;
  if (!Number.isInteger(policy[key]) || policy[key] < baselineRetention[key]) throw new Error("Retention cannot shorten the accepted baseline");
  const expires = new Date(recordedAt);
  // Clamp month-end rather than overflowing (e.g. leap day + seven years).
  const day = expires.getUTCDate();
  expires.setUTCDate(1);
  expires.setUTCMonth(expires.getUTCMonth() + policy[key]);
  const lastDay = new Date(Date.UTC(expires.getUTCFullYear(), expires.getUTCMonth() + 1, 0)).getUTCDate();
  expires.setUTCDate(Math.min(day, lastDay));
  return expires;
}
export class PersistenceConflict extends Error {
  readonly code = "webinar_persistence_conflict";
  readonly status = 409;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

/**
 * Internal simulation-only repository. No routes or authoritative-action escape hatch.
 * Future verified authentication and domain adapters must use a separately reviewed boundary.
 */
export class WebinarPersistence {
  private transactionClient?: WebinarTransactionClient;
  constructor(private readonly connection = pool, private readonly retention = baselineRetention) {}

  /**
   * One internal occurrence transaction, with an occurrence lock shared with ordinary
   * appends. The callback may only append immutable records; application sources
   * remain authoritative. The orchestrator owns mapping, never this repository.
   */
  async withEvaluationTransaction<T>(
    scope: { campaignId: string; sessionId: string },
    work: (client: WebinarTransactionClient, repository: WebinarPersistence) => Promise<T>,
  ): Promise<T> {
    uuid.parse(scope.campaignId); uuid.parse(scope.sessionId);
    await this.assertSimulationBoundary();
    const client = await this.connection.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`webinar-simulation:${scope.sessionId}`]);
      await client.query("SELECT session_id FROM webinar_persistence_bindings WHERE session_id=$1 AND campaign_id=$2 FOR UPDATE", [scope.sessionId, scope.campaignId]);
      const scoped = new WebinarPersistence(this.connection, this.retention);
      scoped.transactionClient = client;
      const result = await work(client, scoped);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (["40001", "40P01"].includes((error as { code?: string }).code ?? "")) throw new PersistenceConflict("Source records changed during simulation; reload before retrying");
      throw error;
    } finally { client.release(); }
  }

  /** Internal atomic creation boundary; caller owns BEGIN/COMMIT/ROLLBACK. */
  async appendInCreationTransaction(client: WebinarTransactionClient, input: PersistenceMutation) {
    await this.assertSimulationBoundary();
    const scoped = new WebinarPersistence(this.connection, this.retention);
    scoped.transactionClient = client;
    return scoped.append(input);
  }

  private async assertSimulationBoundary() {
    if (process.env.NODE_ENV === "test" && !process.env.REPLIT_DEPLOYMENT) {
      // Test escape is restricted to the existing private disposable socket harness, never DATABASE_URL alone.
      const { rows: [r] } = await this.connection.query(`SELECT inet_server_addr() IS NULL AS socket,
        current_setting('data_directory') AS directory, current_setting('listen_addresses') AS listeners`);
      if (r.socket && r.listeners === "" && /^\/tmp\/disposable-pg-[^/]+\/data$/.test(r.directory)) return;
      throw new Error("Simulation tests require a private disposable database");
    }
    if (planningAccessMode !== "open-development") throw new Error("Unverified authoritative storage actions are disabled");
    // An alternate pool is only supported by the private test harness.
    if (this.connection !== pool) throw new Error("Development storage requires the verified planning pool");
    await assertPlanningDatabaseIsolation();
  }

  async append(input: PersistenceMutation) {
    const m = mutation.parse(input);
    await this.assertSimulationBoundary();
    const requestHash = createHash("sha256").update(canonical(m)).digest("hex");
    const client = this.transactionClient ?? await this.connection.connect();
    try {
      if (!this.transactionClient) await client.query("BEGIN");
      const legacy = await client.query(`SELECT 1 FROM webinar_sessions s JOIN legacy_activities l ON l.activity_id=s.activity_id
        WHERE s.id=$1 AND s.campaign_id=$2`, [m.sessionId, m.campaignId]);
      if (legacy.rowCount) throw new Error("Legacy activity sessions are isolated from new-standard persistence");
      await client.query(`INSERT INTO webinar_persistence_bindings(session_id,campaign_id,standard_id,standard_version)
        VALUES ($1,$2,$3,$4) ON CONFLICT (session_id) DO NOTHING`, [m.sessionId, m.campaignId, m.standard?.id ?? null, m.standard?.version ?? null]);
      const { rows: [binding] } = await client.query("SELECT * FROM webinar_persistence_bindings WHERE session_id=$1 AND campaign_id=$2 FOR UPDATE", [m.sessionId, m.campaignId]);
      if (!binding) throw new PersistenceConflict("Occurrence is outside the requested campaign");
      const { rows: [retry] } = await client.query("SELECT * FROM webinar_persistence_records WHERE session_id=$1 AND idempotency_key=$2", [m.sessionId, m.idempotencyKey]);
      if (retry) {
        if (retry.request_hash !== requestHash) throw new PersistenceConflict("Idempotency key was used for different input");
        if (!this.transactionClient) await client.query("COMMIT");
        return retry;
      }
      if (binding.revision !== m.expectedRevision) throw new PersistenceConflict("Occurrence revision changed; reload before editing");
      if (binding.standard_id !== (m.standard?.id ?? null) || binding.standard_version !== (m.standard?.version ?? null)) throw new PersistenceConflict("Exact standard binding is immutable");
      const parentTypes: Record<string, string[]> = {
        evidence: ["source"], "exception-request": ["evidence"], "exception-disposition": ["exception-request"],
        "legal-hold": ["plan", "source", "evidence", "exception-request", "exception-disposition", "readiness", "completion", "release"],
      };
      if (parentTypes[m.payload.kind] && !m.parentId) throw new Error("Typed parent reference is required");
      if (!parentTypes[m.payload.kind] && m.parentId) throw new Error("Unexpected parent reference");
      if (m.parentId) {
        const { rows: [parent] } = await client.query("SELECT * FROM webinar_persistence_records WHERE id=$1 AND session_id=$2 AND campaign_id=$3", [m.parentId, m.sessionId, m.campaignId]);
        if (!parent || !parentTypes[m.payload.kind]?.includes(parent.kind)) throw new Error("Invalid or cross-occurrence parent reference");
        if (m.payload.kind === "exception-disposition" && parent.actor_id === m.actorId) throw new Error("Self-approval or self-disposition is prohibited, including simulations");
        if (m.payload.kind === "exception-disposition") {
          const existing = await client.query("SELECT 1 FROM webinar_persistence_records WHERE parent_id=$1 AND kind='exception-disposition'", [m.parentId]);
          if (existing.rowCount) throw new PersistenceConflict("Request already has an immutable disposition");
        }
      }
      if (["release", "readiness", "completion"].includes(m.payload.kind) && !m.standard) throw new Error("Exact standard binding is required");
      if (["readiness", "completion"].includes(m.payload.kind) && !m.releaseId) throw new Error("Snapshot release is required");
      if (m.releaseId && !["readiness", "completion"].includes(m.payload.kind)) throw new Error("Only snapshots may reference a release");
      if (m.payload.kind === "readiness" || m.payload.kind === "completion") {
        if (m.payload.simulation) {
          const snapshot = m.payload.simulation;
          if (snapshot.occurrenceId !== m.sessionId || snapshot.standard.id !== m.standard?.id
            || snapshot.standard.version !== m.standard?.version || snapshot.calculationAt !== m.calculationAt
            || snapshot.inputFingerprint !== m.inputFingerprint
            || createHash("sha256").update(canonical(snapshot)).digest("hex") !== m.payload.resultFingerprint) {
            throw new Error("Simulation snapshot identity or content fingerprint mismatch");
          }
        }
        for (const [ids, kind] of [[m.payload.evidenceIds, "evidence"], [m.payload.exceptionIds, "exception-disposition"]] as const) {
          if (new Set(ids).size !== ids.length) throw new Error("Duplicate snapshot reference");
          const refs = await client.query("SELECT id FROM webinar_persistence_records WHERE id=ANY($1::uuid[]) AND campaign_id=$2 AND session_id=$3 AND kind=$4", [ids, m.campaignId, m.sessionId, kind]);
          if (refs.rowCount !== ids.length) throw new Error("Invalid snapshot reference scope or type");
        }
      }
      if (m.releaseId) {
        const { rows: [release] } = await client.query("SELECT * FROM webinar_persistence_records WHERE id=$1 AND session_id=$2 AND campaign_id=$3 AND kind='release'", [m.releaseId, m.sessionId, m.campaignId]);
        if (!release || release.standard_id !== m.standard?.id || release.standard_version !== m.standard?.version || release.calculation_at.toISOString() !== m.calculationAt) throw new Error("Snapshot must use an exact release, standard and calculation instant");
        if ((m.payload.kind === "readiness" || m.payload.kind === "completion") && m.payload.simulation
          && m.payload.simulation.releaseFingerprint !== release.payload.digest) throw new Error("Simulation release fingerprint mismatch");
      }
      const category = m.payload.kind === "source" || m.payload.kind === "release" ? "provenance" : "decision";
      let storedPayload: unknown = m.payload;
      if (m.payload.kind === "release") {
        const release = await captureWebinarRelease(Date.parse(m.calculationAt));
        if (release.provenance.standardId !== m.standard?.id || release.provenance.standardVersion !== m.standard?.version) {
          throw new Error("Release must bind the server's actual canonical standard");
        }
        storedPayload = { kind: "release", ...release };
      }
      const now = new Date();
      const { rows: [record] } = await client.query(`INSERT INTO webinar_persistence_records
        (campaign_id,session_id,revision,kind,standard_id,standard_version,calculation_at,input_fingerprint,payload,
         parent_id,release_id,actor_id,idempotency_key,request_hash,retention_class,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [m.campaignId, m.sessionId, m.expectedRevision + 1, m.payload.kind, m.standard?.id ?? null, m.standard?.version ?? null,
        m.calculationAt, m.inputFingerprint, storedPayload, m.parentId ?? null, m.releaseId ?? null, m.actorId,
        m.idempotencyKey, requestHash, category, retentionExpiration(category, now, this.retention)]);
      await client.query(`INSERT INTO webinar_persistence_audit(record_id,campaign_id,session_id,actor_id,action,expires_at)
        VALUES ($1,$2,$3,$4,'simulation-recorded',$5)`, [record.id, m.campaignId, m.sessionId, m.actorId, retentionExpiration("audit", now, this.retention)]);
      await client.query("UPDATE webinar_persistence_bindings SET revision=revision+1 WHERE session_id=$1", [m.sessionId]);
      if (!this.transactionClient) await client.query("COMMIT");
      return record;
    } catch (error) {
      if (!this.transactionClient) await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") throw new PersistenceConflict("Duplicate immutable record");
      throw error;
    } finally { if (!this.transactionClient) client.release(); }
  }

  async load(campaignId: string, sessionId: string, afterRevision = 0, limit = 100) {
    uuid.parse(campaignId); uuid.parse(sessionId);
    z.number().int().nonnegative().parse(afterRevision); z.number().int().min(1).max(500).parse(limit);
    await this.assertSimulationBoundary();
    const result = await this.connection.query(`WITH scoped AS MATERIALIZED (
      SELECT * FROM webinar_persistence_records WHERE campaign_id=$1 AND session_id=$2
    ) SELECT page.*, totals.total_count FROM (SELECT count(*)::int AS total_count FROM scoped) totals
      LEFT JOIN LATERAL (SELECT *, count(*) OVER ()::int AS remaining_count FROM scoped
        WHERE revision>$3 ORDER BY revision LIMIT $4) page ON true
      ORDER BY page.revision`, [campaignId, sessionId, afterRevision, limit]);
    const records = result.rows.filter(row => row.id !== null);
    const remaining = result.rows[0]?.remaining_count ?? 0;
    return { records, totalCount: result.rows[0]?.total_count ?? 0, returnedCount: records.length, remainingCount: remaining,
      nextRevision: remaining > records.length ? records.at(-1)!.revision as number : null };
  }

  async retentionStatus(campaignId: string, sessionId: string, recordId: string, at = new Date()) {
    uuid.parse(campaignId); uuid.parse(sessionId); uuid.parse(recordId);
    await this.assertSimulationBoundary();
    const { rows: [r] } = await this.connection.query(`SELECT r.expires_at,
      COALESCE((SELECT (h.payload->>'held')::boolean FROM webinar_persistence_records h
        WHERE h.parent_id=r.id AND h.kind='legal-hold' ORDER BY h.revision DESC LIMIT 1),false) AS held
      FROM webinar_persistence_records r WHERE r.id=$1 AND r.session_id=$2 AND r.campaign_id=$3`, [recordId, sessionId, campaignId]);
    if (!r) throw new Error("Record not found in occurrence");
    const expired = r.expires_at <= at;
    return { legalHold: r.held as boolean, expired, effectiveExpired: expired && !r.held,
      deletionEnabled: false as const, deletionBlocked: true as const };
  }
}