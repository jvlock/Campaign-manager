import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { activities, activityTasks, activityTaskSettings, taskDefaults, ownerCapacities, db, communicationDetails } from "@workspace/db";
import { assertTimezone } from "../lib/planning";
import { capacityTotals, syncCapacityConflicts } from "../lib/implementation-tasks";
import { invalidateBlockedReleases } from "../lib/deliverables";

const router: IRouter = Router();
const scope = z.object({ id: z.string().uuid(), activityId: z.string().uuid() });
const settingsInput = z.object({
  gtmLaunchAt: z.string().datetime({ offset: true }).nullable().optional(),
  eventAt: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().refine(value => { try { assertTimezone(value); return true; } catch { return false; } }, "Invalid IANA timezone").optional(),
  tier: z.enum(["Gold", "Silver", "Bronze"]).nullable().optional(),
}).strict();
function settingsResponse(settings?: typeof activityTaskSettings.$inferSelect) {
  return {
    gtmLaunchAt: settings?.gtmLaunchAt ?? null,
    eventAt: settings?.eventAt ?? null,
    timezone: settings?.timezone ?? "UTC",
    tier: settings?.tier ?? null,
  };
}

router.route("/campaigns/:id/activities/:activityId/task-settings")
  .get(async (req, res, next) => {
    try {
      const parsed = scope.safeParse(req.params);
      if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
      const { id, activityId } = parsed.data;
      const [parent] = await db.select().from(activities).where(and(eq(activities.id, activityId), eq(activities.campaignId, id)));
      if (!parent) { res.status(404).json({ error: "Activity not found in campaign" }); return; }
      const [settings] = await db.select().from(activityTaskSettings).where(eq(activityTaskSettings.activityId, activityId));
      res.json(settingsResponse(settings));
    } catch (error) { next(error); }
  })
  .patch(async (req, res, next) => {
    try {
      const parsed = scope.safeParse(req.params);
      const input = settingsInput.safeParse(req.body);
      if (!parsed.success || !input.success) { res.status(400).json({ error: !input.success ? input.error.message : "Invalid path" }); return; }
      const { id, activityId } = parsed.data;
      const [parent] = await db.select().from(activities).where(and(eq(activities.id, activityId), eq(activities.campaignId, id)));
      if (!parent) { res.status(404).json({ error: "Activity not found in campaign" }); return; }
      const { gtmLaunchAt, eventAt, ...rest } = input.data;
      const patch = { ...rest,
        ...(gtmLaunchAt !== undefined ? { gtmLaunchAt: gtmLaunchAt === null ? null : new Date(gtmLaunchAt) } : {}),
        ...(eventAt !== undefined ? { eventAt: eventAt === null ? null : new Date(eventAt) } : {}),
      };
      const [result] = await db.insert(activityTaskSettings).values({ activityId, campaignId: id, ...patch })
        .onConflictDoUpdate({ target: activityTaskSettings.activityId, set: { campaignId: id, ...patch } }).returning();
      res.json(settingsResponse(result));
    } catch (error) { next(error); }
  });

router.get("/task-defaults", async (_req, res, next) => {
  try { res.json(await db.select().from(taskDefaults)); } catch (error) { next(error); }
});
router.patch("/task-defaults", async (req, res, next) => {
  try {
    const parsed = z.object({ defaults: z.array(z.object({
      type: z.enum(["Asset", "Landing page", "Approval", "Tracking", "Other"]),
      offsetDays: z.number().int().min(-36500).max(36500),
    }).strict()).min(1) }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    await db.transaction(async tx => {
      for (const item of parsed.data.defaults) await tx.insert(taskDefaults).values(item)
        .onConflictDoUpdate({ target: taskDefaults.type, set: { offsetDays: item.offsetDays } });
    });
    res.json(await db.select().from(taskDefaults));
  } catch (error) { next(error); }
});
router.get("/owner-capacities", async (_req, res, next) => {
  try { res.json(await capacityTotals()); } catch (error) { next(error); }
});
router.patch("/owner-capacities", async (req, res, next) => {
  try {
    const parsed = z.object({ capacities: z.array(z.object({
      owner: z.string().min(1), ceiling: z.number().finite().nonnegative(),
    }).strict()).min(1) }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    await db.transaction(async tx => {
      for (const item of parsed.data.capacities) await tx.insert(ownerCapacities).values(item)
        .onConflictDoUpdate({ target: ownerCapacities.owner, set: { ceiling: item.ceiling } });
    });
    await syncCapacityConflicts();
    res.json(await capacityTotals());
  } catch (error) { next(error); }
});
router.delete("/campaigns/:id/tasks/:itemId", async (req, res, next) => {
  try {
    const parsed = z.object({ id: z.string().uuid(), itemId: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const { id, itemId } = parsed.data;
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
      const [existing] = await tx.select().from(activityTasks).where(and(eq(activityTasks.id, itemId), eq(activityTasks.campaignId, id)));
      if (!existing) return "missing";
      const details = await tx.select().from(communicationDetails).where(eq(communicationDetails.campaignId, id));
      if (details.some(detail => detail.blockingDependencyTaskIds.includes(itemId))) return "referenced";
      await tx.delete(activityTasks).where(and(eq(activityTasks.id, itemId), eq(activityTasks.campaignId, id)));
      await invalidateBlockedReleases(id, tx);
      return "deleted";
    });
    if (outcome === "missing") { res.status(404).json({ error: "Activity task not found" }); return; }
    if (outcome === "referenced") {
      res.status(409).json({ error: "Remove this task from communication blocking dependencies before deleting" }); return;
    }
    await syncCapacityConflicts();
    res.status(204).end();
  } catch (error) { next(error); }
});
export default router;