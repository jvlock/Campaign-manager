import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  activities,
  audiences,
  campaigns,
  communicationDetails,
  communications,
  db,
  scheduleRules,
  scheduledInstanceHistory,
  scheduledInstances,
  type WebinarSession,
  type WebinarTemplateVersion,
  DEFAULT_NEW_WEBINAR_TEMPLATE_VERSION,
  webinarAttendanceResults,
  webinarPeople,
  webinarRegistrationResults,
  webinarSessions,
  webinarStandardCommunications,
  webinarStandardConfigs,
  webinarStandardTriggerEvents,
  DEFAULT_WEBINAR_STANDARD_LIMITS,
  DEFAULT_WEBINAR_STANDARD_VARIANTS,
  STANDARD_WEBINAR_KEYS,
  type WebinarStandardContent,
  type WebinarStandardPilotLimits,
  type WebinarStandardVariant,
  type WebinarStandardVariantContent,
} from "@workspace/db";

export const standardKeys = STANDARD_WEBINAR_KEYS;

const contentFields = [
  "subject",
  "preheader",
  "hero",
  "body",
  "ctaLabel",
  "ctaUrl",
  "internalAssetName",
] as const;
type ContentField = (typeof contentFields)[number];

type StandardDefinition = {
  key: string;
  name: string;
  kind: "trigger" | "calendar" | "elapsed";
  offset: number;
  unit: "instant" | "days" | "hours";
  direction: "trigger" | "before" | "after";
  weekend: "none" | "previous_friday" | "next_monday";
  audience: string;
};

const legacyStandardDefinitions: readonly StandardDefinition[] = [
  { key: "registration_confirmation", name: "Registration confirmation", kind: "trigger", offset: 0, unit: "instant", direction: "trigger", weekend: "none", audience: "Successful registration record instant only" },
  { key: "recruitment_1", name: "Recruitment invitation 1", kind: "calendar", offset: 21, unit: "days", direction: "before", weekend: "previous_friday", audience: "Not registered and no successful registration record" },
  { key: "recruitment_2", name: "Recruitment invitation 2", kind: "calendar", offset: 14, unit: "days", direction: "before", weekend: "previous_friday", audience: "Not registered and no successful registration record" },
  { key: "recruitment_3", name: "Recruitment invitation 3", kind: "calendar", offset: 7, unit: "days", direction: "before", weekend: "previous_friday", audience: "Not registered and no successful registration record" },
  { key: "final_recruitment", name: "Final recruitment invitation", kind: "calendar", offset: 1, unit: "days", direction: "before", weekend: "previous_friday", audience: "Not registered and no successful registration record" },
  { key: "registered_reminder", name: "Registered attendee reminder", kind: "elapsed", offset: 24, unit: "hours", direction: "before", weekend: "none", audience: "Registered and non-canceled" },
  { key: "final_reminder", name: "Final attendee reminder", kind: "elapsed", offset: 1, unit: "hours", direction: "before", weekend: "none", audience: "Registered and non-canceled" },
  { key: "attendee_followup", name: "Attendee follow-up", kind: "calendar", offset: 1, unit: "days", direction: "after", weekend: "next_monday", audience: "Confirmed attendance; no-show excluded" },
  { key: "no_show_followup", name: "No-show follow-up", kind: "calendar", offset: 1, unit: "days", direction: "after", weekend: "next_monday", audience: "Registered nonattendance; attended excluded" },
];

const defaultFiveStandardDefinitions: readonly StandardDefinition[] = [
  { key: "recruitment_1", name: "Recruitment invitation 1", kind: "calendar", offset: 14, unit: "days", direction: "before", weekend: "previous_friday", audience: "Not registered and no successful registration record" },
  { key: "recruitment_2", name: "Recruitment invitation 2", kind: "calendar", offset: 7, unit: "days", direction: "before", weekend: "previous_friday", audience: "Not registered and no successful registration record" },
  { key: "registered_reminder", name: "Registered attendee reminder", kind: "elapsed", offset: 24, unit: "hours", direction: "before", weekend: "none", audience: "Registered and non-canceled" },
  { key: "final_reminder", name: "Final attendee reminder", kind: "elapsed", offset: 1, unit: "hours", direction: "before", weekend: "none", audience: "Registered and non-canceled" },
  { key: "attendee_followup", name: "Attendee thank-you", kind: "calendar", offset: 1, unit: "days", direction: "after", weekend: "next_monday", audience: "Confirmed attendee; no-show excluded" },
];

const definitionsByTemplate: Record<WebinarTemplateVersion, readonly StandardDefinition[]> = {
  legacy_9: legacyStandardDefinitions,
  default_5: defaultFiveStandardDefinitions,
};

export const webinarTemplateMetadata = {
  legacy_9: {
    templateId: "webinar_legacy_9",
    templateName: "Legacy 9-message webinar communications",
    templateSummary: "Registration confirmation, four recruitment waves, two reminders, attendee follow-up, and no-show follow-up.",
  },
  default_5: {
    templateId: "webinar_default_5",
    templateName: "5-message webinar communications",
    templateSummary: "Two invites at 14 and 7 calendar days before, two reminders at 24 and 1 hour before, and an attendee thank-you 1 calendar day after.",
  },
} as const;

