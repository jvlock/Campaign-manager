import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { pagination, pageHeaders } from "../lib/pagination";
import { createHash } from "node:crypto";
import { simulateWebinarOccurrence } from "../lib/webinar-evaluation-orchestration";
import { PersistenceConflict } from "../lib/webinar-persistence";
import { STANDARD_ID, STANDARD_VERSION } from "../lib/webinar-standard-catalog/types";

const router = Router();
const uuid = z.string().uuid();
const attribution = { unverified: true, authoritative: false };

router.get("/development/groups", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const page = pagination(req.query);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const groups = await client.query(`SELECT id,name,kind,parent_id AS "parentId",accountable_owner_id AS "accountableOwnerId" FROM organization_units WHERE status='active' ORDER BY id LIMIT $1 OFFSET $2`, [page.limit, page.offset]);
    const profiles = await client.query("SELECT id,name FROM users ORDER BY id LIMIT $1 OFFSET $2", [page.limit, page.offset]);
    const totals = await client.query("SELECT (SELECT count(*)::int FROM organization_units WHERE status='active') AS groups,(SELECT count(*)::int FROM users) AS profiles");
    await client.query("COMMIT");
    pageHeaders(res, page, [totals.rows[0].groups, totals.rows[0].profiles], groups.rows.length + profiles.rows.length);
    res.json({ groups: groups.rows, profiles: profiles.rows, ...attribution });
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});
router.post("/development/groups", async (req, res, next) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(["team", "group"]), parentId: uuid.optional(), accountableOwnerId: uuid.optional() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid development group", issues: parsed.error.issues }); return; }
  const { name, kind, parentId, accountableOwnerId } = parsed.data;
  try {
    if (kind === "group" && !parentId || kind === "team" && parentId) { res.status(400).json({ error: "A group requires a parent team; a team cannot have a parent." }); return; }
    const result = await pool.query(`INSERT INTO organization_units(name,kind,parent_id,accountable_owner_id)
      VALUES($1,$2,$3,COALESCE($4,(SELECT accountable_owner_id FROM development_planning_environment)))
      RETURNING id,name,kind,parent_id AS "parentId",accountable_owner_id AS "accountableOwnerId"`, [name, kind, parentId ?? null, accountableOwnerId ?? null]);
    res.status(201).json({ ...result.rows[0], ...attribution });
  } catch (error) { next(error); }
});
router.get("/development/ownership/:type/:id", async (req, res, next) => {
  if (!["campaigns", "activities"].includes(req.params.type) || !uuid.safeParse(req.params.id).success) { res.status(400).json({ error: "Invalid resource" }); return; }
  const campaign = req.params.type === "campaigns";
  try {
    const result = await pool.query(`SELECT ${campaign ? "campaign_id" : "activity_id"} AS id,group_id AS "groupId",accountable_owner_id AS "accountableOwnerId",created_by AS "createdBy",row_version AS "rowVersion" FROM ${campaign ? "campaign_ownership" : "activity_ownership"} WHERE ${campaign ? "campaign_id" : "activity_id"}=$1`, [req.params.id]);
    if (!result.rowCount) { res.status(404).json({ error: "Ownership not found" }); return; }
    res.json({ ownership: result.rows[0], ...attribution });
  } catch (error) { next(error); }
});
router.put("/development/ownership/:type/:id", async (req, res, next) => {
  if (req.body?.rowVersion === undefined) { res.status(428).json({ error: "rowVersion is required for ownership changes" }); return; }
  const parsed = z.object({ groupId: uuid, accountableOwnerId: uuid, rowVersion: z.number().int().positive() }).strict().safeParse(req.body);
  if (!parsed.success || !["campaigns", "activities"].includes(req.params.type) || !uuid.safeParse(req.params.id).success) { res.status(400).json({ error: "Invalid ownership" }); return; }
  const campaign = req.params.type === "campaigns";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = await client.query("SELECT id FROM organization_units WHERE id=$1 AND kind='group' AND status='active'", [parsed.data.groupId]);
    if (!group.rowCount) { await client.query("ROLLBACK"); res.status(400).json({ error: "Active development group required" }); return; }
    const owned = await client.query(`SELECT campaign_id,row_version FROM ${campaign ? "campaign_ownership" : "activity_ownership"} WHERE ${campaign ? "campaign_id" : "activity_id"}=$1 FOR UPDATE`, [req.params.id]);
    if (!owned.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "Ownership not found" }); return; }
    const retryKey = createHash("sha256").update(JSON.stringify([req.params.type, req.params.id, parsed.data.rowVersion, parsed.data.groupId, parsed.data.accountableOwnerId])).digest("hex");
    const replay = await client.query(`SELECT details->'response' AS response FROM organization_audit
      WHERE action='development_ownership_updated' AND ${campaign ? "campaign_id" : "activity_id"}=$1
      AND details->>'retryKey'=$2 ORDER BY id LIMIT 1`, [req.params.id, retryKey]);
    if (replay.rows.length) { await client.query("COMMIT"); res.json(replay.rows[0].response); return; }
    if (owned.rows[0].row_version !== parsed.data.rowVersion) { await client.query("ROLLBACK"); res.status(409).json({ error: "Ownership changed elsewhere. Reload before retrying.", rowVersion: owned.rows[0].row_version }); return; }
    await client.query(`INSERT INTO campaign_group_participation(campaign_id,group_id,created_by) SELECT $1,$2,creator_id FROM development_planning_environment ON CONFLICT DO NOTHING`, [owned.rows[0].campaign_id, parsed.data.groupId]);
    const result = await client.query(`UPDATE ${campaign ? "campaign_ownership" : "activity_ownership"} SET group_id=$2,accountable_owner_id=$3,row_version=row_version+1,updated_at=now() WHERE ${campaign ? "campaign_id" : "activity_id"}=$1 RETURNING group_id AS "groupId",accountable_owner_id AS "accountableOwnerId",created_by AS "createdBy",row_version AS "rowVersion"`, [req.params.id, parsed.data.groupId, parsed.data.accountableOwnerId]);
    const response = { ownership: result.rows[0], ...attribution };
    const audited = await client.query(`INSERT INTO organization_audit(actor_id,action,campaign_id,activity_id,unit_id,details)
      SELECT creator_id,'development_ownership_updated',$1,$2,$3,$4::jsonb FROM development_planning_environment`,
    [owned.rows[0].campaign_id, campaign ? null : req.params.id, parsed.data.groupId, JSON.stringify({ retryKey, response, unverified: true, authoritative: false, previousVersion: parsed.data.rowVersion })]);
    if (audited.rowCount !== 1) throw new Error("Development ownership requires an atomic unverified audit record");
    await client.query("COMMIT");
    res.json(response);
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});
router.get("/development/calendar", async (req, res, next) => {
  const parsed = z.object({ groupId: uuid.optional(), campaignId: uuid.optional(), after: uuid.optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).strict().safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid calendar pagination or filters" }); return; }
  const { groupId, campaignId, after, limit } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // Apply synthetic registry and scope restrictions before both counting and paging.
    const scope = `FROM activities a JOIN activity_ownership o ON o.activity_id=a.id
      JOIN development_record_registry r ON r.entity_type='activity' AND r.entity_id=a.id
      WHERE ($1::uuid IS NULL OR o.group_id=$1) AND ($2::uuid IS NULL OR a.campaign_id=$2)`;
    const count = await client.query(`SELECT count(*)::int AS total ${scope}`, [groupId ?? null, campaignId ?? null]);
    const entries = await client.query(`SELECT a.id,a.campaign_id AS "campaignId",a.name AS title,
      COALESCE((SELECT COALESCE(s.adjusted_at,s.calculated_at)::text FROM scheduled_instances s WHERE s.activity_id=a.id ORDER BY s.calculated_at,s.id LIMIT 1),a.timing) AS date,
      (SELECT s.timezone FROM scheduled_instances s WHERE s.activity_id=a.id ORDER BY s.calculated_at,s.id LIMIT 1) AS "timeZone",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'date',COALESCE(s.adjusted_at,s.calculated_at),'timeZone',s.timezone,'status',s.status) ORDER BY s.calculated_at,s.id) FROM scheduled_instances s WHERE s.activity_id=a.id),'[]'::jsonb) AS dates,
      a.status,o.group_id AS "groupId",o.accountable_owner_id AS "accountableOwnerId",true AS unverified
      ${scope} AND ($3::uuid IS NULL OR a.id>$3) ORDER BY a.id LIMIT $4`, [groupId ?? null, campaignId ?? null, after ?? null, limit + 1]);
    await client.query("COMMIT");
    const hasMore = entries.rows.length > limit;
    const rows = entries.rows.slice(0, limit);
    res.json({ entries: rows, total: count.rows[0].total, returned: rows.length, hasMore,
      nextCursor: hasMore ? rows[rows.length - 1].id : null, ...attribution });
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});
const simulationScope = z.object({ campaignId: uuid, activityId: uuid, occurrenceId: uuid }).strict();
const simulationRequest = z.object({
  campaignId: uuid.optional(), activityId: uuid.optional(), occurrenceId: uuid.optional(),
  calculationAt: z.string().datetime().refine(value => Number.isFinite(Date.parse(value))).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/).optional(),
  label: z.string().max(120).optional(),
}).strict();

