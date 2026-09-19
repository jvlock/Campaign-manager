import { and, asc, eq, inArray } from "drizzle-orm";
import { activityTasks, audiences, campaigns, communications, db, webinarSessions } from "@workspace/db";
import { communicationDetails } from "@workspace/db/schema/communication-details";
import { z } from "zod";
import { assertTimezone, instanceResponse, recomputeForAnchor } from "./planning";
import { ensureWebinarStandard } from "./webinar-standard";
import { countTasks, implementationTaskResponse } from "./implementation-tasks";
import { GOVERNED_CHANNELS } from "./activity-model";

export class DeliveryValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DeliveryValidationError";
    this.status = status;
  }
}

const qaFields = {
  qaAudienceConfirmed: z.boolean().optional(),
  qaContentApproved: z.boolean().optional(),
  qaLinksVerified: z.boolean().optional(),
  qaTimingVerified: z.boolean().optional(),
  qaOwnerConfirmed: z.boolean().optional(),
};

export const communicationDetailsInputSchema = z.object({
  audienceBranchId: z.string().uuid().optional(),
  communicationType: z.string().trim().min(1).optional(),
  channel: z.string().trim().min(1).nullable().optional(),
  approvalStatus: z.string().trim().min(1).optional(),
  ...qaFields,
  blockingDependencyTaskIds: z.array(z.string().uuid()).optional(),
  blockingDependencyIds: z.array(z.string().uuid()).optional(),
});

export const communicationDetailsResponseSchema = z.object({
  audienceBranchId: z.string().uuid(),
  communicationType: z.string(),
  channel: z.string().nullable(),
  approvalStatus: z.string(),
  qaAudienceConfirmed: z.boolean(),
  qaContentApproved: z.boolean(),
  qaLinksVerified: z.boolean(),
  qaTimingVerified: z.boolean(),
  qaOwnerConfirmed: z.boolean(),
  blockingDependencyTaskIds: z.array(z.string().uuid()),
  blockingDependencyIds: z.array(z.string().uuid()),
});

function detailResponse(row: typeof communicationDetails.$inferSelect) {
  return communicationDetailsResponseSchema.parse({
    audienceBranchId: row.audienceBranchId,
    communicationType: row.communicationType,
    channel: row.channel,
    approvalStatus: row.approvalStatus,
    qaAudienceConfirmed: row.qaAudienceConfirmed,
    qaContentApproved: row.qaContentApproved,
    qaLinksVerified: row.qaLinksVerified,
    qaTimingVerified: row.qaTimingVerified,
    qaOwnerConfirmed: row.qaOwnerConfirmed,
    blockingDependencyTaskIds: row.blockingDependencyTaskIds,
    blockingDependencyIds: row.blockingDependencyTaskIds,
  });
}

function communicationResponse(
  row: typeof communications.$inferSelect,
  detail?: typeof communicationDetails.$inferSelect,
) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    activityId: row.activityId,
    name: row.name,
    type: row.type,
    timing: row.timing,
    sortOrder: row.sortOrder,
    status: row.status,
    owner: row.owner,
    ...(detail ? detailResponse(detail) : {}),
  };
}

const taskResponse = implementationTaskResponse;

export async function deliveryFor(campaignId: string) {
  const [communicationRows, taskRows] = await Promise.all([
    db
      .select({ communication: communications, detail: communicationDetails })
      .from(communications)
      .leftJoin(communicationDetails, eq(communicationDetails.communicationId, communications.id))
      .where(eq(communications.campaignId, campaignId))
      .orderBy(asc(communications.sortOrder), asc(communications.createdAt)),
    db
      .select()
      .from(activityTasks)
      .where(eq(activityTasks.campaignId, campaignId))
      .orderBy(asc(activityTasks.sortOrder), asc(activityTasks.createdAt)),
  ]);

  return {
    communications: communicationRows.map(({ communication, detail }) => communicationResponse(communication, detail ?? undefined)),
    tasks: await Promise.all(taskRows.map(taskResponse)),
    taskCounts: countTasks(taskRows),
  };
}

export async function communicationDetailFor(communicationId: string) {
  const [row] = await db
    .select()
    .from(communicationDetails)
    .where(eq(communicationDetails.communicationId, communicationId));
  return row;
}

async function audienceBranchFor(campaignId: string, audienceBranchId?: string, executor: any = db) {
  if (audienceBranchId) {
    const [branch] = await executor
      .select()
      .from(audiences)
      .where(and(eq(audiences.id, audienceBranchId), eq(audiences.campaignId, campaignId)));
    if (!branch) throw new DeliveryValidationError("Audience branch does not belong to this campaign");
    return branch.id;
  }
  const [existing] = await executor
    .select({ id: audiences.id })
    .from(audiences)
    .where(eq(audiences.campaignId, campaignId))
    .orderBy(asc(audiences.createdAt), asc(audiences.id));
  if (existing) return existing.id;
  const [campaign] = await executor.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new Error("Campaign not found");
  const [created] = await executor
    .insert(audiences)
    .values({ campaignId, name: campaign.audience, region: campaign.region })
    .returning({ id: audiences.id });
  if (!created) throw new Error("Unable to create campaign audience branch");
  return created.id;
}

async function validateBlockingDependencies(campaignId: string, taskIds: string[], executor: any = db) {
  if (!taskIds.length) return;
  const rows = await executor
    .select({ id: activityTasks.id })
    .from(activityTasks)
    .where(and(eq(activityTasks.campaignId, campaignId), inArray(activityTasks.id, taskIds)));
  if (rows.length !== new Set(taskIds).size) {
    throw new DeliveryValidationError("Every blocking dependency must reference an activity task in this campaign");
  }
}