function templateVersionFor(value: string): WebinarTemplateVersion {
  if (value === "legacy_9" || value === "default_5") return value;
  throw new WebinarStandardValidationError(`Unknown webinar template version ${value}`, 500);
}

function definitionsForTemplate(value: string) {
  return definitionsByTemplate[templateVersionFor(value)];
}

const definitionByKey = new Map(legacyStandardDefinitions.map((definition) => [definition.key, definition]));
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const contentSchema = z.object({
  subject: z.string(),
  preheader: z.string(),
  hero: z.string(),
  body: z.string(),
  ctaLabel: z.string(),
  ctaUrl: z.string(),
  internalAssetName: z.string(),
});

export const webinarSetupSchema = z.object({
  eventDate: z.string().regex(datePattern, "eventDate must be YYYY-MM-DD"),
  eventTime: z.string().regex(timePattern, "eventTime must be HH:mm"),
  durationMinutes: z.number().int().positive().max(1440),
  timezone: z.string().trim().min(1),
  platform: z.string().trim().min(1),
  speakers: z.array(z.object({
    name: z.string().trim().min(1),
    role: z.string().optional(),
    organization: z.string().optional(),
  })).default([]),
  recruitmentLaunchAt: z.string().datetime({ offset: true }),
}).strict();

const variantSchema = z.object({
  slot: z.number().int().min(1).max(4),
  name: z.string(),
  inUse: z.boolean(),
  audienceDefinition: z.string(),
  messageAngle: z.string(),
  valueProposition: z.string(),
});

const contentPatchSchema = z.object({
  subject: z.string().optional(),
  preheader: z.string().optional(),
  hero: z.string().optional(),
  body: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaUrl: z.string().optional(),
  internalAssetName: z.string().optional(),
});

export const standardPatchSchema = z.object({
  launchAt: z.string().datetime({ offset: true }).optional(),
  templateConfig: z.object({
    pilotLimits: z.record(z.enum(contentFields), z.number().int().positive()).optional(),
    variants: z.array(variantSchema).min(1).max(4).optional(),
  }).optional(),
  communications: z.array(z.object({
    key: z.string(),
    status: z.string().optional(),
    variants: z.array(z.object({
      slot: z.number().int().min(1).max(4),
      content: contentPatchSchema,
    })).optional(),
    // Fixed timing is intentionally accepted for detection and rejected below.
    timing: z.unknown().optional(),
  })).optional(),
});

export class WebinarStandardValidationError extends Error {
  readonly status: number;
  readonly statusCode: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "WebinarStandardValidationError";
    this.status = status;
    this.statusCode = status;
  }
}

function assertTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new WebinarStandardValidationError(`Invalid IANA timezone: ${timezone}`);
  }
}

function partsInTimezone(date: Date, timezone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return values as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

function timezoneOffsetMinutes(date: Date, timezone: string) {
  const local = partsInTimezone(date, timezone);
  return Math.round((Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - date.getTime()) / 60000);
}

function fromLocalParts(parts: { year: number; month: number; day: number; hour: number; minute: number; second?: number }, timezone: string) {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);
  const first = new Date(naive - timezoneOffsetMinutes(new Date(naive), timezone) * 60000);
  return new Date(naive - timezoneOffsetMinutes(first, timezone) * 60000);
}

function addCalendarDays(parts: { year: number; month: number; day: number }, amount: number) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  value.setUTCDate(value.getUTCDate() + amount);
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function isWeekend(parts: { year: number; month: number; day: number }) {
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day === 0 || day === 6;
}

function rollWeekend(parts: { year: number; month: number; day: number }, direction: "before" | "after") {
  let result = parts;
  while (isWeekend(result)) result = addCalendarDays(result, direction === "before" ? -1 : 1);
  return result;
}

function sessionDateText(session: Pick<WebinarSession, "sessionDate">) {
  return String(session.sessionDate).slice(0, 10);
}

export function sessionAnchor(session: Pick<WebinarSession, "sessionDate" | "startTime" | "timezone">) {
  assertTimezone(session.timezone);
  const [year, month, day] = sessionDateText(session).split("-").map(Number);
  const [hour, minute, second = 0] = String(session.startTime).split(":").map(Number);
  return fromLocalParts({ year, month, day, hour, minute, second }, session.timezone);
}

function deterministicAssetName(campaignId: string, sessionId: string, key: string, slot: number) {
  const value = `webinar-${campaignId.replaceAll("-", "")}-${sessionId.replaceAll("-", "")}-${key}-v${slot}`;
  if (value.length > DEFAULT_WEBINAR_STANDARD_LIMITS.internalAssetName) {
    throw new WebinarStandardValidationError(`Generated internal asset name exceeds ${DEFAULT_WEBINAR_STANDARD_LIMITS.internalAssetName} characters`, 500);
  }
  return value;
}

