import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  assets,
  campaigns,
  communicationCtas,
  communicationLandingPages,
  communications,
  ctas,
  db,
  landingPageContentAssets,
  landingPages,
} from "@workspace/db";
import {
  assertCampaignDeliverablesReady,
  communicationDependenciesSchema,
  contentAssetCreateSchema,
  contentAssetPatchSchema,
  ctaCreateSchema,
  ctaPatchSchema,
  deliverablesFor,
  DeliverableError,
  invalidateBlockedReleases,
  landingPageCreateSchema,
  landingPagePatchSchema,
  releaseCommunication,
  saveCommunicationDependencies,
} from "../lib/deliverables";

const router: IRouter = Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function report(error: unknown, res: any, next: any) {
  if (error instanceof DeliverableError) {
    res.status(error.status).json({ error: { field: error.field, code: error.code, message: error.message } });
  } else next(error);
}

function ids(req: any) {
  const { id, deliverableId, itemId } = req.params;
  if (!uuidPattern.test(id)) throw new DeliverableError("id", "invalid_uuid", "Campaign ID must be a UUID");
  if (deliverableId && !uuidPattern.test(deliverableId)) throw new DeliverableError("deliverableId", "invalid_uuid", "Deliverable ID must be a UUID");
  if (itemId && !uuidPattern.test(itemId)) throw new DeliverableError("itemId", "invalid_uuid", "Communication ID must be a UUID");
  return { campaignId: id, deliverableId, communicationId: itemId };
}

async function requireCampaign(campaignId: string, executor: any = db) {
  const [campaign] = await executor.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new DeliverableError("campaignId", "not_found", "Campaign not found", 404);
}

