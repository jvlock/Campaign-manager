import { and, eq, isNull, or } from "drizzle-orm";
import {
  db,
  scheduleRules,
  scheduledInstanceHistory,
  scheduledInstances,
  webinarSessions,
  webinarStandardCommunications,
  type ScheduleRule,
} from "@workspace/db";
import { ensureWebinarStandard } from "./webinar-standard";

export const BUSINESS_DAY_STRATEGIES = [
  "calendar",
  "skip_weekends",
  "next_business_day",
  "previous_business_day",
] as const;
export type BusinessDayStrategy = (typeof BUSINESS_DAY_STRATEGIES)[number];

export type ScheduleCalculationInput = Pick<
  ScheduleRule,
  | "offsetDays"
  | "offsetMinutes"
  | "direction"
  | "businessDayStrategy"
  | "audienceLocalTimezone"
  | "timezone"
  | "targetSendTime"
>;

export class ScheduleValidationError extends Error {
  statusCode = 400;
}

function assertTimezone(timezone: string): void {
  try {
    // Constructing the formatter is the platform's authoritative IANA TZ
    // validation and correctly rejects silent fallback to the host timezone.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new ScheduleValidationError(`Invalid IANA timezone: ${timezone}`);
  }
}

function localParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function dateParts(date: Date) {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function dayOfWeek(parts: { year: number; month: number; day: number }) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function isWeekend(parts: { year: number; month: number; day: number }) {
  const day = dayOfWeek(parts);
  return day === 0 || day === 6;
}

function addCalendarDays(
  parts: { year: number; month: number; day: number },
  amount: number,
) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + amount);
  return dateParts(date);
}

function shiftBusinessDays(
  start: { year: number; month: number; day: number },
  amount: number,
  strategy: BusinessDayStrategy,
) {
  // "next" and "previous" apply the requested calendar offset first, then
  // roll a weekend landing to the nearest business day. Only
  // "skip_weekends" counts weekdays while traversing the offset.
  const calendarResult = addCalendarDays(start, amount);
  if (strategy === "calendar") {
    return calendarResult;
  }
  if (strategy === "next_business_day") {
    let result = calendarResult;
    while (isWeekend(result)) result = addCalendarDays(result, 1);
    return result;
  }
  if (strategy === "previous_business_day") {
    let result = calendarResult;
    while (isWeekend(result)) result = addCalendarDays(result, -1);
    return result;
  }
  if (amount === 0) {
    return calendarResult;
  }

  const step = amount < 0 ? -1 : 1;
  let remaining = Math.abs(amount);
  let result = start;
  while (remaining > 0) {
    result = addCalendarDays(result, step);
    if (!isWeekend(result)) remaining -= 1;
  }
  return result;
}

function timezoneOffsetMinutes(date: Date, timezone: string): number {
  const parts = localParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function fromLocalParts(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timezone: string,
) {
  const naiveUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);
  const firstGuess = new Date(naiveUtc - timezoneOffsetMinutes(new Date(naiveUtc), timezone) * 60000);
  // Re-evaluate around DST transitions.  The second pass is stable for all
  // ordinary and daylight-saving IANA zones.
  const corrected = new Date(naiveUtc - timezoneOffsetMinutes(firstGuess, timezone) * 60000);
  return corrected;
}

function parseTargetSendTime(value: string | null): { hour: number; minute: number } | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new ScheduleValidationError("targetSendTime must use HH:mm");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function validateScheduleRuleInput(input: Partial<ScheduleCalculationInput>): void {
  if (input.direction !== undefined && input.direction !== "before" && input.direction !== "after") {
    throw new ScheduleValidationError("direction must be before or after");
  }
  if (input.offsetDays !== undefined && (!Number.isInteger(input.offsetDays) || input.offsetDays < 0)) {
    throw new ScheduleValidationError("offsetDays must be a non-negative integer");
  }
  if (input.offsetMinutes !== undefined && (!Number.isInteger(input.offsetMinutes) || input.offsetMinutes < 0)) {
    throw new ScheduleValidationError("offsetMinutes must be a non-negative integer");
  }
  if (
    input.businessDayStrategy !== undefined &&
    !BUSINESS_DAY_STRATEGIES.includes(input.businessDayStrategy as BusinessDayStrategy)
  ) {
    throw new ScheduleValidationError(`Unsupported businessDayStrategy: ${input.businessDayStrategy}`);
  }
  if (input.timezone !== undefined) assertTimezone(input.timezone);
  parseTargetSendTime(input.targetSendTime ?? null);
}

