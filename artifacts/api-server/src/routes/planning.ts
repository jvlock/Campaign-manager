import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  activities,
  communications,
  db,
  insertScheduleRuleSchema,
  scheduleRules,
  scheduledInstanceHistory,
  scheduledInstances,
  campaigns,
} from "@workspace/db";
import {
  adjustScheduledInstance,
  calculateScheduledAt,
  instanceResponse,
  recomputeForAnchor,
  recomputeRule,
  ScheduleValidationError,
  type ScheduleCalculationInput,
  validateScheduleRuleInput,
} from "../lib/planning";

const router: IRouter = Router();

const ruleFields = [
  "activityId",
  "communicationId",
  "anchorActivityId",
  "offsetDays",
  "offsetMinutes",
  "direction",
  "businessDayStrategy",
  "audienceLocalTimezone",
  "timezone",
  "targetSendTime",
  "enabled",
] as const;

function ruleResponse(row: typeof scheduleRules.$inferSelect) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    activityId: row.activityId,
    communicationId: row.communicationId,
    anchorActivityId: row.anchorActivityId,
    offsetDays: row.offsetDays,
    offsetMinutes: row.offsetMinutes,
    direction: row.direction,
    businessDayStrategy: row.businessDayStrategy,
    audienceLocalTimezone: row.audienceLocalTimezone,
    timezone: row.timezone,
    targetSendTime: row.targetSendTime,
    enabled: row.enabled,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function campaignExists(campaignId: string) {
  const [row] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId));
  return Boolean(row);
}

async function belongsToCampaign(table: typeof activities | typeof communications, id: string, campaignId: string) {
  const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.campaignId, campaignId)));
  return Boolean(row);
}

async function validateRuleReferences(campaignId: string, body: Record<string, unknown>) {
  for (const field of ["activityId", "anchorActivityId"] as const) {
    const value = body[field];
    if (value !== undefined && value !== null && !(await belongsToCampaign(activities, String(value), campaignId))) {
      throw Object.assign(new Error(`${field} does not belong to this campaign`), { statusCode: 400 });
    }
  }
  if (
    body.communicationId !== undefined &&
    body.communicationId !== null &&
    !(await belongsToCampaign(communications, String(body.communicationId), campaignId))
  ) {
    throw Object.assign(new Error("communicationId does not belong to this campaign"), { statusCode: 400 });
  }
}

function errorStatus(error: unknown) {
  if (error instanceof ScheduleValidationError) return error.statusCode;
  if (error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return 500;
}

router.get("/campaigns/:id/schedule-rules", async (req, res, next): Promise<void> => {
  try {
    if (!(await campaignExists(req.params.id))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const rows = await db.select().from(scheduleRules).where(eq(scheduleRules.campaignId, req.params.id));
    res.json(rows.map(ruleResponse));
  } catch (error) {
    next(error);
  }
});

router.post("/campaigns/:id/schedule-rules", async (req, res, next): Promise<void> => {
  try {
    const campaignId = req.params.id;
    if (!(await campaignExists(campaignId))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const parsed = insertScheduleRuleSchema.safeParse({
      ...req.body,
      campaignId,
    });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    await validateRuleReferences(campaignId, parsed.data as Record<string, unknown>);
    validateScheduleRuleInput(parsed.data);
    if (req.body.anchorAt) {
      const anchor = new Date(req.body.anchorAt);
      if (Number.isNaN(anchor.getTime())) throw new ScheduleValidationError("anchorAt must be a valid date");
      calculateScheduledAt(anchor, parsed.data as ScheduleCalculationInput, req.body.timezone);
    }
    const [created] = await db.insert(scheduleRules).values({
      campaignId,
      activityId: parsed.data.activityId,
      communicationId: parsed.data.communicationId,
      anchorActivityId: parsed.data.anchorActivityId,
      offsetDays: parsed.data.offsetDays,
      offsetMinutes: parsed.data.offsetMinutes,
      direction: parsed.data.direction,
      businessDayStrategy: parsed.data.businessDayStrategy,
      audienceLocalTimezone: parsed.data.audienceLocalTimezone,
      timezone: parsed.data.timezone,
      targetSendTime: parsed.data.targetSendTime,
      enabled: parsed.data.enabled,
    }).returning();
    if (req.body.anchorAt) {
      // Create the initial instance and retain its originalCalculatedAt.
      await recomputeRule(created.id, req.body.anchorAt, req.body.timezone, "initial calculation");
    }
    const [row] = await db.select().from(scheduleRules).where(eq(scheduleRules.id, created.id));
    res.status(201).json({ rule: ruleResponse(row), instance: req.body.anchorAt ? instanceResponse((await db.select().from(scheduledInstances).where(eq(scheduledInstances.ruleId, created.id)))[0]) : null });
  } catch (error) {
    if (errorStatus(error) !== 500) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Invalid schedule rule" });
      return;
    }
    next(error);
  }
});

router.patch("/campaigns/:id/schedule-rules/:ruleId", async (req, res, next): Promise<void> => {
  try {
    const [existing] = await db.select().from(scheduleRules).where(and(
      eq(scheduleRules.id, req.params.ruleId),
      eq(scheduleRules.campaignId, req.params.id),
    ));
    if (!existing) {
      res.status(404).json({ error: "Schedule rule not found" });
      return;
    }
    if (req.body.rowVersion !== undefined && req.body.rowVersion !== existing.rowVersion) {
      res.status(409).json({ error: "Schedule rule has changed", rowVersion: existing.rowVersion });
      return;
    }
    const candidate: Record<string, unknown> = { ...existing, ...req.body };
    await validateRuleReferences(req.params.id, candidate);
    validateScheduleRuleInput(candidate);
    const patch: Record<string, unknown> = { updatedAt: new Date(), rowVersion: existing.rowVersion + 1 };
    for (const field of ruleFields) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }
    const [updated] = await db.update(scheduleRules).set(patch).where(and(
      eq(scheduleRules.id, req.params.ruleId),
      eq(scheduleRules.campaignId, req.params.id),
      eq(scheduleRules.rowVersion, existing.rowVersion),
    )).returning();
    if (!updated) {
      res.status(409).json({ error: "Schedule rule has changed" });
      return;
    }
    res.json(ruleResponse(updated));
  } catch (error) {
    if (errorStatus(error) !== 500) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Invalid schedule rule" });
      return;
    }
    next(error);
  }
});