function emptyContent(campaignId: string, sessionId: string, key: string, slot: number): WebinarStandardContent {
  return {
    subject: "",
    preheader: "",
    hero: "",
    body: "",
    ctaLabel: "",
    ctaUrl: "",
    internalAssetName: deterministicAssetName(campaignId, sessionId, key, slot),
  };
}

function normalizeLimits(input: unknown): WebinarStandardPilotLimits {
  const limits = { ...DEFAULT_WEBINAR_STANDARD_LIMITS, ...(input && typeof input === "object" ? input : {}) };
  for (const field of contentFields) {
    const value = Number(limits[field]);
    if (!Number.isInteger(value) || value <= 0) throw new WebinarStandardValidationError(`pilotLimits.${field} must be a positive integer`);
    limits[field] = value;
  }
  return limits as WebinarStandardPilotLimits;
}

function normalizeVariants(input: unknown): WebinarStandardVariant[] {
  const variants = Array.isArray(input) && input.length ? input : DEFAULT_WEBINAR_STANDARD_VARIANTS;
  const slots = new Set<number>();
  const normalized = (variants as unknown[]).map((variant): WebinarStandardVariant => {
    const parsed = variantSchema.parse(variant);
    if (slots.has(parsed.slot)) throw new WebinarStandardValidationError(`Duplicate variant slot ${parsed.slot}`);
    slots.add(parsed.slot);
    return parsed;
  });
  if (!normalized.some((variant) => variant.inUse)) {
    throw new WebinarStandardValidationError("At least one webinar variant must be active");
  }
  return normalized.sort((a: WebinarStandardVariant, b: WebinarStandardVariant) => a.slot - b.slot);
}

function normalizeVariantContent(
  value: unknown,
  campaignId: string,
  sessionId: string,
  key: string,
  variants: WebinarStandardVariant[],
): WebinarStandardVariantContent[] {
  const existing = new Map<number, Partial<WebinarStandardContent>>();
  if (Array.isArray(value)) {
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const slot = Number((row as { slot?: number }).slot);
      if (Number.isInteger(slot)) {
        const content = (row as { content?: unknown }).content;
        if (content && typeof content === "object") existing.set(slot, content as Partial<WebinarStandardContent>);
      }
    }
  }
  return variants.map((variant) => {
    const content = existing.get(variant.slot) ?? {};
    const generated = emptyContent(campaignId, sessionId, key, variant.slot);
    return {
      slot: variant.slot,
      content: Object.fromEntries(contentFields.map((field) => [field, content[field] ?? generated[field]])) as WebinarStandardContent,
    };
  });
}

function calendarTarget(session: WebinarSession, offset: number, direction: "before" | "after") {
  const anchor = partsInTimezone(sessionAnchor(session), session.timezone);
  let date = addCalendarDays({ year: anchor.year, month: anchor.month, day: anchor.day }, direction === "before" ? -offset : offset);
  date = rollWeekend(date, direction);
  return { date, instant: fromLocalParts({ ...date, hour: anchor.hour, minute: anchor.minute, second: anchor.second }, session.timezone) };
}

function scheduleForDefinition(session: WebinarSession, definition: StandardDefinition) {
  if (definition.kind === "trigger") {
    const now = new Date();
    return { original: now, calculated: now, effective: now, localDate: null as string | null };
  }
  if (definition.kind === "elapsed") {
    const anchor = sessionAnchor(session);
    const calculated = new Date(anchor.getTime() + (definition.direction === "before" ? -1 : 1) * definition.offset * 60 * 60 * 1000);
    return { original: calculated, calculated, effective: calculated, localDate: partsInTimezone(calculated, session.timezone).toString() };
  }
  const target = calendarTarget(session, definition.offset, definition.direction === "after" ? "after" : "before");
  return {
    original: target.instant,
    calculated: target.instant,
    effective: target.instant,
    localDate: `${target.date.year}-${String(target.date.month).padStart(2, "0")}-${String(target.date.day).padStart(2, "0")}`,
  };
}

function launchDate(session: WebinarSession) {
  return session.recruitmentLaunchAt instanceof Date
    ? session.recruitmentLaunchAt
    : session.recruitmentLaunchAt
      ? new Date(session.recruitmentLaunchAt)
      : null;
}

function dateValue(value: Date | null) {
  return value?.toISOString() ?? null;
}

async function getConfig(session: WebinarSession, executor: any) {
  const [existing] = await executor.select().from(webinarStandardConfigs).where(eq(webinarStandardConfigs.sessionId, session.id));
  if (existing) return existing;
  const [created] = await executor.insert(webinarStandardConfigs).values({
    campaignId: session.campaignId,
    sessionId: session.id,
    pilotLimits: DEFAULT_WEBINAR_STANDARD_LIMITS,
    variants: DEFAULT_WEBINAR_STANDARD_VARIANTS,
  }).onConflictDoNothing({ target: webinarStandardConfigs.sessionId }).returning();
  if (created) return created;
  const [retried] = await executor.select().from(webinarStandardConfigs).where(eq(webinarStandardConfigs.sessionId, session.id));
  if (!retried) throw new WebinarStandardValidationError("Unable to initialize webinar standard configuration", 500);
  return retried;
}

