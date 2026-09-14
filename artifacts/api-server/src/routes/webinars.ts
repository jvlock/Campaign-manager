import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { activities, audiences, campaigns, db } from "@workspace/db";
import {
  webinarAttendanceResults,
  webinarPeople,
  webinarRegistrationResults,
  webinarSessions,
} from "@workspace/db/schema/webinar";
import {
  attendanceResultSchema,
  evaluateWebinarPerson,
  evaluateWebinarSession,
  peopleForCampaign,
  registrationResultSchema,
  sessionResponse,
  syntheticPersonInputSchema,
  webinarInputSchema,
  webinarUpdateSchema,
  WebinarValidationError,
  webinarForCampaign,
} from "../lib/webinar";
import { recomputeWebinarDeliveryAnchor } from "../lib/delivery";

const router: IRouter = Router();
const idParams = z.object({ id: z.string().uuid() });
const sessionParams = z.object({ id: z.string().uuid(), sessionId: z.string().uuid() });
const personParams = sessionParams.extend({ personId: z.string().uuid() });

async function campaignExists(campaignId: string) {
  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId));
  return Boolean(campaign);
}

async function activityBelongsToCampaign(activityId: string, campaignId: string) {
  const [activity] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.campaignId, campaignId)));
  return Boolean(activity);
}

async function sessionForCampaign(campaignId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(webinarSessions)
    .where(and(eq(webinarSessions.id, sessionId), eq(webinarSessions.campaignId, campaignId)));
  if (!session) throw new WebinarValidationError("Webinar session not found", 404);
  return session;
}

async function personForCampaign(campaignId: string, personId: string) {
  const [person] = await db
    .select()
    .from(webinarPeople)
    .where(and(eq(webinarPeople.id, personId), eq(webinarPeople.campaignId, campaignId)));
  if (!person) throw new WebinarValidationError("Synthetic webinar person not found", 404);
  return person;
}

async function audienceBranchFor(campaignId: string, requestedId?: string) {
  if (requestedId) {
    const [branch] = await db
      .select({ id: audiences.id })
      .from(audiences)
      .where(and(eq(audiences.id, requestedId), eq(audiences.campaignId, campaignId)));
    if (!branch) throw new WebinarValidationError("Audience branch does not belong to this campaign");
    return branch.id;
  }
  const [existing] = await db
    .select({ id: audiences.id })
    .from(audiences)
    .where(eq(audiences.campaignId, campaignId))
    .orderBy(asc(audiences.createdAt), asc(audiences.id));
  if (existing) return existing.id;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new WebinarValidationError("Campaign not found", 404);
  const [created] = await db
    .insert(audiences)
    .values({ campaignId, name: campaign.audience, region: campaign.region })
    .returning({ id: audiences.id });
  if (!created) throw new WebinarValidationError("Unable to create campaign audience branch", 500);
  return created.id;
}

function reportError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof WebinarValidationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number") {
    res.status(error.statusCode).json({ error: error instanceof Error ? error.message : "Invalid webinar schedule" });
    return;
  }
  next(error);
}

router.get("/campaigns/:id/webinars", async (req, res, next): Promise<void> => {
  try {
    const parsed = idParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (!(await campaignExists(parsed.data.id))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json(await webinarForCampaign(parsed.data.id));
  } catch (error) {
    reportError(error, res, next);
  }
});

router.post("/campaigns/:id/webinars", async (req, res, next): Promise<void> => {
  try {
    const parsedParams = idParams.safeParse(req.params);
    const parsedBody = webinarInputSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      const error = !parsedParams.success
        ? parsedParams.error.message
        : !parsedBody.success
          ? parsedBody.error.message
          : "Invalid webinar input";
      res.status(400).json({ error });
      return;
    }
    const campaignId = parsedParams.data.id;
    const body = parsedBody.data;
    if (!(await campaignExists(campaignId))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (!(await activityBelongsToCampaign(body.activityId, campaignId))) {
      res.status(400).json({ error: "Activity does not belong to this campaign" });
      return;
    }
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(webinarSessions)
        .values({ ...body, campaignId })
        .returning();
      if (!created) throw new WebinarValidationError("Unable to create webinar session", 500);
      await recomputeWebinarDeliveryAnchor({
        campaignId,
        activityId: created.activityId,
        sessionDate: created.sessionDate,
        startTime: created.startTime,
        timezone: created.timezone,
        durationMinutes: created.durationMinutes,
        executor: tx,
      });
      return created;
    });
    res.status(201).json(sessionResponse(row));
  } catch (error) {
    reportError(error, res, next);
  }
});

