import { Router, type IRouter } from "express";
import { and, eq, or } from "drizzle-orm";
import {
  CreateActivityTaskBody,
  CreateActivityTaskParams,
  CreateActivityTaskResponse,
  CreateCommunicationBody,
  CreateCommunicationParams,
  CreateCommunicationResponse,
  GetCampaignDeliveryParams,
  GetCampaignDeliveryResponse,
  UpdateActivityTaskBody,
  UpdateActivityTaskParams,
  UpdateActivityTaskResponse,
  UpdateCommunicationBody,
  UpdateCommunicationParams,
  UpdateCommunicationResponse,
} from "@workspace/api-zod";
import {
  activities,
  activityTasks,
  campaigns,
  communications,
  db,
  webinarStandardCommunications,
} from "@workspace/db";
import {
  communicationDetailsInputSchema,
  communicationResponse,
  DeliveryValidationError,
  deliveryFor,
  saveCommunicationDetails,
  taskResponse,
  validateCommunicationDetailsInput,
} from "../lib/delivery";

const router: IRouter = Router();
import { validateTaskFields, syncCapacityConflicts, TaskValidationError } from "../lib/implementation-tasks";

async function campaignExists(campaignId: string) {
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  return Boolean(campaign);
}

async function activityBelongsToCampaign(activityId: string, campaignId: string) {
  const [activity] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.campaignId, campaignId)));
  return Boolean(activity);
}

async function standardCommunicationFor(campaignId: string, communicationId: string) {
  const [row] = await db.select({ id: webinarStandardCommunications.id })
    .from(webinarStandardCommunications)
    .where(and(
      eq(webinarStandardCommunications.campaignId, campaignId),
      or(
        eq(webinarStandardCommunications.id, communicationId),
        eq(webinarStandardCommunications.communicationId, communicationId),
      ),
    ));
  return row;
}