router.get("/development/simulations/context", async (req, res, next) => {
  const parsed = simulationScope.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid campaign, activity and occurrence are required." }); return; }
  const { campaignId, activityId, occurrenceId } = parsed.data;
  try {
    const result = await pool.query(`SELECT b.revision,b.standard_id AS "standardId",b.standard_version AS "standardVersion",
      EXISTS(SELECT 1 FROM webinar_persistence_records r WHERE r.session_id=s.id AND r.campaign_id=s.campaign_id
        AND r.kind='plan' AND r.payload->>'simulationEligibility'='new-synthetic-occurrence') AS eligible
      FROM webinar_sessions s JOIN activities a ON a.id=s.activity_id AND a.campaign_id=s.campaign_id
      JOIN development_record_registry dr ON dr.entity_type='activity' AND dr.entity_id=a.id
      JOIN development_record_registry cr ON cr.entity_type='campaign' AND cr.entity_id=s.campaign_id
      LEFT JOIN webinar_persistence_bindings b ON b.session_id=s.id AND b.campaign_id=s.campaign_id
      WHERE s.id=$1 AND s.activity_id=$2 AND s.campaign_id=$3 AND a.activity_type_id='webinar'
      AND NOT EXISTS(SELECT 1 FROM legacy_activities l WHERE l.activity_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM legacy_campaigns l WHERE l.campaign_id=s.campaign_id)`, [occurrenceId, activityId, campaignId]);
    if (!result.rowCount) { res.status(404).json({ error: "Synthetic webinar occurrence not found in selected campaign and activity." }); return; }
    const row = result.rows[0];
    if (!row.eligible || row.standardId !== STANDARD_ID || row.standardVersion !== STANDARD_VERSION || row.revision == null) {
      res.status(409).json({ error: "Occurrence has no explicit new-synthetic exact-standard simulation binding; historical templates are not converted." }); return;
    }
    res.json({ expectedRevision: row.revision, standard: { id: row.standardId, version: row.standardVersion },
      operationalStatus: "simulation-only", ...attribution });
  } catch (error) { next(error); }
});