router.get("/campaigns/:id/webinars/:sessionId", async (req, res, next): Promise<void> => {
  try {
    const parsed = sessionParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json(sessionResponse(await sessionForCampaign(parsed.data.id, parsed.data.sessionId)));
  } catch (error) {
    reportError(error, res, next);
  }
});

router.patch("/campaigns/:id/webinars/:sessionId", async (req, res, next): Promise<void> => {
  try {
    const parsedParams = sessionParams.safeParse(req.params);
    const parsedBody = webinarUpdateSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      const error = !parsedParams.success
        ? parsedParams.error.message
        : !parsedBody.success
          ? parsedBody.error.message
          : "Invalid webinar update";
      res.status(400).json({ error });
      return;
    }
    const { id: campaignId, sessionId } = parsedParams.data;
    await sessionForCampaign(campaignId, sessionId);
    const body = parsedBody.data;
    if (body.activityId !== undefined && !(await activityBelongsToCampaign(body.activityId, campaignId))) {
      res.status(400).json({ error: "Activity does not belong to this campaign" });
      return;
    }
    const patch: Partial<typeof webinarSessions.$inferInsert> = { updatedAt: new Date() };
    if (body.activityId !== undefined) patch.activityId = body.activityId;
    if (body.name !== undefined) patch.name = body.name;
    if (body.sessionDate !== undefined) patch.sessionDate = body.sessionDate;
    if (body.startTime !== undefined) patch.startTime = body.startTime;
    if (body.durationMinutes !== undefined) patch.durationMinutes = body.durationMinutes;
    if (body.timezone !== undefined) patch.timezone = body.timezone;
    if (body.platform !== undefined) patch.platform = body.platform;
    if (body.speakers !== undefined) patch.speakers = body.speakers;
    if (body.registrationRule !== undefined) patch.registrationRule = body.registrationRule;
    const anchorChanged =
      body.activityId !== undefined ||
      body.sessionDate !== undefined ||
      body.startTime !== undefined ||
      body.durationMinutes !== undefined ||
      body.timezone !== undefined;
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(webinarSessions)
        .set(patch)
        .where(and(eq(webinarSessions.id, sessionId), eq(webinarSessions.campaignId, campaignId)))
        .returning();
      if (!updated) throw new WebinarValidationError("Webinar session not found", 404);
      if (anchorChanged) {
        await recomputeWebinarDeliveryAnchor({
          campaignId,
          activityId: updated.activityId,
          sessionDate: updated.sessionDate,
          startTime: updated.startTime,
          timezone: updated.timezone,
          durationMinutes: updated.durationMinutes,
          executor: tx,
        });
      }
      return updated;
    });
    res.json(sessionResponse(row));
  } catch (error) {
    reportError(error, res, next);
  }
});

router.get("/campaigns/:id/webinars/:sessionId/people", async (req, res, next): Promise<void> => {
  try {
    const parsed = sessionParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    await sessionForCampaign(parsed.data.id, parsed.data.sessionId);
    res.json(await peopleForCampaign(parsed.data.id));
  } catch (error) {
    reportError(error, res, next);
  }
});