router.get("/campaigns/:id/delivery", async (req, res, next): Promise<void> => {
  try {
    const parsedParams = GetCampaignDeliveryParams.safeParse(req.params);
    if (!parsedParams.success) {
      req.log.warn({ errors: parsedParams.error.message }, "Invalid campaign delivery path");
      res.status(400).json({ error: parsedParams.error.message });
      return;
    }
    const campaignId = parsedParams.data.id;
    if (!(await campaignExists(campaignId))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json(await deliveryFor(campaignId));
  } catch (error) {
    if (error instanceof DeliveryValidationError) res.status(error.status).json({ error: error.message });
    else next(error);
  }
});

router.post("/campaigns/:id/communications", async (req, res, next): Promise<void> => {
  try {
    const parsedParams = CreateCommunicationParams.safeParse(req.params);
    const parsedBody = CreateCommunicationBody.safeParse(req.body);
    const parsedDetails = communicationDetailsInputSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success || !parsedDetails.success) {
      let errorMessage = "Invalid communication input";
      if (!parsedParams.success) errorMessage = parsedParams.error.message;
      else if (!parsedBody.success) errorMessage = parsedBody.error.message;
      else if (!parsedDetails.success) errorMessage = parsedDetails.error.message;
      req.log.warn({ errors: errorMessage }, "Invalid communication input");
      res.status(400).json({ error: errorMessage });
      return;
    }
    const campaignId = parsedParams.data.id;
    const body = parsedBody.data;
    const details = parsedDetails.data;
    if (!(await campaignExists(campaignId))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (!(await activityBelongsToCampaign(body.activityId, campaignId))) {
      res.status(400).json({ error: "Activity does not belong to this campaign" });
      return;
    }
    const response = await db.transaction(async (tx) => {
      await validateCommunicationDetailsInput(campaignId, details, tx);
      const [row] = await tx
        .insert(communications)
        .values({
          campaignId,
          activityId: body.activityId,
          name: body.name,
          type: body.type,
          timing: body.timing,
          sortOrder: body.sortOrder,
          status: body.status,
          owner: body.owner,
        })
        .returning();
      if (!row) throw new DeliveryValidationError("Unable to create communication", 500);
      const detail = await saveCommunicationDetails(row, details, tx);
      return communicationResponse(row, detail);
    });
    res.status(201).json(response);
  } catch (error) {
    if (error instanceof DeliveryValidationError) res.status(error.status).json({ error: error.message });
    else next(error);
  }
});

router.patch("/campaigns/:id/communications/:itemId", async (req, res, next): Promise<void> => {
  try {
    const parsedParams = UpdateCommunicationParams.safeParse(req.params);
    const parsedBody = UpdateCommunicationBody.safeParse(req.body);
    const parsedDetails = communicationDetailsInputSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success || !parsedDetails.success) {
      let errorMessage = "Invalid communication update";
      if (!parsedParams.success) errorMessage = parsedParams.error.message;
      else if (!parsedBody.success) errorMessage = parsedBody.error.message;
      else if (!parsedDetails.success) errorMessage = parsedDetails.error.message;
      req.log.warn({ errors: errorMessage }, "Invalid communication update");
      res.status(400).json({ error: errorMessage });
      return;
    }
    const { id: campaignId, itemId } = parsedParams.data;
    const body = parsedBody.data;
    const details = parsedDetails.data;
    if (!(await campaignExists(campaignId))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (await standardCommunicationFor(campaignId, itemId)) {
      res.status(409).json({ error: "Standard webinar communications are managed by the webinar standard endpoint" });
      return;
    }
    const [existing] = await db
      .select()
      .from(communications)
      .where(and(eq(communications.id, itemId), eq(communications.campaignId, campaignId)));
    if (!existing) {
      res.status(404).json({ error: "Communication not found" });
      return;
    }
    if (body.activityId !== undefined && !(await activityBelongsToCampaign(body.activityId, campaignId))) {
      res.status(400).json({ error: "Activity does not belong to this campaign" });
      return;
    }

    const patch: Partial<typeof communications.$inferInsert> = { updatedAt: new Date() };
    if (body.activityId !== undefined) patch.activityId = body.activityId;
    if (body.name !== undefined) patch.name = body.name;
    if (body.type !== undefined) patch.type = body.type;
    if (body.timing !== undefined) patch.timing = body.timing;
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
    if (body.status !== undefined) patch.status = body.status;
    if (body.owner !== undefined) patch.owner = body.owner;

    const response = await db.transaction(async (tx) => {
      await validateCommunicationDetailsInput(campaignId, details, tx);
      const [row] = await tx
        .update(communications)
        .set(patch)
        .where(and(eq(communications.id, itemId), eq(communications.campaignId, campaignId)))
        .returning();
      if (!row) throw new DeliveryValidationError("Communication not found", 404);
      const detail = await saveCommunicationDetails(row, details, tx);
      return communicationResponse(row, detail);
    });
    res.json(response);
  } catch (error) {
    if (error instanceof DeliveryValidationError) res.status(error.status).json({ error: error.message });
    else next(error);
  }
});

router.delete("/campaigns/:id/communications/:itemId", async (req, res, next): Promise<void> => {
  try {
    if (await standardCommunicationFor(req.params.id, req.params.itemId)) {
      res.status(409).json({ error: "Standard webinar communications cannot be deleted" });
      return;
    }
    const [deleted] = await db.delete(communications).where(and(
      eq(communications.id, req.params.itemId),
      eq(communications.campaignId, req.params.id),
    )).returning({ id: communications.id });
    if (!deleted) {
      res.status(404).json({ error: "Communication not found" });
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/campaigns/:id/tasks", async (req, res, next): Promise<void> => {
  try {
    const fields = validateTaskFields(req.body);
    const parsedParams = CreateActivityTaskParams.safeParse(req.params);
    const parsedBody = CreateActivityTaskBody.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      let errorMessage = "Invalid activity task input";
      if (!parsedParams.success) errorMessage = parsedParams.error.message;
      else if (!parsedBody.success) errorMessage = parsedBody.error.message;
      req.log.warn({ errors: errorMessage }, "Invalid activity task input");
      res.status(400).json({ error: errorMessage });
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

    const [row] = await db
      .insert(activityTasks)
      .values({
        ...fields,
        campaignId,
        activityId: body.activityId,
        name: body.name,
        type: body.type,
        timing: body.timing,
        sortOrder: body.sortOrder,
        status: body.status,
        owner: body.owner,
      })
      .returning();
    await syncCapacityConflicts();
    res.status(201).json(CreateActivityTaskResponse.parse(await taskResponse(row)));
  } catch (error) {
    if (error instanceof TaskValidationError) res.status(400).json({ error: error.message });
    else next(error);
  }
});

router.patch("/campaigns/:id/tasks/:itemId", async (req, res, next): Promise<void> => {
  try {
    const parsedParams = UpdateActivityTaskParams.safeParse(req.params);
    const parsedBody = UpdateActivityTaskBody.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      let errorMessage = "Invalid activity task update";
      if (!parsedParams.success) errorMessage = parsedParams.error.message;
      else if (!parsedBody.success) errorMessage = parsedBody.error.message;
      req.log.warn({ errors: errorMessage }, "Invalid activity task update");
      res.status(400).json({ error: errorMessage });
      return;
    }
    const { id: campaignId, itemId } = parsedParams.data;
    const body = parsedBody.data;
    if (!(await campaignExists(campaignId))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(activityTasks)
      .where(and(eq(activityTasks.id, itemId), eq(activityTasks.campaignId, campaignId)));
    if (!existing) {
      res.status(404).json({ error: "Activity task not found" });
      return;
    }
    if (body.activityId !== undefined && !(await activityBelongsToCampaign(body.activityId, campaignId))) {
      res.status(400).json({ error: "Activity does not belong to this campaign" });
      return;
    }

    const patch: Partial<typeof activityTasks.$inferInsert> = { ...validateTaskFields(req.body, existing), updatedAt: new Date() };
    if (body.activityId !== undefined) patch.activityId = body.activityId;
    if (body.name !== undefined) patch.name = body.name;
    if (body.type !== undefined) patch.type = body.type;
    if (body.timing !== undefined) patch.timing = body.timing;
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
    if (body.status !== undefined) patch.status = body.status;
    if (body.owner !== undefined) patch.owner = body.owner;

    const [row] = await db
      .update(activityTasks)
      .set(patch)
      .where(and(eq(activityTasks.id, itemId), eq(activityTasks.campaignId, campaignId)))
      .returning();
    await syncCapacityConflicts();
    res.json(UpdateActivityTaskResponse.parse(await taskResponse(row)));
  } catch (error) {
    if (error instanceof TaskValidationError) res.status(400).json({ error: error.message });
    else next(error);
  }
});

export default router;