async function createOrUpdateSchedule(
  session: WebinarSession,
  row: typeof webinarStandardCommunications.$inferSelect,
  executor: any,
) {
  const definition = definitionsForTemplate(session.templateVersion).find((candidate) => candidate.key === row.key);
  if (!definition) throw new WebinarStandardValidationError(`Unknown standard key ${row.key}`, 500);
  let rule = row.scheduleRuleId
    ? (await executor.select().from(scheduleRules).where(eq(scheduleRules.id, row.scheduleRuleId)))[0]
    : undefined;
  if (!rule) {
    if (!row.communicationId) throw new WebinarStandardValidationError(`Standard communication ${row.key} has no delivery identity`, 500);
    const [created] = await executor.insert(scheduleRules).values({
      campaignId: session.campaignId,
      activityId: session.activityId,
      communicationId: row.communicationId,
      anchorActivityId: session.activityId,
      offsetDays: definition.kind === "calendar" ? definition.offset : 0,
      offsetMinutes: definition.kind === "elapsed" ? definition.offset * 60 : 0,
      direction: definition.direction === "trigger" ? "after" : definition.direction,
      businessDayStrategy: definition.weekend === "previous_friday" ? "previous_business_day" : definition.weekend === "next_monday" ? "next_business_day" : "calendar",
      audienceLocalTimezone: true,
      timezone: session.timezone,
      targetSendTime: null,
      enabled: definition.kind !== "trigger",
    }).returning();
    rule = created;
    await executor.update(webinarStandardCommunications).set({ scheduleRuleId: rule.id, updatedAt: new Date() }).where(eq(webinarStandardCommunications.id, row.id));
  }

  // A trigger communication has no template-level timestamp.  Its send
  // instant belongs to each successful registration event below, not to one
  // shared session instance.
  if (definition.kind === "trigger") {
    const [updatedTrigger] = await executor.update(webinarStandardCommunications).set({
      originalScheduledAt: null,
      currentScheduledAt: null,
      effectiveScheduledAt: null,
      scheduleStatus: "awaiting_registration",
      skipReason: null,
      updatedAt: new Date(),
    }).where(eq(webinarStandardCommunications.id, row.id)).returning();
    return updatedTrigger ?? row;
  }

  const existing = (await executor.select().from(scheduledInstances).where(eq(scheduledInstances.ruleId, rule.id)))[0];
  let calculated = scheduleForDefinition(session, definition);
  const launch = launchDate(session);
  const skipped = definition.kind === "calendar" && definition.direction === "before" && launch && calculated.effective.getTime() < launch.getTime();
  const terminalSkipped = existing?.status === "skipped";
  const status = terminalSkipped ? "skipped" : skipped ? "skipped" : "scheduled";
  if (terminalSkipped) {
    calculated = {
      original: existing.originalCalculatedAt,
      calculated: existing.calculatedAt,
      effective: existing.adjustedAt ?? existing.calculatedAt,
      localDate: null,
    };
  }
  const skipReason = terminalSkipped
    ? row.skipReason
    : skipped
      ? `Adjusted recruitment date ${calculated.effective.toISOString()} is before webinar campaign launch ${launch!.toISOString()}`
      : null;
  let instance;
  if (!existing) {
    [instance] = await executor.insert(scheduledInstances).values({
      campaignId: session.campaignId,
      ruleId: rule.id,
      activityId: session.activityId,
      // schedule_rules and scheduled_instances deliberately retain the
      // legacy delivery identity (communications.id).  The standard row is
      // a configuration row and is not a valid value for the composite
      // campaign-scoped delivery FK.
      communicationId: rule.communicationId,
      originalCalculatedAt: calculated.original,
      calculatedAt: calculated.calculated,
      timezone: session.timezone,
      status,
    }).returning();
  } else {
    const changed = existing.calculatedAt.getTime() !== calculated.calculated.getTime() || existing.status !== status;
    if (changed) {
      await executor.insert(scheduledInstanceHistory).values({
        campaignId: existing.campaignId,
        scheduledInstanceId: existing.id,
        ruleId: existing.ruleId,
        anchorAt: sessionAnchor(session),
        previousCalculatedAt: existing.adjustedAt ?? existing.calculatedAt,
        calculatedAt: calculated.calculated,
        reason: "webinar standard schedule recomputed",
      });
      [instance] = await executor.update(scheduledInstances).set({
        calculatedAt: calculated.calculated,
        adjustedAt: null,
        adjustmentReason: null,
        status,
        timezone: session.timezone,
        rowVersion: existing.rowVersion + 1,
        updatedAt: new Date(),
      }).where(and(eq(scheduledInstances.id, existing.id), eq(scheduledInstances.rowVersion, existing.rowVersion))).returning();
    } else {
      instance = existing;
    }
  }
  if (!instance) throw new WebinarStandardValidationError("Unable to initialize webinar standard schedule instance", 500);
  const [updated] = await executor.update(webinarStandardCommunications).set({
    // This is the first rule calculation, never the latest anchor.  The
    // instance's originalCalculatedAt is the immutable audit source.
    originalScheduledAt: row.originalScheduledAt ?? (existing?.originalCalculatedAt ?? calculated.original),
    currentScheduledAt: instance.calculatedAt,
    effectiveScheduledAt: instance.adjustedAt ?? instance.calculatedAt,
    scheduleStatus: status,
    skipReason,
    updatedAt: new Date(),
  }).where(eq(webinarStandardCommunications.id, row.id)).returning();
  return updated ?? row;
}