router.delete("/campaigns/:id/schedule-rules/:ruleId", async (req, res, next): Promise<void> => {
  try {
    const [instance] = await db.select({ id: scheduledInstances.id }).from(scheduledInstances).where(
      eq(scheduledInstances.ruleId, req.params.ruleId),
    );
    const [history] = await db.select({ id: scheduledInstanceHistory.id }).from(scheduledInstanceHistory).where(
      eq(scheduledInstanceHistory.ruleId, req.params.ruleId),
    );
    if (instance || history) {
      res.status(409).json({ error: "Cannot delete a schedule rule with scheduled instances or history" });
      return;
    }
    const [deleted] = await db.delete(scheduleRules).where(and(
      eq(scheduleRules.id, req.params.ruleId),
      eq(scheduleRules.campaignId, req.params.id),
    )).returning({ id: scheduleRules.id });
    if (!deleted) {
      res.status(404).json({ error: "Schedule rule not found" });
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/campaigns/:id/scheduled-instances", async (req, res, next): Promise<void> => {
  try {
    if (!(await campaignExists(req.params.id))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const rows = await db.select().from(scheduledInstances).where(eq(scheduledInstances.campaignId, req.params.id));
    res.json(rows.map(instanceResponse));
  } catch (error) {
    next(error);
  }
});

router.post("/campaigns/:id/schedule-rules/recompute", async (req, res, next): Promise<void> => {
  try {
    if (!(await campaignExists(req.params.id))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (!req.body.anchorAt || !req.body.timezone) {
      res.status(400).json({ error: "anchorAt and timezone are required" });
      return;
    }
    if (
      req.body.activityId &&
      !(await belongsToCampaign(activities, String(req.body.activityId), req.params.id))
    ) {
      res.status(400).json({ error: "activityId does not belong to this campaign" });
      return;
    }
    let rows;
    if (req.body.ruleId) {
      const [rule] = await db.select({ id: scheduleRules.id }).from(scheduleRules).where(and(
        eq(scheduleRules.id, req.body.ruleId),
        eq(scheduleRules.campaignId, req.params.id),
      ));
      if (!rule) {
        res.status(404).json({ error: "Schedule rule not found" });
        return;
      }
      rows = [await recomputeRule(req.body.ruleId, req.body.anchorAt, req.body.timezone, req.body.reason ?? "manual recompute")];
    } else if (req.body.activityId) {
      rows = await recomputeForAnchor(req.body.activityId, req.body.anchorAt, req.body.timezone, req.body.reason ?? "anchor changed");
    } else {
      res.status(400).json({ error: "ruleId or activityId is required" });
      return;
    }
    res.json(rows.map(instanceResponse));
  } catch (error) {
    if (errorStatus(error) !== 500) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Invalid schedule" });
      return;
    }
    next(error);
  }
});

router.patch("/campaigns/:id/scheduled-instances/:instanceId/adjust", async (req, res, next): Promise<void> => {
  try {
    const [instance] = await db.select().from(scheduledInstances).where(and(
      eq(scheduledInstances.id, req.params.instanceId),
      eq(scheduledInstances.campaignId, req.params.id),
    ));
    if (!instance) {
      res.status(404).json({ error: "Scheduled instance not found" });
      return;
    }
    const requestedAt = req.body.adjustedAt ?? req.body.calculatedAt;
    const expectedRowVersion = req.body.rowVersion === undefined
      ? undefined
      : Number(req.body.rowVersion);
    if (expectedRowVersion !== undefined && (!Number.isInteger(expectedRowVersion) || expectedRowVersion < 1)) {
      res.status(400).json({ error: "rowVersion must be a positive integer" });
      return;
    }
    const updated = await adjustScheduledInstance(
      instance.id,
      requestedAt,
      String(req.body.reason ?? ""),
      expectedRowVersion,
    );
    res.json(instanceResponse(updated));
  } catch (error) {
    if (errorStatus(error) !== 500) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Invalid adjustment" });
      return;
    }
    next(error);
  }
});

export default router;