export function calculateScheduledAt(anchorAt: Date, rule: ScheduleCalculationInput, timezoneOverride?: string): Date {
  if (Number.isNaN(anchorAt.getTime())) throw new ScheduleValidationError("anchorAt must be a valid date");
  validateScheduleRuleInput(rule);
  const timezone = rule.audienceLocalTimezone ? (timezoneOverride ?? rule.timezone) : "UTC";
  assertTimezone(timezone);
  const localAnchor = localParts(anchorAt, timezone);
  const direction = rule.direction === "before" ? -1 : 1;
  const strategy = (rule.businessDayStrategy || "calendar") as BusinessDayStrategy;
  const shiftedDate = shiftBusinessDays(
    { year: localAnchor.year, month: localAnchor.month, day: localAnchor.day },
    direction * (rule.offsetDays || 0),
    strategy,
  );
  const target = parseTargetSendTime(rule.targetSendTime);
  const baseMinutes = (target?.hour ?? localAnchor.hour) * 60 + (target?.minute ?? localAnchor.minute);
  const shiftedMinutes = baseMinutes + direction * (rule.offsetMinutes || 0);
  const minuteDate = new Date(Date.UTC(shiftedDate.year, shiftedDate.month - 1, shiftedDate.day));
  minuteDate.setUTCMinutes(shiftedMinutes);
  const localDate = dateParts(minuteDate);
  return fromLocalParts({
    ...localDate,
    hour: minuteDate.getUTCHours(),
    minute: minuteDate.getUTCMinutes(),
    second: target ? 0 : localAnchor.second,
  }, timezone);
}

function instanceResponse(row: typeof scheduledInstances.$inferSelect) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    ruleId: row.ruleId,
    activityId: row.activityId,
    communicationId: row.communicationId,
    originalCalculatedAt: row.originalCalculatedAt.toISOString(),
    calculatedAt: row.calculatedAt.toISOString(),
    adjustedAt: row.adjustedAt?.toISOString() ?? null,
    adjustmentReason: row.adjustmentReason,
    timezone: row.timezone,
    status: row.status,
    rowVersion: row.rowVersion,
  };
}

/**
 * The manually adjusted send instant is the effective schedule.  calculatedAt
 * remains the latest value produced by the rule, which lets callers show the
 * rule result and the manual override independently.
 */
export function effectiveScheduledAt(
  instance: Pick<typeof scheduledInstances.$inferSelect, "calculatedAt" | "adjustedAt">,
): Date {
  return instance.adjustedAt ?? instance.calculatedAt;
}

async function recomputeRuleInTransaction(
  // Drizzle's transaction type is dialect-specific and differs from the
  // database handle; the operations below intentionally use only its shared
  // query surface.
  tx: any,
  rule: ScheduleRule,
  anchorAt: Date,
  timezone?: string,
  reason = "anchor changed",
) {
  const calculatedAt = calculateScheduledAt(anchorAt, rule, timezone);
  const calculationTimezone = rule.audienceLocalTimezone ? (timezone ?? rule.timezone) : "UTC";
  const [existing] = await tx.select().from(scheduledInstances).where(eq(scheduledInstances.ruleId, rule.id));
  if (!existing) {
    const [created] = await tx.insert(scheduledInstances).values({
      campaignId: rule.campaignId,
      ruleId: rule.id,
      activityId: rule.activityId,
      communicationId: rule.communicationId,
      originalCalculatedAt: calculatedAt,
      calculatedAt,
      timezone: calculationTimezone,
    }).returning();
    return created;
  }
  const previousEffectiveAt = effectiveScheduledAt(existing);
  const adjustmentWasCleared = existing.adjustedAt !== null;
  await tx.insert(scheduledInstanceHistory).values({
    campaignId: existing.campaignId,
    scheduledInstanceId: existing.id,
    ruleId: rule.id,
    anchorAt,
    previousCalculatedAt: previousEffectiveAt,
    calculatedAt,
    reason: adjustmentWasCleared
      ? `${reason}; manual adjustment cleared by recompute`
      : reason,
  });
  const [updated] = await tx.update(scheduledInstances).set({
    calculatedAt,
    // An anchor/rule recomputation intentionally supersedes a manual override.
    // The prior effective instant and the clearing policy are retained above.
    adjustedAt: null,
    adjustmentReason: null,
    timezone: calculationTimezone,
    updatedAt: new Date(),
    rowVersion: existing.rowVersion + 1,
  }).where(and(
    eq(scheduledInstances.id, existing.id),
    eq(scheduledInstances.rowVersion, existing.rowVersion),
  )).returning();
  if (!updated) {
    const error = new Error("Scheduled instance has changed");
    (error as Error & { statusCode?: number }).statusCode = 409;
    throw error;
  }
  return updated;
}