/**
 * Idempotently creates all fixed communication rows, rules, and instances for
 * a webinar session. It is safe to call from every activity/session creation
 * path and from anchor recomputation.
 */
export async function ensureWebinarStandard(session: WebinarSession, executor: any = db) {
  const definitions = definitionsForTemplate(session.templateVersion);
  const config = await getConfig(session, executor);
  const variants = normalizeVariants(config.variants);
  const limits = normalizeLimits(config.pilotLimits);
  if (JSON.stringify(variants) !== JSON.stringify(config.variants) || JSON.stringify(limits) !== JSON.stringify(config.pilotLimits)) {
    await executor.update(webinarStandardConfigs).set({ variants, pilotLimits: limits, updatedAt: new Date() }).where(eq(webinarStandardConfigs.id, config.id));
  }
  for (const definition of definitions) {
    let [row] = await executor.select().from(webinarStandardCommunications).where(and(
      eq(webinarStandardCommunications.sessionId, session.id),
      eq(webinarStandardCommunications.key, definition.key),
    ));
    if (!row) {
      const [created] = await executor.insert(webinarStandardCommunications).values({
        campaignId: session.campaignId,
        sessionId: session.id,
        activityId: session.activityId,
        key: definition.key,
        name: definition.name,
         sortOrder: definitions.indexOf(definition),
        status: "DRAFT",
        audienceRule: definition.audience,
        timingKind: definition.kind,
        offsetValue: definition.offset,
        offsetUnit: definition.unit,
        direction: definition.direction,
        weekendAdjustment: definition.weekend,
        locked: true,
        variants: normalizeVariantContent([], session.campaignId, session.id, definition.key, variants),
      }).returning();
      row = created;
    } else {
      const normalizedContent = normalizeVariantContent(row.variants, session.campaignId, session.id, row.key, variants);
      if (JSON.stringify(normalizedContent) !== JSON.stringify(row.variants)) {
        [row] = await executor.update(webinarStandardCommunications).set({ variants: normalizedContent, updatedAt: new Date() }).where(eq(webinarStandardCommunications.id, row.id)).returning();
      }
    }
    let communicationId = row.communicationId;
    if (!communicationId && row.legacyCommunicationId) {
      const [legacy] = await executor.select({ id: communications.id }).from(communications).where(and(
        eq(communications.id, row.legacyCommunicationId),
        eq(communications.campaignId, session.campaignId),
      ));
      communicationId = legacy?.id;
    }
    if (!communicationId) {
      const [createdCommunication] = await executor.insert(communications).values({
        campaignId: session.campaignId,
        activityId: session.activityId,
        name: definition.name,
        type: "Email",
        timing: definition.kind === "trigger" ? "Immediate trigger" : `${definition.direction === "before" ? "-" : "+"}${definition.offset} ${definition.unit}`,
         sortOrder: definitions.indexOf(definition),
        status: "Estimated",
        owner: "Campaign team",
      }).returning({ id: communications.id });
      communicationId = createdCommunication?.id;
    }
    if (!communicationId) throw new WebinarStandardValidationError(`Unable to initialize delivery identity for ${definition.key}`, 500);
    const [existingDetail] = await executor.select({ id: communicationDetails.id })
      .from(communicationDetails)
      .where(eq(communicationDetails.communicationId, communicationId));
    if (!existingDetail) {
      let [audience] = await executor.select({ id: audiences.id })
        .from(audiences)
        .where(eq(audiences.campaignId, session.campaignId))
        .orderBy(asc(audiences.createdAt), asc(audiences.id));
      if (!audience) {
        const [campaign] = await executor.select({ region: campaigns.region })
          .from(campaigns)
          .where(eq(campaigns.id, session.campaignId));
        if (!campaign) throw new WebinarStandardValidationError("Campaign not found", 404);
        const [createdAudience] = await executor.insert(audiences).values({
          campaignId: session.campaignId,
          name: "Webinar audience",
          region: campaign.region,
        }).returning({ id: audiences.id });
        audience = createdAudience;
      }
      if (!audience) throw new WebinarStandardValidationError("Unable to initialize webinar audience branch", 500);
      await executor.insert(communicationDetails).values({
        communicationId,
        campaignId: session.campaignId,
        audienceBranchId: audience.id,
        communicationType: "Email",
        channel: "email",
        approvalStatus: "Not started",
        blockingDependencyTaskIds: [],
      }).onConflictDoNothing();
    }
    if (row.communicationId !== communicationId) {
      [row] = await executor.update(webinarStandardCommunications).set({ communicationId, updatedAt: new Date() }).where(eq(webinarStandardCommunications.id, row.id)).returning();
    }
    await createOrUpdateSchedule(session, row, executor);
  }
  const [freshConfig] = await executor.select().from(webinarStandardConfigs).where(eq(webinarStandardConfigs.id, config.id));
  return freshConfig ?? config;
}

