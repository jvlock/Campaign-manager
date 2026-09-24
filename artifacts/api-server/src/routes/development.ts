import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { pagination, pageHeaders } from "../lib/pagination";
import { createHash } from "node:crypto";

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
router.post("/development/simulations", (req, res) => {
  const parsed = z.object({ campaignId: uuid.optional(), activityId: uuid.optional(), label: z.string().max(120).optional() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid simulation request" }); return; }
  res.json({ simulation: true, ...attribution, operationalReadiness: false, message: "Unverified development dry-run only. No approval, evidence, delivery or integration action was created." });
});
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  if ((error as { status?: number }).status === 400) { res.status(400).json({ error: (error as Error).message }); return; }
  const code = (error as { code?: string }).code;
  res.status(code?.startsWith("23") ? 409 : 503).json({ error: { code: "development_operation_failed", message: "Planning operation failed validation or database integrity checks." } });
});
export default router;