export async function recomputeRule(
  ruleId: string,
  anchorAt: Date | string,
  timezone?: string,
  reason = "anchor changed",
) {
  const anchor = new Date(anchorAt);
  const [rule] = await db.select().from(scheduleRules).where(eq(scheduleRules.id, ruleId));
  if (!rule) throw new Error("Schedule rule not found");
  const [standard] = await db.select({ id: webinarStandardCommunications.id })
    .from(webinarStandardCommunications)
    .where(eq(webinarStandardCommunications.scheduleRuleId, ruleId));
  if (standard) {
    throw new ScheduleValidationError("Webinar standard timing is locked; use the webinar standard scheduler");
  }
  return db.transaction((tx) => recomputeRuleInTransaction(tx, rule, anchor, timezone, reason));
}

/**
 * Exported for the webinar/session route.  The route can call this after a
 * session moves without needing to know how instances and history are stored.
 */
export async function recomputeForAnchor(
  activityId: string,
  anchorAt: Date | string,
  timezone: string,
  reason = "anchor changed",
  executor?: any,
) {
  assertTimezone(timezone);
  const anchor = new Date(anchorAt);
  const recompute = async (tx: any) => {
    const rules = await tx.select().from(scheduleRules).where(
      and(
        eq(scheduleRules.enabled, true),
        or(
          eq(scheduleRules.anchorActivityId, activityId),
          and(isNull(scheduleRules.anchorActivityId), eq(scheduleRules.activityId, activityId)),
        ),
      ),
    );
    const rows = [];
    for (const rule of rules) {
      // Webinar standard rules have their own calendar/elapsed engine.  The
      // generic schedule editor may not silently turn elapsed-hour reminders
      // into wall-clock calculations through DST.
      const [standardRule] = await tx
        .select({ id: webinarStandardCommunications.id })
        .from(webinarStandardCommunications)
        .where(eq(webinarStandardCommunications.scheduleRuleId, rule.id));
      if (standardRule) continue;
      rows.push(await recomputeRuleInTransaction(tx, rule, anchor, timezone, reason));
    }
    const [session] = await tx.select().from(webinarSessions).where(eq(webinarSessions.activityId, activityId));
    if (session) await ensureWebinarStandard(session, tx);
    return rows;
  };
  return executor ? recompute(executor) : db.transaction(recompute);
}

export async function adjustScheduledInstance(
  instanceId: string,
  adjustedAt: Date | string,
  reason: string,
  expectedRowVersion?: number,
) {
  const nextDate = new Date(adjustedAt);
  if (Number.isNaN(nextDate.getTime())) throw new ScheduleValidationError("calculatedAt must be a valid date");
  if (!reason.trim()) throw new ScheduleValidationError("adjustment reason is required");
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(scheduledInstances).where(eq(scheduledInstances.id, instanceId));
    if (!existing) throw new Error("Scheduled instance not found");
    if (expectedRowVersion !== undefined && expectedRowVersion !== existing.rowVersion) {
      const error = new Error("Scheduled instance has changed");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    const previousEffectiveAt = effectiveScheduledAt(existing);
    const [updated] = await tx.update(scheduledInstances).set({
      // calculatedAt is intentionally untouched: it remains the rule-derived
      // result. adjustedAt is the user-selected effective send instant.
      adjustedAt: nextDate,
      adjustmentReason: reason,
      rowVersion: existing.rowVersion + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(scheduledInstances.id, instanceId),
      eq(scheduledInstances.rowVersion, existing.rowVersion),
    )).returning();
    if (!updated) {
      const error = new Error("Scheduled instance has changed");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    await tx.insert(scheduledInstanceHistory).values({
      campaignId: existing.campaignId,
      scheduledInstanceId: existing.id,
      ruleId: existing.ruleId,
      // Manual adjustments have no new anchor. Store the prior effective
      // instant as the audit anchor and identify the operation in reason.
      anchorAt: previousEffectiveAt,
      previousCalculatedAt: previousEffectiveAt,
      calculatedAt: nextDate,
      reason: `manual adjustment: ${reason}`,
    });
    return updated;
  });
}

export { assertTimezone, instanceResponse };