router.post("/development/simulations", async (req, res, next) => {
  const parsed = simulationRequest.safeParse(req.body);
  if (!parsed.success || (parsed.data?.activityId && !parsed.data.campaignId) || (parsed.data?.occurrenceId && !parsed.data.activityId)) {
    res.status(400).json({ error: "Invalid simulation request: an activity requires a campaign, and an occurrence requires an activity." }); return;
  }
  const { campaignId, activityId, occurrenceId } = parsed.data;
  const { calculationAt, idempotencyKey, expectedRevision } = parsed.data;
  if (occurrenceId && (!calculationAt || !idempotencyKey || expectedRevision === undefined)
    || !occurrenceId && (calculationAt !== undefined || idempotencyKey !== undefined || expectedRevision !== undefined)) {
    res.status(400).json({ error: "Webinar simulations require one fixed calculationAt, idempotencyKey and expectedRevision tuple; generic previews do not accept it." }); return;
  }
  try {
    if (activityId) {
      const activity = await pool.query(`SELECT a.activity_type_id AS "activityTypeId" FROM activities a
        JOIN development_record_registry r ON r.entity_type='activity' AND r.entity_id=a.id
        JOIN development_record_registry cr ON cr.entity_type='campaign' AND cr.entity_id=a.campaign_id
        WHERE a.id=$1 AND a.campaign_id=$2`, [activityId, campaignId]);
      if (!activity.rowCount) { res.status(404).json({ error: "Development activity not found in selected campaign" }); return; }
      if (activity.rows[0].activityTypeId === "webinar") {
        if (!occurrenceId) { res.status(400).json({ error: "Select a webinar occurrence before running the development simulation." }); return; }
        const session = await pool.query(`SELECT s.id FROM webinar_sessions s
          WHERE s.id=$1 AND s.campaign_id=$2 AND s.activity_id=$3
          AND NOT EXISTS (SELECT 1 FROM legacy_activities l WHERE l.activity_id=s.activity_id)`, [occurrenceId, campaignId, activityId]);
        if (!session.rowCount) { res.status(404).json({ error: "Webinar occurrence not found in selected campaign and activity, or belongs to a legacy activity." }); return; }
        const context = await pool.query(`SELECT e.creator_id AS "actorId",b.revision AS "currentRevision"
          FROM development_planning_environment e
          LEFT JOIN webinar_persistence_bindings b ON b.session_id=$1 AND b.campaign_id=$2
          WHERE e.id=true`, [occurrenceId, campaignId]);
        if (!context.rowCount) { res.status(503).json({ error: "Development actor marker is unavailable; simulation cannot be recorded." }); return; }
        if (context.rows[0].currentRevision == null) {
          res.status(409).json({ error: "Occurrence has no explicit new-synthetic exact-standard simulation binding. Neither template version establishes eligibility; existing occurrences are not converted." }); return;
        }
        const result = await simulateWebinarOccurrence({
          campaignId: campaignId!, sessionId: occurrenceId, actorId: context.rows[0].actorId,
          calculationAt: calculationAt!, expectedRevision: expectedRevision!, idempotencyKey: idempotencyKey!,
        });
        res.json({ ...result, simulation: true, ...attribution, operationalReadiness: false });
        return;
      }
      if (occurrenceId) { res.status(400).json({ error: "An occurrence can only be selected for a webinar activity." }); return; }
    }
    res.json({ simulation: true, ...attribution, operationalReadiness: false,
      message: "Generic unverified planning preview only; the webinar standards engine was not run. No approval, evidence, delivery or integration action was created." });
  } catch (error) {
    if (error instanceof PersistenceConflict) {
      const current = occurrenceId && campaignId
        ? await pool.query("SELECT revision FROM webinar_persistence_bindings WHERE session_id=$1 AND campaign_id=$2", [occurrenceId, campaignId])
        : null;
      res.status(409).json({ error: error.message, code: error.code,
        expectedRevision, currentRevision: current?.rows[0]?.revision ?? null }); return;
    }
    next(error);
  }
});
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  if ((error as { status?: number }).status === 400) { res.status(400).json({ error: (error as Error).message }); return; }
  const code = (error as { code?: string }).code;
  res.status(code?.startsWith("23") ? 409 : 503).json({ error: { code: "development_operation_failed", message: "Planning operation failed validation or database integrity checks." } });
});
export default router;