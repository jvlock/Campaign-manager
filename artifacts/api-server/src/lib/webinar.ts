import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  webinarAttendanceResults,
  webinarPeople,
  webinarRegistrationResults,
  webinarSessions,
} from "@workspace/db/schema/webinar";
import { GOVERNED_CHANNELS } from "./activity-model";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const sessionDateSchema = z
  .string()
  .regex(datePattern, "sessionDate must be YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "sessionDate must be a valid calendar date");
const timezoneSchema = z.string().trim().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "timezone must be a valid IANA timezone");

export const speakerSchema = z.object({
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).optional(),
  organization: z.string().trim().min(1).optional(),
});

export const registrationRuleSchema = z.object({
  suppressRecruitmentAfterRegistration: z.boolean().default(true),
  registeredBranch: z.string().trim().min(1).default("registered"),
  attendedBranch: z.string().trim().min(1).default("attended"),
  noShowBranch: z.string().trim().min(1).default("no_show"),
});

export const webinarInputSchema = z.object({
  activityId: z.string().uuid(),
  name: z.string().trim().min(1),
  sessionDate: sessionDateSchema,
  startTime: z.string().regex(timePattern, "startTime must be HH:mm"),
  durationMinutes: z.number().int().positive().max(1440),
  timezone: timezoneSchema,
  platform: z.string().trim().min(1),
  recruitmentLaunchAt: z.string().datetime({ offset: true }),
  channel: z.string().refine(
    (value) => GOVERNED_CHANNELS.some((candidate) => candidate.id === value),
    { message: "channel must be a canonical governed channel ID" },
  ).nullable().optional(),
  speakers: z.array(speakerSchema).default([]),
  registrationRule: registrationRuleSchema.default({
    suppressRecruitmentAfterRegistration: true,
    registeredBranch: "registered",
    attendedBranch: "attended",
    noShowBranch: "no_show",
  }),
});

export const webinarUpdateSchema = webinarInputSchema
  .omit({ activityId: true })
  .partial()
  .extend({ activityId: z.string().uuid().optional() });

export const syntheticPersonInputSchema = z.object({
  name: z.string().trim().min(1),
  audienceBranchId: z.string().uuid().optional(),
  isSynthetic: z.literal(true).default(true),
}).strict();

export const registrationResultSchema = z.object({
  result: z.enum(["registered", "not_registered"]),
});

export const attendanceResultSchema = z.object({
  result: z.enum(["attended", "no_show"]),
});

export const webinarBranchSchema = z.enum(["not_registered", "registered", "attended", "no_show"]);

export class WebinarValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WebinarValidationError";
    this.status = status;
  }
}

function asDateString(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function asTimeString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  return value.slice(0, 5);
}

function parsedRule(value: unknown) {
  return registrationRuleSchema.parse(value ?? { suppressRecruitmentAfterRegistration: true });
}

export function sessionResponse(row: typeof webinarSessions.$inferSelect) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    activityId: row.activityId,
    name: row.name,
    sessionDate: asDateString(row.sessionDate),
    startTime: asTimeString(row.startTime),
    durationMinutes: row.durationMinutes,
    timezone: row.timezone,
    platform: row.platform,
    recruitmentLaunchAt: row.recruitmentLaunchAt?.toISOString() ?? null,
    speakers: speakerSchema.array().parse(row.speakers),
    registrationRule: parsedRule(row.registrationRule),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function personResponse(row: typeof webinarPeople.$inferSelect) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    audienceBranchId: row.audienceBranchId,
    name: row.name,
    isSynthetic: row.isSynthetic,
  };
}

export async function webinarForCampaign(campaignId: string) {
  const rows = await db
    .select()
    .from(webinarSessions)
    .where(eq(webinarSessions.campaignId, campaignId))
    .orderBy(asc(webinarSessions.sessionDate), asc(webinarSessions.startTime), asc(webinarSessions.createdAt));
  return rows.map(sessionResponse);
}

export async function peopleForCampaign(campaignId: string) {
  const rows = await db
    .select()
    .from(webinarPeople)
    .where(eq(webinarPeople.campaignId, campaignId))
    .orderBy(asc(webinarPeople.name), asc(webinarPeople.createdAt));
  return rows.map(personResponse);
}

async function sessionAndPerson(campaignId: string, sessionId: string, personId: string) {
  const [[session], [person]] = await Promise.all([
    db
      .select()
      .from(webinarSessions)
      .where(and(eq(webinarSessions.id, sessionId), eq(webinarSessions.campaignId, campaignId))),
    db
      .select()
      .from(webinarPeople)
      .where(and(eq(webinarPeople.id, personId), eq(webinarPeople.campaignId, campaignId))),
  ]);
  if (!session) throw new WebinarValidationError("Webinar session not found", 404);
  if (!person) throw new WebinarValidationError("Synthetic webinar person not found", 404);
  return { session, person };
}

/**
 * Evaluate planning branches from separately recorded registration and
 * attendance facts.  This function only returns a plan; it never sends or
 * queues a communication.
 */
export async function evaluateWebinarPerson(campaignId: string, sessionId: string, personId: string) {
  const { session, person } = await sessionAndPerson(campaignId, sessionId, personId);
  const [[registration], [attendance]] = await Promise.all([
    db
      .select()
      .from(webinarRegistrationResults)
      .where(
        and(
          eq(webinarRegistrationResults.campaignId, campaignId),
          eq(webinarRegistrationResults.sessionId, sessionId),
          eq(webinarRegistrationResults.personId, personId),
        ),
      ),
    db
      .select()
      .from(webinarAttendanceResults)
      .where(
        and(
          eq(webinarAttendanceResults.campaignId, campaignId),
          eq(webinarAttendanceResults.sessionId, sessionId),
          eq(webinarAttendanceResults.personId, personId),
        ),
      ),
  ]);

  const registrationResult = registration?.result ?? "not_registered";
  const attendanceResult = attendance?.result ?? null;
  const branch = attendanceResult === "attended"
    ? "attended"
    : attendanceResult === "no_show"
      ? "no_show"
      : registrationResult === "registered"
        ? "registered"
        : "not_registered";
  const rule = parsedRule(session.registrationRule);
  const recruitmentSuppressed =
    (Boolean(registration?.firstRegisteredAt) || registrationResult === "registered") &&
    rule.suppressRecruitmentAfterRegistration;

  return {
    person: personResponse(person),
    sessionId: session.id,
    registrationResult,
    attendanceResult,
    branch: webinarBranchSchema.parse(branch),
    recruitmentSuppressed,
    plannedAction:
      branch === "attended"
        ? "Plan attendee follow-up"
        : branch === "no_show"
          ? "Plan recording follow-up"
          : branch === "registered"
            ? "Hold recruitment; await attendance"
            : recruitmentSuppressed
              ? "Hold recruitment; prior successful registration is permanent"
              : "Eligible for recruitment planning",
    externalSending: false,
  };
}

export async function evaluateWebinarSession(campaignId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(webinarSessions)
    .where(and(eq(webinarSessions.id, sessionId), eq(webinarSessions.campaignId, campaignId)));
  if (!session) throw new WebinarValidationError("Webinar session not found", 404);
  const people = await db
    .select({ id: webinarPeople.id })
    .from(webinarPeople)
    .where(eq(webinarPeople.campaignId, campaignId))
    .orderBy(asc(webinarPeople.id));
  return Promise.all(people.map((person) => evaluateWebinarPerson(campaignId, sessionId, person.id)));
}

export type WebinarAnchor = Pick<
  typeof webinarSessions.$inferInsert,
  "sessionDate" | "startTime" | "timezone" | "durationMinutes"
>;