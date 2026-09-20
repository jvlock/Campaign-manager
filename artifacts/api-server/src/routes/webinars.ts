import { and, asc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { activities, audiences, campaigns, db, DEFAULT_NEW_WEBINAR_TEMPLATE_VERSION } from "@workspace/db";
import {
  ActivityModelError,
  assertNoSuppliedGeneratedIdentity,
} from "../lib/activity-model";
import {
  webinarAttendanceResults,
  webinarPeople,
  webinarRegistrationResults,
  webinarSessions,
} from "@workspace/db/schema/webinar";
import { webinarStandardCommunications } from "@workspace/db/schema/webinar-standard";
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
import {
  WebinarStandardValidationError,
  eligibilityForSession,
  ensureWebinarStandard,
  setWebinarCommunicationChannel,
  patchStandard,
  standardForSession,
  triggerRegistrationConfirmation,
} from "../lib/webinar-standard";
import { canonicalCtasForCommunication, communicationReadinessFor, DeliverableError } from "../lib/deliverables";
import {
  assertNoFinalityRequest,
  GovernanceQuarantineError,
  PROVISIONAL_GOVERNANCE,
} from "../lib/governance-quarantine";

const router: IRouter = Router();
const idParams = z.object({ id: z.string().uuid() });
const sessionParams = z.object({ id: z.string().uuid(), sessionId: z.string().uuid() });
const personParams = sessionParams.extend({ personId: z.string().uuid() });

async function campaignExists(campaignId: string) {
  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId));
  return Boolean(campaign);
}