function validationForContent(content: WebinarStandardContent, limits: WebinarStandardPilotLimits, requireFields: boolean) {
  const errors: Array<{ field: string; message: string }> = [];
  for (const field of contentFields) {
    const value = content[field];
    if (requireFields && !value.trim()) errors.push({ field, message: "Required for active variant" });
    if (Array.from(value).length > limits[field]) errors.push({ field, message: `Must be at most ${limits[field]} characters` });
  }
  return { valid: errors.length === 0, errors };
}

function localDate(value: Date | null, timezone: string) {
  if (!value) return null;
  const parts = partsInTimezone(value, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function standardResponse(
  config: typeof webinarStandardConfigs.$inferSelect,
  rows: typeof webinarStandardCommunications.$inferSelect[],
  timezone = "UTC",
  templateVersion = "legacy_9",
) {
  const resolvedTemplateVersion = templateVersionFor(templateVersion);
  const definitions = definitionsForTemplate(resolvedTemplateVersion);
  const variants = normalizeVariants(config.variants);
  return {
    ...webinarTemplateMetadata[resolvedTemplateVersion],
    templateConfig: { pilotLimits: normalizeLimits(config.pilotLimits), variants },
    communications: rows.sort((a, b) => a.sortOrder - b.sortOrder).map((row) => {
      const definition = definitions.find((candidate) => candidate.key === row.key)!;
      const scheduled = {
        status: row.scheduleStatus,
        originalAt: dateValue(row.originalScheduledAt),
        currentAt: dateValue(row.currentScheduledAt),
        effectiveAt: dateValue(row.effectiveScheduledAt),
        skipReason: row.skipReason,
      };
      const contentRows = normalizeVariantContent(row.variants, row.campaignId, row.sessionId, row.key, variants);
      return {
        id: row.id,
        key: row.key,
        name: definition?.name ?? row.name,
        sortOrder: row.sortOrder,
        status: row.status,
        timing: {
          kind: row.timingKind,
          offset: row.offsetValue,
          unit: row.offsetUnit,
          direction: row.direction,
          weekendAdjustment: row.weekendAdjustment,
          locked: row.locked,
        },
        scheduled,
        audienceRule: row.audienceRule,
        originalDate: localDate(row.originalScheduledAt, timezone),
        currentDate: localDate(row.currentScheduledAt, timezone),
        effectiveDate: localDate(row.effectiveScheduledAt, timezone),
        variants: contentRows.map((variant) => ({
          ...variant,
          validation: validationForContent(variant.content, normalizeLimits(config.pilotLimits), false),
        })),
        definition,
      };
    }),
  };
}

export async function standardForSession(campaignId: string, sessionId: string, executor: any = db) {
  const [session] = await executor.select().from(webinarSessions).where(and(eq(webinarSessions.id, sessionId), eq(webinarSessions.campaignId, campaignId)));
  if (!session) throw new WebinarStandardValidationError("Webinar session not found", 404);
  await ensureWebinarStandard(session, executor);
  const [config] = await executor.select().from(webinarStandardConfigs).where(eq(webinarStandardConfigs.sessionId, session.id));
  const rows = await executor.select().from(webinarStandardCommunications).where(eq(webinarStandardCommunications.sessionId, session.id)).orderBy(asc(webinarStandardCommunications.sortOrder));
  const templateVersion = templateVersionFor(session.templateVersion);
  const expectedDefinitions = definitionsForTemplate(templateVersion);
  if (!config || rows.length !== expectedDefinitions.length) throw new WebinarStandardValidationError("Webinar standard is incomplete", 500);
  return {
    campaignId,
    sessionId,
    activityId: session.activityId,
    launchAt: session.recruitmentLaunchAt?.toISOString() ?? null,
    ...standardResponse(config, rows, session.timezone, templateVersion),
  };
}

export async function patchStandard(campaignId: string, sessionId: string, input: unknown, executor: any = db): Promise<any> {
  const parsed = standardPatchSchema.safeParse(input);
  if (!parsed.success) throw new WebinarStandardValidationError(parsed.error.message);
  // Callers outside the HTTP route (including jobs and tests) get the same
  // all-or-nothing semantics as the route.  The route supplies its existing
  // transaction explicitly, so this does not nest transactions.
  if (executor === db) {
    return db.transaction((tx) => patchStandard(campaignId, sessionId, input, tx));
  }
  const [config] = await executor.select().from(webinarStandardConfigs)
    .where(eq(webinarStandardConfigs.sessionId, sessionId))
    .for("update");
  if (!config) throw new WebinarStandardValidationError("Webinar standard configuration not found", 500);
  await standardForSession(campaignId, sessionId, executor);
  if (parsed.data.launchAt !== undefined) {
    await executor.update(webinarSessions).set({ recruitmentLaunchAt: new Date(parsed.data.launchAt), updatedAt: new Date() }).where(and(eq(webinarSessions.id, sessionId), eq(webinarSessions.campaignId, campaignId)));
  }
  let variants = normalizeVariants(config.variants);
  let limits = normalizeLimits(config.pilotLimits);
  if (parsed.data.templateConfig?.variants) variants = normalizeVariants(parsed.data.templateConfig.variants);
  if (parsed.data.templateConfig?.pilotLimits) limits = normalizeLimits({ ...limits, ...parsed.data.templateConfig.pilotLimits });
  await executor.update(webinarStandardConfigs).set({ variants, pilotLimits: limits, updatedAt: new Date() }).where(eq(webinarStandardConfigs.id, config.id));

  for (const communication of parsed.data.communications ?? []) {
    const [row] = await executor.select().from(webinarStandardCommunications).where(and(eq(webinarStandardCommunications.sessionId, sessionId), eq(webinarStandardCommunications.key, communication.key)));
    if (!row) throw new WebinarStandardValidationError(`Unknown standard key ${communication.key}`);
    if (communication.timing !== undefined) throw new WebinarStandardValidationError(`Timing for ${communication.key} is fixed and cannot be edited`, 409);
    const patch: Partial<typeof webinarStandardCommunications.$inferInsert> = { updatedAt: new Date() };
    if (communication.status !== undefined) patch.status = communication.status;
    if (communication.variants) {
      const existing = new Map((row.variants as WebinarStandardVariantContent[]).map((item: WebinarStandardVariantContent) => [item.slot, item.content]));
      for (const variant of communication.variants) {
        if (!variants.some((candidate) => candidate.slot === variant.slot)) throw new WebinarStandardValidationError(`Variant slot ${variant.slot} is not defined`);
        const prior = existing.get(variant.slot) ?? emptyContent(campaignId, sessionId, communication.key, variant.slot);
        existing.set(variant.slot, { ...prior, ...variant.content });
      }
      patch.variants = variants.map((variant) => ({
        slot: variant.slot,
        content: {
          ...emptyContent(campaignId, sessionId, communication.key, variant.slot),
          ...(existing.get(variant.slot) ?? {}),
        },
      }));
    }
    await executor.update(webinarStandardCommunications).set(patch).where(eq(webinarStandardCommunications.id, row.id));
  }
  const [session] = await executor.select().from(webinarSessions).where(eq(webinarSessions.id, sessionId));
  if (!session) throw new WebinarStandardValidationError("Webinar session not found", 404);
  await ensureWebinarStandard(session, executor);
  return standardForSession(campaignId, sessionId, executor);
}

export async function triggerRegistrationConfirmation(
  campaignId: string,
  sessionId: string,
  personId: string,
  instant: Date,
  executor: any = db,
) {
  const [row] = await executor.select().from(webinarStandardCommunications).where(and(eq(webinarStandardCommunications.campaignId, campaignId), eq(webinarStandardCommunications.sessionId, sessionId), eq(webinarStandardCommunications.key, "registration_confirmation")));
  if (!row) return;
  await executor.insert(webinarStandardTriggerEvents).values({
    campaignId,
    sessionId,
    personId,
    standardCommunicationId: row.id,
    recordedAt: instant,
  });
}

export async function eligibilityForSession(campaignId: string, sessionId: string, executor: any = db) {
  const [session] = await executor.select().from(webinarSessions).where(and(eq(webinarSessions.id, sessionId), eq(webinarSessions.campaignId, campaignId)));
  if (!session) throw new WebinarStandardValidationError("Webinar session not found", 404);
  await ensureWebinarStandard(session, executor);
  const people = await executor.select().from(webinarPeople).where(eq(webinarPeople.campaignId, campaignId)).orderBy(asc(webinarPeople.name));
  const standardRows = await executor.select().from(webinarStandardCommunications)
    .where(eq(webinarStandardCommunications.sessionId, sessionId)) as typeof webinarStandardCommunications.$inferSelect[];
  const [registrations, attendance, triggerEvents] = await Promise.all([
    executor.select().from(webinarRegistrationResults).where(eq(webinarRegistrationResults.sessionId, sessionId)),
    executor.select().from(webinarAttendanceResults).where(eq(webinarAttendanceResults.sessionId, sessionId)),
    executor.select().from(webinarStandardTriggerEvents).where(eq(webinarStandardTriggerEvents.sessionId, sessionId)),
  ]) as [
    typeof webinarRegistrationResults.$inferSelect[],
    typeof webinarAttendanceResults.$inferSelect[],
    typeof webinarStandardTriggerEvents.$inferSelect[],
  ];
  const registrationByPerson = new Map<string, typeof webinarRegistrationResults.$inferSelect>(registrations.map((row) => [row.personId, row]));
  const attendanceByPerson = new Map<string, typeof webinarAttendanceResults.$inferSelect>(attendance.map((row) => [row.personId, row]));
  const latestTriggerByPerson = new Map<string, typeof webinarStandardTriggerEvents.$inferSelect>();
  for (const event of triggerEvents) {
    const previous = latestTriggerByPerson.get(event.personId);
    if (!previous || previous.recordedAt.getTime() < event.recordedAt.getTime()) latestTriggerByPerson.set(event.personId, event);
  }
  const rowByKey = new Map<string, typeof webinarStandardCommunications.$inferSelect>(standardRows.map((row) => [row.key, row]));
  const sessionKeys = definitionsForTemplate(templateVersionFor(session.templateVersion)).map((definition) => definition.key);
  const now = Date.now();
  const peopleRows = people.flatMap((person: typeof webinarPeople.$inferSelect) => {
    const registration = registrationByPerson.get(person.id);
    const attendanceResult = attendanceByPerson.get(person.id)?.result ?? null;
    const everRegistered = Boolean(registration?.firstRegisteredAt) || registration?.result === "registered";
    const currentRegistered = registration?.result === "registered";
    const triggerEvent = latestTriggerByPerson.get(person.id);
    return sessionKeys.map((key) => {
      const standardRow = rowByKey.get(key);
      const scheduledAt = standardRow?.effectiveScheduledAt?.getTime() ?? null;
      const skipped = standardRow?.scheduleStatus === "skipped";
      const historicalMiss = !skipped && key !== "registration_confirmation" && scheduledAt !== null && scheduledAt <= now;
      const audienceEligible =
        key === "registration_confirmation" ? currentRegistered && Boolean(triggerEvent) :
          key.startsWith("recruitment") || key === "final_recruitment" ? !everRegistered :
            key === "registered_reminder" || key === "final_reminder" ? currentRegistered :
              key === "attendee_followup" ? attendanceResult === "attended" :
                key === "no_show_followup" ? currentRegistered && attendanceResult === "no_show" : false;
      const eligible = audienceEligible && !skipped && !historicalMiss;
      const reason = eligible
        ? "Audience rule satisfied"
        : skipped
          ? standardRow?.skipReason ?? "Wave skipped by webinar schedule"
        : historicalMiss
          ? "Scheduled instant has elapsed; historical sends are not backfilled"
          : everRegistered && (key.startsWith("recruitment") || key === "final_recruitment")
            ? "Suppressed by successful registration history"
            : "Audience rule not satisfied";
      return {
        personId: person.id,
        communicationKey: key,
        eligible,
        status: eligible ? "eligible" : "suppressed",
        reason,
        eligibleAt: key === "registration_confirmation" && triggerEvent ? triggerEvent.recordedAt.toISOString() : null,
        registrationRecordedAt: registration?.recordedAt?.toISOString() ?? null,
        attendanceResult,
      };
    });
  });
  return { sessionId, people: peopleRows, externalSending: false };
}

export async function ensureWebinarForActivity(
  campaignId: string,
  activity: typeof activities.$inferSelect,
  setup: unknown,
  executor: any,
) {
  if (activity.type.toLowerCase() !== "webinar") return null;
  const [existing] = await executor.select().from(webinarSessions).where(and(eq(webinarSessions.campaignId, campaignId), eq(webinarSessions.activityId, activity.id)));
  if (!existing && setup === undefined) {
    throw new WebinarStandardValidationError("webinarSetup with event date, time, timezone, and recruitmentLaunchAt is required when creating a Webinar activity");
  }
  let session = existing;
  if (!session) {
    const parsed = webinarSetupSchema.safeParse(setup);
    if (!parsed.success) throw new WebinarStandardValidationError(parsed.error.message);
    const [created] = await executor.insert(webinarSessions).values({
      campaignId,
      activityId: activity.id,
      name: activity.name,
      sessionDate: parsed.data.eventDate,
      startTime: parsed.data.eventTime,
      durationMinutes: parsed.data.durationMinutes,
      timezone: parsed.data.timezone,
      platform: parsed.data.platform,
      speakers: parsed.data.speakers,
       recruitmentLaunchAt: new Date(parsed.data.recruitmentLaunchAt),
       templateVersion: DEFAULT_NEW_WEBINAR_TEMPLATE_VERSION,
      registrationRule: { suppressRecruitmentAfterRegistration: true, registeredBranch: "registered", attendedBranch: "attended", noShowBranch: "no_show" },
    }).returning();
    session = created;
  }
  if (!session) throw new WebinarStandardValidationError("Unable to initialize webinar session", 500);
  await ensureWebinarStandard(session, executor);
  return session;
}

export function contentValidation(
  content: WebinarStandardContent,
  limits: WebinarStandardPilotLimits,
  requireFields = false,
) {
  return validationForContent(content, limits, requireFields);
}

export function calculateStandardSchedule(
  session: Pick<WebinarSession, "sessionDate" | "startTime" | "timezone" | "recruitmentLaunchAt">,
  key: string,
  templateVersion: WebinarTemplateVersion = "legacy_9",
) {
  const definition = definitionsForTemplate(templateVersion).find((candidate) => candidate.key === key);
  if (!definition) throw new WebinarStandardValidationError(`Unknown standard key ${key}`);
  return scheduleForDefinition(session as WebinarSession, definition);
}

export { contentFields, definitionByKey };