/**
 * Insert or patch only the extension row.  The parent communication is never
 * rewritten by this helper, which preserves user edits to legacy fields.
 */
export async function saveCommunicationDetails(
  parent: typeof communications.$inferSelect,
  input: z.input<typeof communicationDetailsInputSchema> = {},
  executor: any = db,
) {
  const parsed = communicationDetailsInputSchema.parse(input);
  const blockingDependencyTaskIds = parsed.blockingDependencyTaskIds ?? parsed.blockingDependencyIds ?? [];
  await validateBlockingDependencies(parent.campaignId, blockingDependencyTaskIds, executor);
  const audienceBranchId = await audienceBranchFor(parent.campaignId, parsed.audienceBranchId, executor);
  const [existing] = await executor
    .select()
    .from(communicationDetails)
    .where(eq(communicationDetails.communicationId, parent.id));
  if (parsed.channel !== undefined && parsed.channel !== null) {
    const isCanonical = GOVERNED_CHANNELS.some((channel) => channel.id === parsed.channel);
    const unchangedLegacy = existing?.channel === parsed.channel;
    if (!isCanonical && !unchangedLegacy) {
      throw new DeliveryValidationError(`channel must be one of: ${GOVERNED_CHANNELS.map((channel) => channel.id).join(", ")}`);
    }
  }
  if (existing) {
    const patch: Partial<typeof communicationDetails.$inferInsert> = { updatedAt: new Date() };
    if (parsed.audienceBranchId !== undefined) patch.audienceBranchId = audienceBranchId;
    if (parsed.communicationType !== undefined) patch.communicationType = parsed.communicationType;
    if (parsed.channel !== undefined) patch.channel = parsed.channel;
    if (parsed.approvalStatus !== undefined) patch.approvalStatus = parsed.approvalStatus;
    for (const field of Object.keys(qaFields) as Array<keyof typeof qaFields>) {
      if (parsed[field] !== undefined) patch[field] = parsed[field] as never;
    }
    if (parsed.blockingDependencyTaskIds !== undefined || parsed.blockingDependencyIds !== undefined) {
      patch.blockingDependencyTaskIds = blockingDependencyTaskIds;
    }
    const [updated] = await executor
      .update(communicationDetails)
      .set(patch)
      .where(eq(communicationDetails.communicationId, parent.id))
      .returning();
    return updated;
  }
  const [created] = await executor
    .insert(communicationDetails)
    .values({
      communicationId: parent.id,
      campaignId: parent.campaignId,
      audienceBranchId,
      communicationType: parsed.communicationType ?? parent.type,
      channel: parsed.channel ?? null,
      approvalStatus:
        parsed.approvalStatus ??
        (parent.status === "Confirmed" ? "Approved" : parent.status === "Decision needed" ? "Needs review" : "Not started"),
      qaAudienceConfirmed: parsed.qaAudienceConfirmed ?? false,
      qaContentApproved: parsed.qaContentApproved ?? false,
      qaLinksVerified: parsed.qaLinksVerified ?? false,
      qaTimingVerified: parsed.qaTimingVerified ?? false,
      qaOwnerConfirmed: parsed.qaOwnerConfirmed ?? false,
      blockingDependencyTaskIds,
    })
    .returning();
  return created;
}

export async function validateCommunicationDetailsInput(
  campaignId: string,
  input: z.input<typeof communicationDetailsInputSchema> = {},
  executor: any = db,
) {
  const parsed = communicationDetailsInputSchema.parse(input);
  await validateBlockingDependencies(campaignId, parsed.blockingDependencyTaskIds ?? parsed.blockingDependencyIds ?? [], executor);
  await audienceBranchFor(campaignId, parsed.audienceBranchId, executor);
  return parsed;
}

export async function recomputeWebinarDeliveryAnchor(input: {
  campaignId: string;
  activityId: string;
  sessionDate: string;
  startTime: string;
  timezone: string;
  durationMinutes: number;
  executor?: any;
}) {
  /*
   * Session date/startTime are a wall-clock value in the session's IANA
   * timezone. Convert that value to an instant before handing it to the
   * shared planning core. Passing a bare ISO string would incorrectly make
   * the host timezone the webinar timezone.
   */
  assertTimezone(input.timezone);
  const [year, month, day] = input.sessionDate.split("-").map(Number);
  const [hour, minute] = input.startTime.split(":").map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute);
  let anchor = new Date(wallClockUtc);
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: input.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(anchor)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;
    const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    anchor = new Date(wallClockUtc - (localAsUtc - anchor.getTime()));
  }

  const instances = await recomputeForAnchor(
    input.activityId,
    anchor,
    input.timezone,
    "webinar session anchor changed",
    input.executor,
  );
  const executor = input.executor ?? db;
  const [session] = await executor
    .select()
    .from(webinarSessions)
    .where(and(
      eq(webinarSessions.campaignId, input.campaignId),
      eq(webinarSessions.activityId, input.activityId),
    ));
  if (session) {
    await ensureWebinarStandard(session, executor);
  }
  const rows = await executor
    .select({ id: communications.id })
    .from(communications)
    .where(and(eq(communications.campaignId, input.campaignId), eq(communications.activityId, input.activityId)));
  return {
    campaignId: input.campaignId,
    activityId: input.activityId,
    communicationIds: rows.map((row: { id: string }) => row.id),
    anchor: input,
    anchorAt: anchor.toISOString(),
    scheduledInstances: instances.filter(Boolean).map((row: any) => instanceResponse(row)),
    externalSending: false,
  };
}

export { communicationResponse, detailResponse, taskResponse };