async function governedWebinarActivity(activityId: string, campaignId: string) {
  const [activity] = await db
    .select({
      id: activities.id,
      name: activities.name,
      generatedName: activities.generatedName,
      activityTypeId: activities.activityTypeId,
    })
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.campaignId, campaignId)));
  return activity
    && ["webinar", "events"].includes(activity.activityTypeId ?? "")
    && activity.generatedName === activity.name
    ? activity
    : null;
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
  if (error instanceof ActivityModelError) {
    res.status(400).json({ error: { field: error.field, code: error.code, message: error.message } });
    return;
  }
  if (error instanceof WebinarValidationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof WebinarStandardValidationError) {
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
    assertNoSuppliedGeneratedIdentity(req.body, { includeId: true, path: "webinar" });
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
    const governedActivity = await governedWebinarActivity(body.activityId, campaignId);
    if (!governedActivity) {
      res.status(400).json({ error: "Webinar sessions require a governed activity; names and codes are generated, not supplied" });
      return;
    }
    const row = await db.transaction(async (tx) => {
      const { channel, ...sessionInput } = body;
      const [created] = await tx
        .insert(webinarSessions)
        .values({
          ...sessionInput,
          campaignId,
          name: governedActivity.name,
          recruitmentLaunchAt: new Date(body.recruitmentLaunchAt),
          templateVersion: DEFAULT_NEW_WEBINAR_TEMPLATE_VERSION,
        })
        .returning();
      if (!created) throw new WebinarValidationError("Unable to create webinar session", 500);
       await ensureWebinarStandard(created, tx);
      if (channel !== undefined) await setWebinarCommunicationChannel(created.id, channel, tx);
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
    assertNoSuppliedGeneratedIdentity(req.body, { includeId: true, path: "webinar" });
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
    if (body.activityId !== undefined && !(await governedWebinarActivity(body.activityId, campaignId))) {
      res.status(400).json({ error: "Webinar sessions require a governed activity; names and codes are generated, not supplied" });
      return;
    }
    const patch: Partial<typeof webinarSessions.$inferInsert> = { updatedAt: new Date() };
    if (body.activityId !== undefined) patch.activityId = body.activityId;
    if (body.sessionDate !== undefined) patch.sessionDate = body.sessionDate;
    if (body.startTime !== undefined) patch.startTime = body.startTime;
    if (body.durationMinutes !== undefined) patch.durationMinutes = body.durationMinutes;
    if (body.timezone !== undefined) patch.timezone = body.timezone;
    if (body.platform !== undefined) patch.platform = body.platform;
    if (body.speakers !== undefined) patch.speakers = body.speakers;
    if (body.registrationRule !== undefined) patch.registrationRule = body.registrationRule;
    if (body.recruitmentLaunchAt !== undefined) patch.recruitmentLaunchAt = new Date(body.recruitmentLaunchAt);
    const anchorChanged =
      body.activityId !== undefined ||
      body.sessionDate !== undefined ||
      body.startTime !== undefined ||
      body.durationMinutes !== undefined ||
      body.timezone !== undefined ||
      body.recruitmentLaunchAt !== undefined;
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
       await ensureWebinarStandard(updated, tx);
      if (body.channel !== undefined) await setWebinarCommunicationChannel(updated.id, body.channel, tx);
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
  const recordedAt = new Date();
  await db.transaction(async (tx) => {
    // Serialize state transitions for one person.  This prevents concurrent
    // registrations from both observing the same prior state and emitting
    // duplicate confirmation events.
    await tx.select({ id: webinarPeople.id })
      .from(webinarPeople)
      .where(and(eq(webinarPeople.id, personId), eq(webinarPeople.campaignId, campaignId)))
      .for("update");
    const [previous] = await tx.select({ result: webinarRegistrationResults.result })
      .from(webinarRegistrationResults)
      .where(and(
        eq(webinarRegistrationResults.sessionId, sessionId),
        eq(webinarRegistrationResults.personId, personId),
      ));
    await tx
      .insert(webinarRegistrationResults)
      .values({
        campaignId,
        sessionId,
        personId,
        result: parsedBody.data.result,
        recordedAt,
        firstRegisteredAt: parsedBody.data.result === "registered" ? recordedAt : null,
        updatedAt: recordedAt,
      })
      .onConflictDoUpdate({
        target: [webinarRegistrationResults.sessionId, webinarRegistrationResults.personId],
        set: {
          result: parsedBody.data.result,
          recordedAt,
          updatedAt: recordedAt,
          firstRegisteredAt: parsedBody.data.result === "registered"
            ? sql`coalesce(${webinarRegistrationResults.firstRegisteredAt}, ${recordedAt})`
            : sql`${webinarRegistrationResults.firstRegisteredAt}`,
        },
      });
    const [session] = await tx.select().from(webinarSessions).where(eq(webinarSessions.id, sessionId));
    if (session) {
      await ensureWebinarStandard(session, tx);
      if (parsedBody.data.result === "registered" && previous?.result !== "registered") {
        await triggerRegistrationConfirmation(campaignId, sessionId, personId, recordedAt, tx);
      }
    }
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

router.get("/campaigns/:id/webinars/:sessionId/standard", async (req, res, next): Promise<void> => {
  try {
    const parsed = sessionParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json({
      ...(await standardForSession(parsed.data.id, parsed.data.sessionId)),
      governance: PROVISIONAL_GOVERNANCE,
    });
  } catch (error) {
    reportError(error, res, next);
  }
});

router.patch("/campaigns/:id/webinars/:sessionId/standard", async (req, res, next): Promise<void> => {
  try {
    const parsed = sessionParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const patched = await db.transaction((tx) =>
      patchStandard(parsed.data.id, parsed.data.sessionId, req.body, tx),
    );
    res.json({ ...patched, governance: PROVISIONAL_GOVERNANCE });
  } catch (error) {
    reportError(error, res, next);
  }
});

router.get("/campaigns/:id/webinars/:sessionId/standard/eligibility", async (req, res, next): Promise<void> => {
  try {
    const parsed = sessionParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json(await eligibilityForSession(parsed.data.id, parsed.data.sessionId));
  } catch (error) {
    reportError(error, res, next);
  }
});

router.get("/campaigns/:id/webinars/:sessionId/standard/export", async (req, res, next): Promise<void> => {
  try {
    assertNoFinalityRequest(req.query, "query");
    const parsed = sessionParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const standard = await standardForSession(parsed.data.id, parsed.data.sessionId);
    const standardRows = await db.select().from(webinarStandardCommunications)
      .where(and(
        eq(webinarStandardCommunications.campaignId, parsed.data.id),
        eq(webinarStandardCommunications.sessionId, parsed.data.sessionId),
      ));
    const canonicalByKey = new Map<string, Awaited<ReturnType<typeof canonicalCtasForCommunication>>>();
    for (const row of standardRows) {
      if (!row.communicationId) continue;
      const readiness = await communicationReadinessFor(parsed.data.id, row.communicationId);
      if (readiness.dependencyReadiness === "Blocked") {
        const unavailableDestination = readiness.blockers.find((blocker: any) =>
          blocker.code === "landing_page_destination_unavailable" || blocker.code === "cta_destination_unavailable");
        if (unavailableDestination) {
          throw new DeliverableError(
            unavailableDestination.entityType === "landingPage" ? "publishedUrl" : "destinationUrl",
            "destination_unavailable",
            unavailableDestination.entityType === "landingPage"
              ? `Webinar communication ${row.name} requires a Published landing page with a valid HTTP(S) publishedUrl`
              : `Webinar communication ${row.name} has a CTA without a valid HTTP(S) destinationUrl`,
            409,
          );
        }
        throw new DeliverableError(
          "dependencies",
          "communication_blocked",
          `Webinar communication ${row.name} is blocked by unpublished build dependencies`,
          409,
        );
      }
      canonicalByKey.set(row.key, await canonicalCtasForCommunication(parsed.data.id, row.communicationId));
    }
    const activeVariants = standard.templateConfig.variants.filter((variant) => variant.inUse);
    const errors: Array<{ key: string; slot: number; field: string; message: string }> = [];
    const communications = standard.communications
      .filter((communication) => communication.scheduled.status !== "skipped")
      .map((communication) => {
        const canonical = canonicalByKey.get(communication.key) ?? [];
        return {
          ...communication,
          ctas: canonical.map(({ legacySourceKey: _legacySourceKey, ...cta }) => cta),
          variants: communication.variants.filter((variant) => {
            const config = activeVariants.find((candidate) => candidate.slot === variant.slot);
            return Boolean(config?.inUse);
          }).map((variant) => {
            const standardRow = standardRows.find((row) => row.key === communication.key);
            const sourceKey = standardRow ? `webinar:${standardRow.id}:variant:${variant.slot}` : "";
            const projected = canonical.find((cta) => cta.legacySourceKey === sourceKey) ?? canonical[0];
            return projected ? {
              ...variant,
              content: { ...variant.content, ctaLabel: projected.buttonText, ctaUrl: projected.destinationUrl },
            } : variant;
          }),
        };
      });
    for (const variant of activeVariants) {
      for (const communication of communications) {
        const communicationVariant = communication.variants.find((candidate) => candidate.slot === variant.slot);
        if (!communicationVariant) {
          errors.push({ key: communication.key, slot: variant.slot, field: "content", message: "Content is required for every active variant" });
          continue;
        }
        const content = communicationVariant.content;
        for (const field of ["subject", "preheader", "hero", "body", "ctaLabel", "ctaUrl", "internalAssetName"] as const) {
          if (!content[field]?.trim()) errors.push({ key: communication.key, slot: variant.slot, field, message: "Required for active variant" });
          if (Array.from(content[field]).length > standard.templateConfig.pilotLimits[field]) {
            errors.push({ key: communication.key, slot: variant.slot, field, message: `Must be at most ${standard.templateConfig.pilotLimits[field]} characters` });
          }
        }
      }
      for (const field of ["audienceDefinition", "messageAngle", "valueProposition"] as const) {
        if (!variant[field].trim()) {
          errors.push({ key: "*", slot: variant.slot, field, message: "Required for active variant" });
        }
      }
    }
    if (errors.length) {
      res.status(422).type("application/json").json({ error: "Standard webinar export validation failed", errors });
      return;
    }
    res.type("application/json").json({
      governance: PROVISIONAL_GOVERNANCE,
      exportMode: "provisional_local_download",
      externalPublishing: false,
      campaignId: standard.campaignId,
      sessionId: standard.sessionId,
      launchAt: standard.launchAt,
      communications: communications.flatMap((communication) => communication.variants.map((variant) => {
        const config = activeVariants.find((candidate) => candidate.slot === variant.slot)!;
        return {
          governance: PROVISIONAL_GOVERNANCE,
          key: communication.key,
          sortOrder: communication.sortOrder,
          timing: communication.timing,
          audienceRule: communication.audienceRule,
            ctas: communication.ctas,
          ...(communication.timing.kind === "trigger" ? {} : { scheduled: communication.scheduled }),
          variant: {
            ...config,
            content: variant.content,
          },
        };
      })),
    });
  } catch (error) {
    if (error instanceof GovernanceQuarantineError) {
      res.status(error.status).json({ error: { field: error.field, code: error.code, message: error.message } });
      return;
    }
    reportError(error, res, next);
  }
});

export default router;