async function lockCampaign(campaignId: string, executor: any) {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${campaignId}))`);
}

function parse<T>(schema: any, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DeliverableError(issue?.path?.join(".") || "body", "invalid_input", issue?.message || "Invalid input");
  }
  return parsed.data as T;
}

router.get("/campaigns/:id/deliverables", async (req, res, next) => {
  try {
    const { campaignId } = ids(req);
    await requireCampaign(campaignId);
    res.json(await deliverablesFor(campaignId));
  } catch (error) { report(error, res, next); }
});

router.post("/campaigns/:id/ctas", async (req, res, next) => {
  try {
    const { campaignId } = ids(req);
    const body = parse<any>(ctaCreateSchema, req.body);
    const row = await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      await requireCampaign(campaignId, tx);
      if (body.landingPageId) {
        const [page] = await tx.select({ id: landingPages.id }).from(landingPages)
          .where(and(eq(landingPages.id, body.landingPageId), eq(landingPages.campaignId, campaignId)));
        if (!page) throw new DeliverableError("landingPageId", "cross_campaign_or_missing", "Landing page must belong to this campaign");
      }
      const [created] = await tx.insert(ctas).values({
        campaignId, name: body.name, buttonText: body.buttonText,
        landingPageId: body.landingPageId ?? null, destinationUrl: body.destinationUrl ?? null,
        owner: body.owner, status: body.status, publishBy: body.publishBy,
      }).returning();
      return created;
    });
    const all = await deliverablesFor(campaignId);
    res.status(201).json(all.ctas.find((item: any) => item.id === row.id));
  } catch (error) { report(error, res, next); }
});

router.post("/campaigns/:id/communications/:itemId/ctas", async (req, res, next) => {
  try {
    const { campaignId, communicationId } = ids(req);
    const body = parse<any>(ctaCreateSchema, req.body);
    const createdId = await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      const [communication] = await tx.select({ id: communications.id }).from(communications)
        .where(and(eq(communications.id, communicationId), eq(communications.campaignId, campaignId)));
      if (!communication) throw new DeliverableError("itemId", "not_found", "Communication not found", 404);
      if (body.landingPageId) {
        const [page] = await tx.select({ id: landingPages.id }).from(landingPages)
          .where(and(eq(landingPages.id, body.landingPageId), eq(landingPages.campaignId, campaignId)));
        if (!page) throw new DeliverableError("landingPageId", "cross_campaign_or_missing", "Landing page must belong to this campaign");
      }
      const [created] = await tx.insert(ctas).values({
        campaignId, name: body.name, buttonText: body.buttonText,
        landingPageId: body.landingPageId ?? null, destinationUrl: body.destinationUrl ?? null,
        owner: body.owner, status: body.status, publishBy: body.publishBy,
      }).returning();
      await tx.insert(communicationCtas).values({ campaignId, communicationId, ctaId: created.id });
      await invalidateBlockedReleases(campaignId, tx);
      return created.id;
    });
    const all = await deliverablesFor(campaignId);
    res.status(201).json(all.ctas.find((item: any) => item.id === createdId));
  } catch (error) { report(error, res, next); }
});

router.patch("/campaigns/:id/ctas/:deliverableId", async (req, res, next) => {
  try {
    const { campaignId, deliverableId } = ids(req);
    const body = parse<any>(ctaPatchSchema, req.body);
    const row = await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      const [existing] = await tx.select().from(ctas).where(and(eq(ctas.id, deliverableId), eq(ctas.campaignId, campaignId)));
      if (!existing) throw new DeliverableError("deliverableId", "not_found", "CTA not found", 404);
      const landingPageId = body.landingPageId !== undefined ? body.landingPageId : existing.landingPageId;
      const destinationUrl = body.destinationUrl !== undefined ? body.destinationUrl : existing.destinationUrl;
      if (Boolean(landingPageId) === Boolean(destinationUrl)) {
        throw new DeliverableError("destination", "exactly_one_required", "Exactly one of landingPageId or destinationUrl is required");
      }
      if (landingPageId) {
        const [page] = await tx.select({ id: landingPages.id }).from(landingPages)
          .where(and(eq(landingPages.id, landingPageId), eq(landingPages.campaignId, campaignId)));
        if (!page) throw new DeliverableError("landingPageId", "cross_campaign_or_missing", "Landing page must belong to this campaign");
      }
      const patch: any = { ...body, landingPageId, destinationUrl, updatedAt: new Date() };
      const [updated] = await tx.update(ctas).set(patch).where(eq(ctas.id, existing.id)).returning();
      await invalidateBlockedReleases(campaignId, tx);
      return updated;
    });
    const all = await deliverablesFor(campaignId);
    res.json(all.ctas.find((item: any) => item.id === row.id));
  } catch (error) { report(error, res, next); }
});

router.delete("/campaigns/:id/ctas/:deliverableId", async (req, res, next) => {
  try {
    const { campaignId, deliverableId } = ids(req);
    await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      const linked = await tx.select({ communicationId: communicationCtas.communicationId }).from(communicationCtas)
        .where(and(eq(communicationCtas.campaignId, campaignId), eq(communicationCtas.ctaId, deliverableId)));
      if (linked.length) throw new DeliverableError("deliverableId", "deliverable_referenced", `CTA is linked to ${linked.length} communication(s); detach it before deletion`, 409);
      const [deleted] = await tx.delete(ctas).where(and(eq(ctas.id, deliverableId), eq(ctas.campaignId, campaignId))).returning();
      if (!deleted) throw new DeliverableError("deliverableId", "not_found", "CTA not found", 404);
      await invalidateBlockedReleases(campaignId, tx);
    });
    res.status(204).end();
  } catch (error) { report(error, res, next); }
});

async function savePageAssets(campaignId: string, landingPageId: string, ids: string[], tx: any) {
  const distinct = [...new Set(ids)];
  if (distinct.length !== ids.length) throw new DeliverableError("contentAssetIds", "duplicate_reference", "contentAssetIds must not contain duplicate IDs");
  if (distinct.length) {
    const found = await tx.select({ id: assets.id }).from(assets)
      .where(and(eq(assets.campaignId, campaignId), inArray(assets.id, distinct)));
    if (found.length !== distinct.length) throw new DeliverableError("contentAssetIds", "cross_campaign_or_missing", "Every content asset must belong to this campaign");
  }
  await tx.delete(landingPageContentAssets).where(and(
    eq(landingPageContentAssets.campaignId, campaignId),
    eq(landingPageContentAssets.landingPageId, landingPageId),
  ));
  if (distinct.length) await tx.insert(landingPageContentAssets).values(
    distinct.map((contentAssetId) => ({ campaignId, landingPageId, contentAssetId })),
  );
}

router.post("/campaigns/:id/landing-pages", async (req, res, next) => {
  try {
    const { campaignId } = ids(req);
    const body = parse<any>(landingPageCreateSchema, req.body);
    const row = await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      await requireCampaign(campaignId, tx);
      const [created] = await tx.insert(landingPages).values({
        campaignId, name: body.name, headline: body.headline,
        supportingCopyNeeds: body.supportingCopyNeeds,
        personalizationRequirements: body.personalizationRequirements,
        owner: body.owner, status: body.status, publishBy: body.publishBy, url: body.publishedUrl,
      }).returning();
      await savePageAssets(campaignId, created.id, body.contentAssetIds, tx);
      return created;
    });
    const all = await deliverablesFor(campaignId);
    res.status(201).json(all.landingPages.find((item: any) => item.id === row.id));
  } catch (error) { report(error, res, next); }
});

router.post("/campaigns/:id/communications/:itemId/landing-pages", async (req, res, next) => {
  try {
    const { campaignId, communicationId } = ids(req);
    const body = parse<any>(landingPageCreateSchema, req.body);
    const createdId = await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      const [communication] = await tx.select({ id: communications.id }).from(communications)
        .where(and(eq(communications.id, communicationId), eq(communications.campaignId, campaignId)));
      if (!communication) throw new DeliverableError("itemId", "not_found", "Communication not found", 404);
      const [created] = await tx.insert(landingPages).values({
        campaignId, name: body.name, headline: body.headline,
        supportingCopyNeeds: body.supportingCopyNeeds,
        personalizationRequirements: body.personalizationRequirements,
        owner: body.owner, status: body.status, publishBy: body.publishBy, url: body.publishedUrl,
      }).returning();
      await savePageAssets(campaignId, created.id, body.contentAssetIds, tx);
      await tx.insert(communicationLandingPages).values({ campaignId, communicationId, landingPageId: created.id });
      await invalidateBlockedReleases(campaignId, tx);
      return created.id;
    });
    const all = await deliverablesFor(campaignId);
    res.status(201).json(all.landingPages.find((item: any) => item.id === createdId));
  } catch (error) { report(error, res, next); }
});

router.patch("/campaigns/:id/landing-pages/:deliverableId", async (req, res, next) => {
  try {
    const { campaignId, deliverableId } = ids(req);
    const body = parse<any>(landingPagePatchSchema, req.body);
    const row = await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      const [existing] = await tx.select().from(landingPages).where(and(eq(landingPages.id, deliverableId), eq(landingPages.campaignId, campaignId)));
      if (!existing) throw new DeliverableError("deliverableId", "not_found", "Landing page not found", 404);
      const { contentAssetIds, publishedUrl, ...values } = body;
      const nextStatus = values.status ?? existing.status;
      const nextUrl = publishedUrl !== undefined ? publishedUrl : existing.url;
      let hasValidPublishedUrl = false;
      try {
        hasValidPublishedUrl = Boolean(nextUrl && /^https?:$/i.test(new URL(nextUrl).protocol));
      } catch {
        hasValidPublishedUrl = false;
      }
      if (nextStatus === "Published" && !hasValidPublishedUrl) {
        throw new DeliverableError("publishedUrl", "published_url_required", "publishedUrl is required when status is Published");
      }
      const [updated] = await tx.update(landingPages).set({
        ...values,
        ...(publishedUrl !== undefined ? { url: publishedUrl } : {}),
        updatedAt: new Date(),
      }).where(eq(landingPages.id, existing.id)).returning();
      if (contentAssetIds !== undefined) await savePageAssets(campaignId, existing.id, contentAssetIds, tx);
      await invalidateBlockedReleases(campaignId, tx);
      return updated;
    });
    const all = await deliverablesFor(campaignId);
    res.json(all.landingPages.find((item: any) => item.id === row.id));
  } catch (error) { report(error, res, next); }
});

router.delete("/campaigns/:id/landing-pages/:deliverableId", async (req, res, next) => {
  try {
    const { campaignId, deliverableId } = ids(req);
    await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      const ctaLinks = await tx.select({ id: ctas.id }).from(ctas)
        .where(and(eq(ctas.campaignId, campaignId), eq(ctas.landingPageId, deliverableId)));
      const directLinks = await tx.select({ id: communicationLandingPages.communicationId }).from(communicationLandingPages)
        .where(and(eq(communicationLandingPages.campaignId, campaignId), eq(communicationLandingPages.landingPageId, deliverableId)));
      if (ctaLinks.length || directLinks.length) throw new DeliverableError(
        "deliverableId", "deliverable_referenced",
        `Landing page is referenced by ${ctaLinks.length} CTA(s) and ${directLinks.length} direct communication link(s); detach them before deletion`, 409,
      );
      await tx.delete(landingPageContentAssets).where(and(eq(landingPageContentAssets.campaignId, campaignId), eq(landingPageContentAssets.landingPageId, deliverableId)));
      const [deleted] = await tx.delete(landingPages).where(and(eq(landingPages.id, deliverableId), eq(landingPages.campaignId, campaignId))).returning();
      if (!deleted) throw new DeliverableError("deliverableId", "not_found", "Landing page not found", 404);
      await invalidateBlockedReleases(campaignId, tx);
    });
    res.status(204).end();
  } catch (error) { report(error, res, next); }
});

router.post("/campaigns/:id/content-assets", async (req, res, next) => {
  try {
    const { campaignId } = ids(req);
    const body = parse<any>(contentAssetCreateSchema, req.body);
    await requireCampaign(campaignId);
    const [row] = await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      return tx.insert(assets).values({ campaignId, reusable: true, ...body }).returning();
    });
    const all = await deliverablesFor(campaignId);
    res.status(201).json(all.contentAssets.find((item: any) => item.id === row.id));
  } catch (error) { report(error, res, next); }
});

router.patch("/campaigns/:id/content-assets/:deliverableId", async (req, res, next) => {
  try {
    const { campaignId, deliverableId } = ids(req);
    const body = parse<any>(contentAssetPatchSchema, req.body);
    const row = await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      const [updated] = await tx.update(assets).set({ ...body, updatedAt: new Date() })
        .where(and(eq(assets.id, deliverableId), eq(assets.campaignId, campaignId))).returning();
      if (!updated) throw new DeliverableError("deliverableId", "not_found", "Content asset not found", 404);
      await invalidateBlockedReleases(campaignId, tx);
      return updated;
    });
    const all = await deliverablesFor(campaignId);
    res.json(all.contentAssets.find((item: any) => item.id === row.id));
  } catch (error) { report(error, res, next); }
});

router.delete("/campaigns/:id/content-assets/:deliverableId", async (req, res, next) => {
  try {
    const { campaignId, deliverableId } = ids(req);
    await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      const linked = await tx.select({ id: landingPageContentAssets.landingPageId }).from(landingPageContentAssets)
        .where(and(eq(landingPageContentAssets.campaignId, campaignId), eq(landingPageContentAssets.contentAssetId, deliverableId)));
      if (linked.length) throw new DeliverableError("deliverableId", "deliverable_referenced", `Content asset is linked to ${linked.length} landing page(s); detach it before deletion`, 409);
      const [deleted] = await tx.delete(assets).where(and(eq(assets.id, deliverableId), eq(assets.campaignId, campaignId))).returning();
      if (!deleted) throw new DeliverableError("deliverableId", "not_found", "Content asset not found", 404);
      await invalidateBlockedReleases(campaignId, tx);
    });
    res.status(204).end();
  } catch (error) { report(error, res, next); }
});

router.put("/campaigns/:id/communications/:itemId/dependencies", async (req, res, next) => {
  try {
    const { campaignId, communicationId } = ids(req);
    parse(communicationDependenciesSchema, req.body);
    const result = await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      return saveCommunicationDependencies(campaignId, communicationId, req.body, tx);
    });
    res.json(result);
  } catch (error) { report(error, res, next); }
});

router.post("/campaigns/:id/communications/:itemId/release", async (req, res, next) => {
  try {
    const { campaignId, communicationId } = ids(req);
    const result = await db.transaction(async (tx) => {
      await lockCampaign(campaignId, tx);
      return releaseCommunication(campaignId, communicationId, tx);
    });
    res.json(result);
  } catch (error) { report(error, res, next); }
});

export { assertCampaignDeliverablesReady };
export default router;