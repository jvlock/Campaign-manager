import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { activityTasks, activityTaskSettings, taskDefaults, ownerCapacities, conflicts, db, webinarSessions } from "@workspace/db";
import { BUSINESS_DAY_STRATEGIES, calculateScheduledAt } from "./planning";
import { sessionAnchor } from "./webinar-standard";

export const stages = ["Not Started", "In Progress", "Ready for Review", "Complete"] as const;
export const taskFields = z.object({
  stage: z.enum(stages).optional(),
  blocked: z.boolean().optional(),
  blockedReason: z.enum(["On Hold", "Content", "Technical", "Legal"]).nullable().optional(),
  supportingOwner: z.string().optional(), requestingTeam: z.string().optional(),
  requester: z.string().optional(), notes: z.string().optional(),
  trigger: z.enum(["gtm_launch", "event"]).optional(),
  offsetDays: z.number().int().min(-36500).max(36500).nullable().optional(),
  businessDayStrategy: z.enum(BUSINESS_DAY_STRATEGIES).optional(),
  effortPoints: z.number().finite().nonnegative().optional(),
});

export class TaskValidationError extends Error { status = 400; }
export function validateTaskFields(input: Record<string, unknown>, existing?: { blocked: boolean; blockedReason: string | null }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TaskValidationError("Task input must be an object");
  for (const field of ["dueAt", "scheduledAt", "manualDueAt", "schedulingIssue", "effectiveOffsetDays"]) {
    if (field in input) throw new TaskValidationError(`${field} is calculated and read-only; manual scheduling fields are not allowed`);
  }
  const allowed = new Set([
    ...Object.keys(taskFields.shape),
    "activityId", "name", "type", "timing", "sortOrder", "status", "owner",
  ]);
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) throw new TaskValidationError(`Unknown task field: ${field}`);
  }
  const parsed = taskFields.safeParse(input);
  if (!parsed.success) throw new TaskValidationError(parsed.error.message);
  const data = parsed.data;
  const blocked = data.blocked ?? existing?.blocked ?? false;
  const reason = data.blockedReason === undefined ? existing?.blockedReason : data.blockedReason;
  if (blocked && !reason) throw new TaskValidationError("blockedReason is required when blocked");
  if (!blocked && data.blockedReason != null && data.blocked !== false) throw new TaskValidationError("blockedReason is only allowed when blocked");
  return { ...data, blocked, blockedReason: blocked ? reason! : null };
}

export function taskDueAt(anchor: Date, offsetDays: number, businessDayStrategy: string, timezone: string) {
  return calculateScheduledAt(anchor, {
    direction: offsetDays < 0 ? "before" : "after", offsetDays: Math.abs(offsetDays),
    offsetMinutes: 0, businessDayStrategy, timezone, audienceLocalTimezone: true, targetSendTime: null,
  });
}

export async function implementationTaskResponse(row: typeof activityTasks.$inferSelect) {
  const [[settings], [reference], sessions] = await Promise.all([
    db.select().from(activityTaskSettings).where(eq(activityTaskSettings.activityId, row.activityId)),
    db.select().from(taskDefaults).where(eq(taskDefaults.type, row.type)),
    db.select().from(webinarSessions).where(and(eq(webinarSessions.activityId, row.activityId), eq(webinarSessions.campaignId, row.campaignId))),
  ]);
  const effectiveOffsetDays = row.offsetDays ?? reference?.offsetDays ?? 0;
  let anchor = row.trigger === "event" ? settings?.eventAt : settings?.gtmLaunchAt;
  let timezone = settings?.timezone ?? "UTC";
  if (row.trigger === "event" && sessions.length === 1) {
    anchor = sessionAnchor(sessions[0]); timezone = sessions[0].timezone;
  }
  let schedulingIssue: string | null = null;
  let dueAt: string | null = null;
  if (row.trigger === "event" && sessions.length > 1) schedulingIssue = "Multiple webinar sessions: event anchor is ambiguous";
  else if (!anchor) schedulingIssue = `Missing ${row.trigger === "event" ? "event" : "GTM launch"} anchor on parent activity`;
  else dueAt = taskDueAt(anchor, effectiveOffsetDays, row.businessDayStrategy, timezone).toISOString();
  return { ...row, dueAt, schedulingIssue, effectiveOffsetDays };
}

export function countTasks(rows: { stage: string; blocked: boolean }[]) {
  return {
    stages: Object.fromEntries(stages.map(stage => [stage, rows.filter(row => row.stage === stage).length])),
    blocked: rows.filter(row => row.blocked).length,
  };
}

export async function capacityTotals() {
  // SQL aggregation is global, not campaign scoped. Supporting owners deliberately excluded.
  const totals = await db.select({
    owner: activityTasks.owner,
    totalEffort: sql<number>`coalesce(sum(case when ${activityTasks.stage} <> 'Complete' then ${activityTasks.effortPoints} else 0 end),0)::float8`,
  }).from(activityTasks).groupBy(activityTasks.owner);
  const limits = await db.select().from(ownerCapacities);
  const names = new Set([...totals.map(x => x.owner), ...limits.map(x => x.owner)]);
  return [...names].sort().map(owner => {
    const ceiling = limits.find(x => x.owner === owner)?.ceiling ?? 10;
    const totalEffort = totals.find(x => x.owner === owner)?.totalEffort ?? 0;
    return { owner, ceiling, totalEffort, overallocated: totalEffort > ceiling, label: "Configurable ceiling (default 10 points)" };
  });
}

export async function syncCapacityConflicts() {
  // Serialize reconciliations, including scans and concurrent edits, to avoid duplicate records.
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(120012)`);
    // Persist the labeled configurable default for every owner encountered.
    await tx.execute(sql`insert into owner_capacities(owner, ceiling)
      select distinct owner, 10 from activity_tasks on conflict (owner) do nothing`);
    const totals = await capacityTotals();
    const managed = await tx.select().from(conflicts).where(eq(conflicts.classification, "Resource overallocation"));
    const tasks = await tx.select({ owner: activityTasks.owner, campaignId: activityTasks.campaignId, stage: activityTasks.stage }).from(activityTasks);
    for (const owner of new Set([...totals.map(x => x.owner), ...managed.map(x => x.owner)])) {
      const capacity = totals.find(x => x.owner === owner);
      const prior = managed.filter(x => x.owner === owner);
      const over = capacity?.overallocated ?? false;
      const values = {
        classification: "Resource overallocation", severity: "High",
        title: `Implementation task capacity: ${owner}`, owner,
        reason: `${capacity?.totalEffort ?? 0} effort points / ${capacity?.ceiling ?? 10} configurable ceiling. Includes blocked work; excludes Complete.`,
        campaignIds: [...new Set(tasks.filter(t => t.owner === owner && t.stage !== "Complete").map(t => t.campaignId))],
        dates: "Current workload", recommendation: "Reassign work, complete tasks, or adjust the configurable owner ceiling.",
        status: over ? "Open" : "Resolved", updatedAt: new Date(),
      };
      if (prior.length) {
        await tx.update(conflicts).set(values).where(eq(conflicts.id, prior[0].id));
        for (const duplicate of prior.slice(1)) await tx.delete(conflicts).where(eq(conflicts.id, duplicate.id));
      } else if (over) await tx.insert(conflicts).values(values);
    }
  });
}