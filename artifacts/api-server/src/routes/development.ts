import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";

const router = Router();
const uuid = z.string().uuid();
const attribution = { unverified: true, authoritative: false };

router.get("/development/groups", async (_req, res, next) => {
  try {
    const groups = await pool.query(`SELECT id,name,kind,parent_id AS "parentId",accountable_owner_id AS "accountableOwnerId" FROM organization_units WHERE status='active' ORDER BY kind DESC,name,id`);
    const profiles = await pool.query("SELECT id,name FROM users ORDER BY name,id");
    res.json({ groups: groups.rows, profiles: profiles.rows, ...attribution });
  } catch (error) { next(error); }
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
  const parsed = z.object({ groupId: uuid, accountableOwnerId: uuid }).strict().safeParse(req.body);
  if (!parsed.success || !["campaigns", "activities"].includes(req.params.type) || !uuid.safeParse(req.params.id).success) { res.status(400).json({ error: "Invalid ownership" }); return; }
  const campaign = req.params.type === "campaigns";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = await client.query("SELECT id FROM organization_units WHERE id=$1 AND kind='group' AND status='active'", [parsed.data.groupId]);
    if (!group.rowCount) { await client.query("ROLLBACK"); res.status(400).json({ error: "Active development group required" }); return; }
    const owned = await client.query(`SELECT campaign_id FROM ${campaign ? "campaign_ownership" : "activity_ownership"} WHERE ${campaign ? "campaign_id" : "activity_id"}=$1 FOR UPDATE`, [req.params.id]);
    if (!owned.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "Ownership not found" }); return; }
    await client.query(`INSERT INTO campaign_group_participation(campaign_id,group_id,created_by) SELECT $1,$2,creator_id FROM development_planning_environment ON CONFLICT DO NOTHING`, [owned.rows[0].campaign_id, parsed.data.groupId]);
    const result = await client.query(`UPDATE ${campaign ? "campaign_ownership" : "activity_ownership"} SET group_id=$2,accountable_owner_id=$3,row_version=row_version+1,updated_at=now() WHERE ${campaign ? "campaign_id" : "activity_id"}=$1 RETURNING group_id AS "groupId",accountable_owner_id AS "accountableOwnerId",created_by AS "createdBy",row_version AS "rowVersion"`, [req.params.id, parsed.data.groupId, parsed.data.accountableOwnerId]);
    await client.query("COMMIT");
    res.json({ ownership: result.rows[0], ...attribution });
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});
router.get("/development/calendar", async (req, res, next) => {
  if (req.query.groupId !== undefined && !uuid.safeParse(req.query.groupId).success) { res.status(400).json({ error: "Invalid groupId" }); return; }
  try {
    const entries = await pool.query(`SELECT a.id,a.campaign_id AS "campaignId",a.name AS title,
      COALESCE((SELECT COALESCE(s.adjusted_at,s.calculated_at)::text FROM scheduled_instances s WHERE s.activity_id=a.id ORDER BY s.calculated_at,s.id LIMIT 1),a.timing) AS date,
      (SELECT s.timezone FROM scheduled_instances s WHERE s.activity_id=a.id ORDER BY s.calculated_at,s.id LIMIT 1) AS "timeZone",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'date',COALESCE(s.adjusted_at,s.calculated_at),'timeZone',s.timezone,'status',s.status) ORDER BY s.calculated_at,s.id) FROM scheduled_instances s WHERE s.activity_id=a.id),'[]'::jsonb) AS dates,
      a.status,o.group_id AS "groupId",o.accountable_owner_id AS "accountableOwnerId",true AS unverified
      FROM activities a JOIN activity_ownership o ON o.activity_id=a.id
      WHERE ($1::uuid IS NULL OR o.group_id=$1) ORDER BY a.timing,a.id`, [req.query.groupId ?? null]);
    res.json({ entries: entries.rows, ...attribution });
  } catch (error) { next(error); }
});
router.post("/development/simulations", (req, res) => {
  const parsed = z.object({ campaignId: uuid.optional(), activityId: uuid.optional(), label: z.string().max(120).optional() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid simulation request" }); return; }
  res.json({ simulation: true, ...attribution, operationalReadiness: false, message: "Unverified development dry-run only. No approval, evidence, delivery or integration action was created." });
});
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  const code = (error as { code?: string }).code;
  res.status(code?.startsWith("23") ? 409 : 503).json({ error: { code: "development_operation_failed", message: "Planning operation failed validation or database integrity checks." } });
});
export default router;