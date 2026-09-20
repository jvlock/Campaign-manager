import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  activityTasks,
  assets,
  communicationCtas,
  communicationDetails,
  communicationLandingPages,
  communications,
  ctas,
  db,
  landingPageContentAssets,
  landingPages,
  webinarStandardCommunications,
} from "@workspace/db";

export const BUILD_STATUSES = ["Not Started", "Drafted", "In Review", "Published"] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateField = z.string().regex(datePattern).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, "must be a valid YYYY-MM-DD date").nullable();
const statusField = z.enum(BUILD_STATUSES);
const requiredText = z.string().trim().min(1);
const optionalHttpUrl = z.string().url().refine((value) => /^https?:\/\//i.test(value), "must use HTTP or HTTPS").nullable();

export class DeliverableError extends Error {
  readonly statusCode: number;
  constructor(
    public field: string,
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "DeliverableError";
    this.statusCode = status;
  }
}

const ctaFields = z.object({
  name: requiredText,
  buttonText: requiredText,
  landingPageId: z.string().uuid().nullable().optional(),
  destinationUrl: optionalHttpUrl.optional(),
  owner: requiredText,
  status: statusField.default("Not Started"),
  publishBy: dateField.optional().default(null),
}).strict();
export const ctaCreateSchema = ctaFields.superRefine((value, context) => {
  const landing = Boolean(value.landingPageId);
  const url = Boolean(value.destinationUrl);
  if (landing === url) context.addIssue({ code: "custom", path: ["destination"], message: "Exactly one of landingPageId or destinationUrl is required" });
});
export const ctaPatchSchema = ctaFields.partial().strict();
const landingPageFields = z.object({
  name: requiredText,
  headline: z.string(),
  supportingCopyNeeds: z.string(),
  personalizationRequirements: z.string(),
  owner: requiredText,
  status: statusField.default("Not Started"),
  publishBy: dateField.optional().default(null),
  publishedUrl: optionalHttpUrl.optional().default(null),
  contentAssetIds: z.array(z.string().uuid()).default([]),
}).strict();
export const landingPageCreateSchema = landingPageFields.superRefine((value, context) => {
  if (value.status === "Published" && !value.publishedUrl) {
    context.addIssue({ code: "custom", path: ["publishedUrl"], message: "publishedUrl is required when status is Published" });
  }
});
export const landingPagePatchSchema = landingPageFields.partial().strict();
export const contentAssetCreateSchema = z.object({
  name: requiredText,
  brief: z.string(),
  owner: requiredText,
  status: statusField.default("Not Started"),
  publishBy: dateField.optional().default(null),
}).strict();
export const contentAssetPatchSchema = contentAssetCreateSchema.partial().strict();
export const communicationDependenciesSchema = z.object({
  ctaIds: z.array(z.string().uuid()).default([]),
  landingPageIds: z.array(z.string().uuid()).default([]),
}).strict();

function unique(values: string[]) {
  return [...new Set(values)];
}

async function requireIds(
  campaignId: string,
  ids: string[],
  table: typeof ctas | typeof landingPages | typeof assets,
  field: string,
  executor: any,
) {
  const distinct = unique(ids);
  if (distinct.length !== ids.length) throw new DeliverableError(field, "duplicate_reference", `${field} must not contain duplicate IDs`);
  if (!distinct.length) return;
  const rows = await executor.select({ id: table.id }).from(table)
    .where(and(eq(table.campaignId, campaignId), inArray(table.id, distinct)));
  if (rows.length !== distinct.length) {
    throw new DeliverableError(field, "cross_campaign_or_missing", `Every ${field} entry must reference a record in this campaign`);
  }
}

async function requireCommunication(campaignId: string, communicationId: string, executor: any) {
  const [row] = await executor.select().from(communications)
    .where(and(eq(communications.id, communicationId), eq(communications.campaignId, campaignId)));
  if (!row) throw new DeliverableError("communicationId", "not_found", "Communication not found", 404);
  return row;
}

async function requireLandingPage(campaignId: string, landingPageId: string | null | undefined, executor: any) {
  if (!landingPageId) return;
  await requireIds(campaignId, [landingPageId], landingPages, "landingPageId", executor);
}

export async function saveCommunicationDependencies(
  campaignId: string,
  communicationId: string,
  input: unknown,
  executor: any = db,
) {
  const parsed = communicationDependenciesSchema.safeParse(input);
  if (!parsed.success) throw new DeliverableError("dependencies", "invalid_input", parsed.error.message);
  await requireCommunication(campaignId, communicationId, executor);
  await requireIds(campaignId, parsed.data.ctaIds, ctas, "ctaIds", executor);
  await requireIds(campaignId, parsed.data.landingPageIds, landingPages, "landingPageIds", executor);
  await executor.delete(communicationCtas).where(and(
    eq(communicationCtas.campaignId, campaignId),
    eq(communicationCtas.communicationId, communicationId),
  ));
  await executor.delete(communicationLandingPages).where(and(
    eq(communicationLandingPages.campaignId, campaignId),
    eq(communicationLandingPages.communicationId, communicationId),
  ));
  if (parsed.data.ctaIds.length) await executor.insert(communicationCtas).values(
    parsed.data.ctaIds.map((ctaId) => ({ campaignId, communicationId, ctaId })),
  );
  if (parsed.data.landingPageIds.length) await executor.insert(communicationLandingPages).values(
    parsed.data.landingPageIds.map((landingPageId) => ({ campaignId, communicationId, landingPageId })),
  );
  await invalidateBlockedReleases(campaignId, executor);
  return communicationReadinessFor(campaignId, communicationId, executor);
}

type Blocker = {
  code: string;
  entityType: "cta" | "landingPage" | "contentAsset" | "task" | "legacyWebinarCta";
  id: string;
  name: string;
  owner: string | null;
  publishBy: string | null;
  status: string;
};

async function loadCampaignGraph(campaignId: string, executor: any = db) {
  // Deliberately sequential: callers may supply a transaction-bound pg client,
  // which must not execute concurrent queries on one connection.
  const communicationRows = await executor.select().from(communications).where(eq(communications.campaignId, campaignId)).orderBy(asc(communications.sortOrder));
  const detailRows = await executor.select().from(communicationDetails).where(eq(communicationDetails.campaignId, campaignId));
  const ctaRows = await executor.select().from(ctas).where(eq(ctas.campaignId, campaignId)).orderBy(asc(ctas.createdAt));
  const pageRows = await executor.select().from(landingPages).where(eq(landingPages.campaignId, campaignId)).orderBy(asc(landingPages.createdAt));
  const assetRows = await executor.select().from(assets).where(eq(assets.campaignId, campaignId)).orderBy(asc(assets.createdAt));
  const ctaLinks = await executor.select().from(communicationCtas).where(eq(communicationCtas.campaignId, campaignId));
  const pageLinks = await executor.select().from(communicationLandingPages).where(eq(communicationLandingPages.campaignId, campaignId));
  const assetLinks = await executor.select().from(landingPageContentAssets).where(eq(landingPageContentAssets.campaignId, campaignId));
  const taskRows = await executor.select().from(activityTasks).where(eq(activityTasks.campaignId, campaignId));
  const standards = await executor.select().from(webinarStandardCommunications).where(eq(webinarStandardCommunications.campaignId, campaignId));
  return { communicationRows, detailRows, ctaRows, pageRows, assetRows, ctaLinks, pageLinks, assetLinks, taskRows, standards };
}

function readinessRows(graph: Awaited<ReturnType<typeof loadCampaignGraph>>) {
  const details = new Map<string, any>(graph.detailRows.map((row: any) => [row.communicationId, row]));
  const ctaById = new Map<string, any>(graph.ctaRows.map((row: any) => [row.id, row]));
  const pageById = new Map<string, any>(graph.pageRows.map((row: any) => [row.id, row]));
  const assetById = new Map<string, any>(graph.assetRows.map((row: any) => [row.id, row]));
  const taskById = new Map<string, any>(graph.taskRows.map((row: any) => [row.id, row]));
  const standardByCommunication = new Map(graph.standards.filter((row: any) => row.communicationId).map((row: any) => [row.communicationId, row]));

  return graph.communicationRows.map((communication: any) => {
    const linkedCtaIds = graph.ctaLinks.filter((link: any) => link.communicationId === communication.id).map((link: any) => link.ctaId);
    const directPageIds = graph.pageLinks.filter((link: any) => link.communicationId === communication.id).map((link: any) => link.landingPageId);
    const ctaRows = linkedCtaIds.map((id: string) => ctaById.get(id)).filter(Boolean) as any[];
    const pageIds = unique([
      ...directPageIds,
      ...ctaRows.map((cta: any) => cta.landingPageId).filter(Boolean),
    ]);
    const pages = pageIds.map((id) => pageById.get(id)).filter(Boolean) as any[];
    const assetIds = unique(pages.flatMap((page: any) => graph.assetLinks
      .filter((link: any) => link.landingPageId === page.id)
      .map((link: any) => link.contentAssetId)));
    const blockers: Blocker[] = [];
    for (const cta of ctaRows) if (cta.status !== "Published") blockers.push({
      code: "cta_not_published", entityType: "cta", id: cta.id, name: cta.name,
      owner: cta.owner, publishBy: cta.publishBy, status: cta.status,
    });
    for (const page of pages) if (page.status !== "Published") blockers.push({
      code: "landing_page_not_published", entityType: "landingPage", id: page.id, name: page.name,
      owner: page.owner, publishBy: page.publishBy, status: page.status,
    });
    for (const page of pages) {
      let validPublishedUrl = false;
      try {
        validPublishedUrl = Boolean(page.url && /^https?:$/i.test(new URL(page.url).protocol));
      } catch {
        validPublishedUrl = false;
      }
      if (page.status === "Published" && !validPublishedUrl) blockers.push({
        code: "landing_page_destination_unavailable", entityType: "landingPage", id: page.id, name: page.name,
        owner: page.owner, publishBy: page.publishBy, status: page.status,
      });
    }
    for (const cta of ctaRows) {
      if (cta.destinationUrl) {
        try {
          if (!/^https?:$/i.test(new URL(cta.destinationUrl).protocol)) throw new Error("invalid protocol");
        } catch {
          blockers.push({
            code: "cta_destination_unavailable", entityType: "cta", id: cta.id, name: cta.name,
            owner: cta.owner, publishBy: cta.publishBy, status: cta.status,
          });
        }
      }
    }
    for (const id of assetIds) {
      const asset = assetById.get(id);
      if (asset && asset.status !== "Published") blockers.push({
        code: "content_asset_not_published", entityType: "contentAsset", id: asset.id, name: asset.name,
        owner: asset.owner, publishBy: asset.publishBy, status: asset.status,
      });
    }
    const detail = details.get(communication.id) as any;
    for (const taskId of detail?.blockingDependencyTaskIds ?? []) {
      const task = taskById.get(taskId);
      if (!task) blockers.push({
        code: "task_reference_missing", entityType: "task", id: taskId, name: "Missing blocking task",
        owner: null, publishBy: null, status: "Missing",
      });
      else if (!["complete", "completed"].includes(String(task.stage || task.status).toLowerCase())) blockers.push({
        code: "task_not_complete", entityType: "task", id: task.id, name: task.name,
        owner: task.owner, publishBy: null, status: task.stage || task.status,
      });
    }
    const standard = standardByCommunication.get(communication.id) as any;
    if (standard) {
      for (const variant of (standard.variants ?? []) as any[]) {
        const label = String(variant?.content?.ctaLabel ?? "").trim();
        const url = String(variant?.content?.ctaUrl ?? "").trim();
        if (!label && !url) continue;
        const sourceKey = `webinar:${standard.id}:variant:${variant.slot}`;
        if (!ctaRows.some((cta: any) => cta.legacySourceKey === sourceKey)) blockers.push({
          code: "legacy_webinar_cta_requires_migration",
          entityType: "legacyWebinarCta",
          id: sourceKey,
          name: `${standard.name} variant ${variant.slot}`,
          owner: null,
          publishBy: null,
          status: "Not Started",
        });
      }
    }
    const deduped = [...new Map(blockers.map((blocker) => [`${blocker.entityType}:${blocker.id}`, blocker])).values()];
    const dependencyReadiness = deduped.length ? "Blocked" : "Ready";
    return {
      communicationId: communication.id,
      communicationName: communication.name,
      dependencyReadiness,
      dependencyReadinessDescription: dependencyReadiness === "Ready"
        ? "Linked build dependencies are published; QA, approval, scheduling, and sending are separate."
        : "One or more linked build dependencies are not published.",
      releaseState: dependencyReadiness === "Blocked" ? "Draft" : (detail?.releaseState ?? "Draft"),
      releasedAt: dependencyReadiness === "Blocked" ? null : (detail?.releasedAt?.toISOString?.() ?? detail?.releasedAt ?? null),
      externalSending: false,
      ctaIds: linkedCtaIds,
      landingPageIds: directPageIds,
      blockers: deduped,
    };
  });
}

export async function communicationReadinessFor(campaignId: string, communicationId: string, executor: any = db) {
  await requireCommunication(campaignId, communicationId, executor);
  const row = readinessRows(await loadCampaignGraph(campaignId, executor))
    .find((candidate: any) => candidate.communicationId === communicationId);
  if (!row) throw new DeliverableError("communicationId", "not_found", "Communication not found", 404);
  return row;
}

export async function invalidateBlockedReleases(campaignId: string, executor: any = db) {
  const blocked = readinessRows(await loadCampaignGraph(campaignId, executor))
    .filter((row: any) => row.dependencyReadiness === "Blocked")
    .map((row: any) => row.communicationId);
  if (blocked.length) await executor.update(communicationDetails).set({
    releaseState: "Draft", releasedAt: null, updatedAt: new Date(),
  }).where(and(eq(communicationDetails.campaignId, campaignId), inArray(communicationDetails.communicationId, blocked)));
}

export async function deliverablesFor(campaignId: string, executor: any = db) {
  const graph = await loadCampaignGraph(campaignId, executor);
  const readiness = readinessRows(graph);
  const blockedBy = (type: string, id: string) => readiness
    .filter((row: any) => row.blockers.some((blocker: any) => blocker.entityType === type && blocker.id === id))
    .map((row: any) => ({ id: row.communicationId, name: row.communicationName }));
  const ctaResponse = graph.ctaRows.map((row: any) => ({
    id: row.id, campaignId: row.campaignId, name: row.name, buttonText: row.buttonText,
    landingPageId: row.landingPageId, destinationUrl: row.destinationUrl, owner: row.owner,
    status: row.status, publishBy: row.publishBy, sourceMetadata: row.sourceMetadata,
    communicationIds: graph.ctaLinks.filter((link: any) => link.ctaId === row.id).map((link: any) => link.communicationId),
    blockingCommunications: blockedBy("cta", row.id),
  }));
  const pageResponse = graph.pageRows.map((row: any) => ({
    id: row.id, campaignId: row.campaignId, name: row.name, headline: row.headline,
    supportingCopyNeeds: row.supportingCopyNeeds, personalizationRequirements: row.personalizationRequirements,
    owner: row.owner, status: row.status, publishBy: row.publishBy, publishedUrl: row.url,
    contentAssetIds: graph.assetLinks.filter((link: any) => link.landingPageId === row.id).map((link: any) => link.contentAssetId),
    communicationIds: unique([
      ...graph.pageLinks.filter((link: any) => link.landingPageId === row.id).map((link: any) => link.communicationId),
      ...graph.ctaLinks.filter((link: any) => {
        const cta = graph.ctaRows.find((candidate: any) => candidate.id === link.ctaId);
        return cta?.landingPageId === row.id;
      }).map((link: any) => link.communicationId),
    ]),
    blockingCommunications: blockedBy("landingPage", row.id),
  }));
  const assetResponse = graph.assetRows.map((row: any) => ({
    id: row.id, campaignId: row.campaignId, name: row.name, brief: row.brief,
    owner: row.owner, status: row.status, publishBy: row.publishBy,
    landingPageIds: graph.assetLinks.filter((link: any) => link.contentAssetId === row.id).map((link: any) => link.landingPageId),
    blockingCommunications: blockedBy("contentAsset", row.id),
  }));
  return {
    ctas: ctaResponse,
    landingPages: pageResponse,
    contentAssets: assetResponse,
    communications: readiness,
    outstanding: [
      ...ctaResponse.filter((row: any) => row.status !== "Published"),
      ...pageResponse.filter((row: any) => row.status !== "Published"),
      ...assetResponse.filter((row: any) => row.status !== "Published"),
    ],
  };
}

export async function releaseCommunication(campaignId: string, communicationId: string, executor: any = db) {
  await requireCommunication(campaignId, communicationId, executor);
  const readiness = await communicationReadinessFor(campaignId, communicationId, executor);
  if (readiness.dependencyReadiness === "Blocked") {
    throw new DeliverableError("dependencies", "communication_blocked", "Communication cannot be released while build dependencies are blocked", 409);
  }
  const [detail] = await executor.select().from(communicationDetails)
    .where(and(eq(communicationDetails.campaignId, campaignId), eq(communicationDetails.communicationId, communicationId)));
  if (!detail) throw new DeliverableError("communicationId", "details_missing", "Communication delivery details are missing", 409);
  const [updated] = await executor.update(communicationDetails).set({
    releaseState: "Released", releasedAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(communicationDetails.campaignId, campaignId), eq(communicationDetails.communicationId, communicationId))).returning();
  return { ...readiness, releaseState: updated.releaseState, releasedAt: updated.releasedAt?.toISOString() ?? null, externalSending: false };
}

export async function assertCampaignDeliverablesReady(campaignId: string, executor: any = db) {
  const blocked = readinessRows(await loadCampaignGraph(campaignId, executor)).filter((row: any) => row.dependencyReadiness === "Blocked");
  if (blocked.length) throw new DeliverableError(
    "lifecycle",
    "communications_blocked",
    `Campaign has ${blocked.length} communication(s) blocked by unpublished build dependencies`,
    409,
  );
}

export async function resolveCtaDestination(cta: typeof ctas.$inferSelect, executor: any = db) {
  if (cta.destinationUrl) {
    try {
      if (/^https?:$/i.test(new URL(cta.destinationUrl).protocol)) return cta.destinationUrl;
    } catch {
      // Fall through to the actionable destination error below.
    }
    throw new DeliverableError("destinationUrl", "invalid_destination_url", `CTA ${cta.name} requires an HTTP(S) destinationUrl`, 409);
  }
  if (!cta.landingPageId) throw new DeliverableError("destination", "missing_destination", `CTA ${cta.name} has no destination`, 409);
  const [page] = await executor.select().from(landingPages).where(eq(landingPages.id, cta.landingPageId));
  let validUrl = false;
  try {
    validUrl = Boolean(page?.url && /^https?:$/i.test(new URL(page.url).protocol));
  } catch {
    validUrl = false;
  }
  if (!page || page.status !== "Published" || !validUrl) {
    throw new DeliverableError("publishedUrl", "landing_page_url_required", `Published landing page for CTA ${cta.name} requires an HTTP(S) publishedUrl`, 409);
  }
  return page.url;
}

export async function canonicalCtasForCommunication(
  campaignId: string,
  communicationId: string,
  executor: any = db,
  requireResolvable = true,
) {
  const rows = await executor.select({ cta: ctas }).from(communicationCtas)
    .innerJoin(ctas, eq(ctas.id, communicationCtas.ctaId))
    .where(and(
      eq(communicationCtas.campaignId, campaignId),
      eq(communicationCtas.communicationId, communicationId),
    ))
    .orderBy(asc(communicationCtas.createdAt));
  const result: any[] = [];
  for (const { cta } of rows as any[]) {
    try {
      result.push({
        id: cta.id,
        name: cta.name,
        buttonText: cta.buttonText,
        destinationUrl: await resolveCtaDestination(cta, executor),
        destinationError: null,
        status: cta.status,
        legacySourceKey: cta.legacySourceKey,
      });
    } catch (error) {
      if (requireResolvable) throw error;
      result.push({
        id: cta.id,
        name: cta.name,
        buttonText: cta.buttonText,
        destinationUrl: null,
        destinationError: error instanceof Error ? error.message : "Destination is not resolvable",
        status: cta.status,
        legacySourceKey: cta.legacySourceKey,
      });
    }
  }
  return result;
}