router.post("/campaigns/:id/webinars/:sessionId/people", async (req, res, next): Promise<void> => {
  try {
    const parsedParams = sessionParams.safeParse(req.params);
    const parsedBody = syntheticPersonInputSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      const error = !parsedParams.success
        ? parsedParams.error.message
        : !parsedBody.success
          ? parsedBody.error.message
          : "Invalid synthetic person input";
      res.status(400).json({ error });
      return;
    }
    const { id: campaignId, sessionId } = parsedParams.data;
    await sessionForCampaign(campaignId, sessionId);
    const body = parsedBody.data;
    const audienceBranchId = await audienceBranchFor(campaignId, body.audienceBranchId);
    const [person] = await db
      .insert(webinarPeople)
      .values({ campaignId, audienceBranchId, name: body.name, isSynthetic: true })
      .returning();
    if (!person) throw new WebinarValidationError("Unable to create synthetic webinar person", 500);
    res.status(201).json({
      id: person.id,
      campaignId: person.campaignId,
      audienceBranchId: person.audienceBranchId,
      name: person.name,
      isSynthetic: person.isSynthetic,
    });
  } catch (error) {
    reportError(error, res, next);
  }
});

async function recordRegistration(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsedParams = personParams.safeParse(req.params);
  const parsedBody = registrationResultSchema.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    const error = !parsedParams.success
      ? parsedParams.error.message
      : !parsedBody.success
        ? parsedBody.error.message
        : "Invalid registration result";
    res.status(400).json({ error });
    return;
  }
  const { id: campaignId, sessionId, personId } = parsedParams.data;
  await sessionForCampaign(campaignId, sessionId);
  await personForCampaign(campaignId, personId);
  await db
    .insert(webinarRegistrationResults)
    .values({ campaignId, sessionId, personId, result: parsedBody.data.result, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [webinarRegistrationResults.sessionId, webinarRegistrationResults.personId],
      set: { result: parsedBody.data.result, recordedAt: new Date(), updatedAt: new Date() },
    });
  res.json(await evaluateWebinarPerson(campaignId, sessionId, personId));
}

async function recordAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsedParams = personParams.safeParse(req.params);
  const parsedBody = attendanceResultSchema.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    const error = !parsedParams.success
      ? parsedParams.error.message
      : !parsedBody.success
        ? parsedBody.error.message
        : "Invalid attendance result";
    res.status(400).json({ error });
    return;
  }
  const { id: campaignId, sessionId, personId } = parsedParams.data;
  await sessionForCampaign(campaignId, sessionId);
  await personForCampaign(campaignId, personId);
  await db
    .insert(webinarAttendanceResults)
    .values({ campaignId, sessionId, personId, result: parsedBody.data.result, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [webinarAttendanceResults.sessionId, webinarAttendanceResults.personId],
      set: { result: parsedBody.data.result, recordedAt: new Date(), updatedAt: new Date() },
    });
  res.json(await evaluateWebinarPerson(campaignId, sessionId, personId));
}

router.post("/campaigns/:id/webinars/:sessionId/people/:personId/registration", async (req, res, next): Promise<void> => {
  try {
    await recordRegistration(req, res, next);
  } catch (error) {
    reportError(error, res, next);
  }
});

router.post("/campaigns/:id/webinars/:sessionId/people/:personId/attendance", async (req, res, next): Promise<void> => {
  try {
    await recordAttendance(req, res, next);
  } catch (error) {
    reportError(error, res, next);
  }
});

router.get("/campaigns/:id/webinars/:sessionId/evaluation", async (req, res, next): Promise<void> => {
  try {
    const parsed = sessionParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json(await evaluateWebinarSession(parsed.data.id, parsed.data.sessionId));
  } catch (error) {
    reportError(error, res, next);
  }
});

router.post("/campaigns/:id/webinars/:sessionId/evaluate", async (req, res, next): Promise<void> => {
  try {
    const parsed = sessionParams.safeParse(req.params);
    const person = z.object({ personId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success || !person.success) {
      const error = !parsed.success
        ? parsed.error.message
        : !person.success
          ? person.error.message
          : "Invalid webinar evaluation input";
      res.status(400).json({ error });
      return;
    }
    res.json(await evaluateWebinarPerson(parsed.data.id, parsed.data.sessionId, person.data.personId));
  } catch (error) {
    reportError(error, res, next);
  }
});

export default router;