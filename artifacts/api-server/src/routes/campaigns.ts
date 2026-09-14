import { Router, type IRouter } from "express";
import { and, eq, inArray, not, or, sql } from "drizzle-orm";
import {
  db, campaigns, campaignStrategy, activities, activityConnections,
  activityTasks, communications, conflicts, scheduleRules, taxonomyTerms, taxonomyVersions, utmLinks,
  webinarSessions,
} from "@workspace/db";
import { deliveryFor } from "../lib/delivery";
import { ensureWebinarForActivity } from "../lib/webinar-standard";

const router: IRouter = Router();

function normalizeCampaignName(name: string) {
  return name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function expectedRowVersion(req: { body?: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }) {
  const bodyValue = req.body?.rowVersion;
  if (bodyValue !== undefined && bodyValue !== null && bodyValue !== "") {
    const value = Number(bodyValue);
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  const header = req.headers["if-match"];
  if (typeof header === "string") {
    const value = Number(header.replace(/^W\//, "").replace(/^"|"$/g, ""));
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  return undefined;
}

function versionError(statusCode: 409 | 428, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

const summary = (c: typeof campaigns.$inferSelect) => ({
  id: c.id, parentId: c.parentId, name: c.name, scope: c.scope, region: c.region,
  audience: c.audience, outcome: c.outcome, lifecycle: c.lifecycle,
  readiness: c.readiness, timing: c.timing, owner: c.owner, rowVersion: c.rowVersion,
  updatedAt: c.updatedAt.toISOString(),
});

async function mapFor(campaignId: string) {
  const [nodes, edges] = await Promise.all([
    db.select().from(activities).where(eq(activities.campaignId, campaignId)),
    db.select().from(activityConnections).where(eq(activityConnections.campaignId, campaignId)),
  ]);
  return {
    activities: nodes.map((a) => ({ id: a.id, name: a.name, type: a.type, audience: a.audience, region: a.region, timing: a.timing, status: a.status, owner: a.owner, conflict: a.conflict, decisionStatus: a.decisionStatus, rowVersion: a.rowVersion, position: { x: Number(a.x), y: Number(a.y) } })),
    connections: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, trigger: e.trigger, timing: e.timing, exclusions: e.exclusions as string[], sentence: e.sentence, parentBranchId: e.parentBranchId, entryCondition: e.entryCondition, suppressionRule: e.suppressionRule })),
  };
}

async function detail(c: typeof campaigns.$inferSelect) {
  const [strategy] = await db.select().from(campaignStrategy).where(eq(campaignStrategy.campaignId, c.id));
  const links = await db.select().from(utmLinks).where(eq(utmLinks.campaignId, c.id));
  const delivery = await deliveryFor(c.id);
  return {
    ...summary(c), strategy: (strategy?.data ?? {}) as Record<string, unknown>,
    inheritance: (strategy?.inheritance ?? {}) as Record<string, string>,
    map: await mapFor(c.id),
    utmLinks: links.map((u) => ({ id: u.id, destinationUrl: u.destinationUrl, fullUrl: u.fullUrl, taxonomyVersion: u.taxonomyVersion, validation: u.validation, status: u.status })),
    communications: delivery.communications,
    tasks: delivery.tasks,
  };
}

router.get("/campaigns", async (_req, res, next) => {
  try { res.json((await db.select().from(campaigns)).map(summary)); } catch (e) { next(e); }
});

router.post("/campaigns", async (req, res, next) => {
  try {
    const normalizedName = normalizeCampaignName(String(req.body.name ?? ""));
    const [duplicate] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.normalizedName, normalizedName));
    if (duplicate) {
      res.status(409).json({ error: "A campaign with this name already exists", normalizedName });
      return;
    }
    const [c] = await db.insert(campaigns).values({ name: req.body.name, scope: req.body.scope, region: req.body.scope === "Regional" ? "EMEA" : "Global", audience: req.body.audience, outcome: req.body.outcome, lifecycle: "Idea", readiness: 20, timing: "TBD", owner: "You" }).returning();
    await db.insert(campaignStrategy).values({ campaignId: c.id, data: { objective: req.body.outcome, message: "Decision needed" }, inheritance: {} });
    const [entry, outcome] = await db.insert(activities).values([
      { campaignId: c.id, name: `${req.body.audience} enters campaign`, type: "Audience entry", audience: req.body.audience, region: c.region, timing: "TBD", status: "Decision needed", owner: "You", x: "80", y: "160" },
      { campaignId: c.id, name: req.body.outcome, type: "Desired outcome", audience: req.body.audience, region: c.region, timing: "TBD", status: "Estimated", owner: "You", x: "460", y: "160" },
    ]).returning();
    await db.insert(activityConnections).values({ campaignId: c.id, source: entry.id, target: outcome.id, trigger: "engaged", timing: "when ready", exclusions: [], sentence: `When the audience is engaged, guide them toward ${req.body.outcome}.` });
    res.status(201).json(await detail(c));
  } catch (e) { next(e); }
});

router.get("/campaigns/:id", async (req, res, next) => {
  try {
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, req.params.id));
    if (!c) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json(await detail(c));
  } catch (e) { next(e); }
});

router.patch("/campaigns/:id", async (req, res, next) => {
  try {
    const version = expectedRowVersion(req);
    if (version === undefined) {
      res.status(428).json({ error: "rowVersion is required for an existing campaign" });
      return;
    }
    if (version === null) {
      res.status(400).json({ error: "rowVersion must be a positive integer" });
      return;
    }
    const [current] = await db.select().from(campaigns).where(eq(campaigns.id, req.params.id));
    if (!current) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const patch: Partial<typeof campaigns.$inferInsert> = { updatedAt: new Date() };
    if (req.body.name !== undefined) {
      const normalizedName = normalizeCampaignName(String(req.body.name));
      const [duplicate] = await db.select({ id: campaigns.id }).from(campaigns).where(and(
        eq(campaigns.normalizedName, normalizedName),
        sql`${campaigns.id} <> ${req.params.id}`,
      ));
      if (duplicate) {
        res.status(409).json({ error: "A campaign with this name already exists", normalizedName });
        return;
      }
      patch.name = req.body.name;
    }
    if (req.body.lifecycle) patch.lifecycle = req.body.lifecycle;
    const c = await db.transaction(async (tx) => {
      const [updated] = await tx.update(campaigns).set({
        ...patch,
        rowVersion: sql`${campaigns.rowVersion} + 1`,
      }).where(and(eq(campaigns.id, req.params.id), eq(campaigns.rowVersion, version))).returning();
      if (!updated) {
        return null;
      }
      if (req.body.strategy !== undefined) {
        await tx.update(campaignStrategy).set({
          data: req.body.strategy,
          updatedAt: new Date(),
        }).where(eq(campaignStrategy.campaignId, req.params.id));
      }
      return updated;
    });
    if (!c) {
      res.status(409).json({ error: "Campaign has changed", rowVersion: current.rowVersion });
      return;
    }
    res.json(await detail(c));
  } catch (e) { next(e); }
});

router.put("/campaigns/:id/map", async (req, res, next) => {
  try {
    const campaignVersion = expectedRowVersion(req);
    if (campaignVersion === undefined) {
      res.status(428).json({ error: "rowVersion is required for an existing campaign map" });
      return;
    }
    if (campaignVersion === null) {
      res.status(400).json({ error: "rowVersion must be a positive integer" });
      return;
    }
    const [existingCampaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, req.params.id));
    if (!existingCampaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const activitiesProvided = Array.isArray(req.body.activities);
    const submittedActivities = activitiesProvided ? req.body.activities : [];
    const connectionsProvided = Array.isArray(req.body.connections);
    const submittedConnections = connectionsProvided ? req.body.connections : [];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (submittedActivities.some((node: any) => !uuidPattern.test(String(node.id))) ||
      submittedConnections.some((edge: any) => !uuidPattern.test(String(edge.id)))) {
      res.status(400).json({ error: "Activity and branch IDs must be UUIDs" });
      return;
    }
    const activityIds = new Set<string>(submittedActivities.map((n: any) => String(n.id)));
    const connectionIds = new Set<string>();
    for (const edge of submittedConnections) {
      if (connectionIds.has(edge.id)) {
        res.status(400).json({ error: `Duplicate connection id: ${edge.id}` });
        return;
      }
      connectionIds.add(edge.id);
      if (!activityIds.has(edge.source) || !activityIds.has(edge.target)) {
        res.status(400).json({ error: "Every branch source and target must belong to this campaign map" });
        return;
      }
      if (edge.parentBranchId !== undefined && edge.parentBranchId !== null && !connectionIds.has(edge.parentBranchId) && !submittedConnections.some((candidate: any) => candidate.id === edge.parentBranchId)) {
        res.status(400).json({ error: `Unknown parentBranchId: ${edge.parentBranchId}` });
        return;
      }
      for (const field of ["entryCondition", "suppressionRule"] as const) {
        if (edge[field] !== undefined && (typeof edge[field] !== "object" || Array.isArray(edge[field]))) {
          res.status(400).json({ error: `${field} must be a structured object` });
          return;
        }
      }
    }
    if (activityIds.size) {
      const persistedActivities = await db.select({ id: activities.id, campaignId: activities.campaignId })
        .from(activities).where(inArray(activities.id, [...activityIds]));
      if (persistedActivities.some((activity) => activity.campaignId !== req.params.id)) {
        res.status(400).json({ error: "Activity does not belong to this campaign" });
        return;
      }
    }
    if (connectionIds.size) {
      const persistedConnections = await db.select({ id: activityConnections.id, campaignId: activityConnections.campaignId })
        .from(activityConnections).where(inArray(activityConnections.id, [...connectionIds]));
      if (persistedConnections.some((connection) => connection.campaignId !== req.params.id)) {
        res.status(400).json({ error: "Branch does not belong to this campaign" });
        return;
      }
    }
    const parentById = new Map<string, string | null>(
      submittedConnections.map((edge: any) => [edge.id, edge.parentBranchId ?? null]),
    );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return false;
      if (visited.has(id)) return true;
      visiting.add(id);
      const parent = parentById.get(id);
      if (parent && !visit(parent)) return false;
      visiting.delete(id);
      visited.add(id);
      return true;
    };
    for (const edge of submittedConnections) {
      if (!visit(edge.id)) {
        res.status(400).json({ error: "Audience branch parentBranchId cannot contain cycles" });
        return;
      }
    }
    await db.transaction(async (tx) => {
      const [campaign] = await tx.update(campaigns).set({
        rowVersion: sql`${campaigns.rowVersion} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(campaigns.id, req.params.id), eq(campaigns.rowVersion, campaignVersion))).returning();
      if (!campaign) throw versionError(409, "Campaign map has changed");

      const persistedActivities = activitiesProvided
        ? await tx.select({ id: activities.id }).from(activities).where(eq(activities.campaignId, req.params.id))
        : [];
      const submittedActivityIds = new Set<string>(submittedActivities.map((node: any) => String(node.id)));
      const omittedActivityIds = persistedActivities
        .map((activity) => activity.id)
        .filter((id) => !submittedActivityIds.has(id));
      if (activitiesProvided && omittedActivityIds.length) {
        const linkedCommunications = await tx.select({ id: communications.id, activityId: communications.activityId })
          .from(communications)
          .where(inArray(communications.activityId, omittedActivityIds));
        const linkedTasks = await tx.select({ id: activityTasks.id, activityId: activityTasks.activityId })
          .from(activityTasks)
          .where(inArray(activityTasks.activityId, omittedActivityIds));
        const linkedSessions = await tx.select({ id: webinarSessions.id, activityId: webinarSessions.activityId })
          .from(webinarSessions)
          .where(inArray(webinarSessions.activityId, omittedActivityIds));
        const linkedRules = await tx.select({ id: scheduleRules.id, activityId: scheduleRules.activityId, anchorActivityId: scheduleRules.anchorActivityId })
          .from(scheduleRules)
          .where(or(
            inArray(scheduleRules.activityId, omittedActivityIds),
            inArray(scheduleRules.anchorActivityId, omittedActivityIds),
          ));
        const dependencySummary = [
          ["communications", linkedCommunications.map((row) => row.id)],
          ["tasks", linkedTasks.map((row) => row.id)],
          ["webinar sessions", linkedSessions.map((row) => row.id)],
          ["schedule rules", linkedRules.map((row) => row.id)],
        ].filter(([, ids]) => ids.length > 0);
        if (dependencySummary.length) {
          const details = dependencySummary.map(([label, ids]) => `${label}=${(ids as string[]).join(",")}`).join("; ");
          throw Object.assign(
            new Error(`Cannot delete omitted activities ${omittedActivityIds.join(",")}; linked records exist: ${details}`),
            { statusCode: 409 },
          );
        }
        await tx.delete(activityConnections).where(and(
          eq(activityConnections.campaignId, req.params.id),
          or(
            inArray(activityConnections.source, omittedActivityIds),
            inArray(activityConnections.target, omittedActivityIds),
          ),
        ));
        await tx.delete(activities).where(and(
          eq(activities.campaignId, req.params.id),
          inArray(activities.id, omittedActivityIds),
        ));
      }

      for (const n of submittedActivities) {
        const [existing] = await tx.select().from(activities).where(and(eq(activities.id, n.id), eq(activities.campaignId, req.params.id)));
        const values = {
          name: n.name, type: n.type, audience: n.audience, region: n.region, timing: n.timing,
          status: n.status, owner: n.owner, conflict: n.conflict, decisionStatus: n.decisionStatus ?? "Estimated",
          x: String(n.position?.x ?? 0), y: String(n.position?.y ?? 0), updatedAt: new Date(),
        };
        if (!existing) {
          const [createdActivity] = await tx.insert(activities).values({ id: n.id, campaignId: req.params.id, ...values }).returning();
          await ensureWebinarForActivity(req.params.id, createdActivity, n.webinarSetup, tx);
        } else {
          if (n.rowVersion === undefined || n.rowVersion === null) throw versionError(428, `rowVersion is required for activity ${n.id}`);
          if (!Number.isInteger(Number(n.rowVersion)) || Number(n.rowVersion) < 1) {
            throw Object.assign(new Error(`rowVersion must be a positive integer for activity ${n.id}`), { statusCode: 400 });
          }
          const [updated] = await tx.update(activities).set({
            ...values,
            rowVersion: sql`${activities.rowVersion} + 1`,
          }).where(and(eq(activities.id, n.id), eq(activities.campaignId, req.params.id), eq(activities.rowVersion, Number(n.rowVersion)))).returning({ id: activities.id });
          if (!updated) throw versionError(409, `Activity ${n.id} has changed`);
          const [updatedActivity] = await tx.select().from(activities).where(and(eq(activities.id, n.id), eq(activities.campaignId, req.params.id)));
          // Existing legacy Webinar nodes may predate the required setup
          // payload.  Preserve them during ordinary map saves; an explicit
          // setup still provisions/reconciles their standard session.
          if (updatedActivity && n.webinarSetup !== undefined) {
            await ensureWebinarForActivity(req.params.id, updatedActivity, n.webinarSetup, tx);
          }
        }
      }
      if (connectionsProvided) {
        const persistedConnections = await tx.select().from(activityConnections).where(eq(activityConnections.campaignId, req.params.id));
        if (connectionIds.size) {
          await tx.delete(activityConnections).where(and(
            eq(activityConnections.campaignId, req.params.id),
            not(inArray(activityConnections.id, [...connectionIds])),
          ));
        } else {
          await tx.delete(activityConnections).where(eq(activityConnections.campaignId, req.params.id));
        }
        for (const edge of submittedConnections) {
          const existing = persistedConnections.find((row) => row.id === edge.id);
          const values = {
            campaignId: req.params.id,
            source: edge.source,
            target: edge.target,
            trigger: edge.trigger ?? existing?.trigger ?? "Response",
            timing: edge.timing ?? existing?.timing ?? "Immediate",
            exclusions: edge.exclusions ?? existing?.exclusions ?? [],
            sentence: edge.sentence ?? existing?.sentence ?? `On ${edge.trigger ?? existing?.trigger ?? "Response"}`,
            parentBranchId: edge.parentBranchId !== undefined ? edge.parentBranchId : existing?.parentBranchId ?? null,
            entryCondition: edge.entryCondition !== undefined ? edge.entryCondition : existing?.entryCondition ?? {},
            suppressionRule: edge.suppressionRule !== undefined ? edge.suppressionRule : existing?.suppressionRule ?? {},
            updatedAt: new Date(),
          };
          if (existing) {
            await tx.update(activityConnections).set(values).where(and(
              eq(activityConnections.id, edge.id),
              eq(activityConnections.campaignId, req.params.id),
            ));
          } else {
            await tx.insert(activityConnections).values({ id: edge.id, ...values });
          }
        }
      }
    });
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, req.params.id));
    res.json({ ...(await mapFor(req.params.id)), rowVersion: campaign.rowVersion });
  } catch (e) {
    if (e && typeof e === "object" && "statusCode" in e && typeof e.statusCode === "number") {
      res.status(e.statusCode).json({ error: e instanceof Error ? e.message : "Map update rejected" });
      return;
    }
    next(e);
  }
});

router.post("/campaigns/:id/activities", async (req, res, next) => {
  try {
    const version = expectedRowVersion(req);
    if (version === undefined) {
      res.status(428).json({ error: "rowVersion is required for an existing campaign" });
      return;
    }
    if (version === null) {
      res.status(400).json({ error: "rowVersion must be a positive integer" });
      return;
    }
    const [existingCampaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, req.params.id));
    if (!existingCampaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const [a] = await db.transaction(async (tx) => {
      const [campaign] = await tx.update(campaigns).set({
        rowVersion: sql`${campaigns.rowVersion} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(campaigns.id, req.params.id), eq(campaigns.rowVersion, version as number))).returning();
      if (!campaign) throw versionError(409, "Campaign has changed");
      const [activity] = await tx.insert(activities).values({
        name: req.body.name, type: req.body.type, audience: req.body.audience, region: req.body.region,
        timing: req.body.timing, status: req.body.status, owner: req.body.owner,
        conflict: req.body.conflict ?? false, decisionStatus: req.body.decisionStatus ?? "Estimated",
        campaignId: req.params.id, x: String(req.body.position?.x ?? 0), y: String(req.body.position?.y ?? 0),
      }).returning();
      await ensureWebinarForActivity(req.params.id, activity, req.body.webinarSetup, tx);
      return [activity];
    });
    res.status(201).json({ ...a, position: { x: Number(a.x), y: Number(a.y) } });
  } catch (e) {
    if (e && typeof e === "object" && "statusCode" in e && typeof e.statusCode === "number") {
      res.status(e.statusCode).json({ error: e instanceof Error ? e.message : "Activity update rejected" });
      return;
    }
    next(e);
  }
});

router.post("/campaigns/:id/utm-links", async (req, res, next) => {
  try {
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, req.params.id));
    const code = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const params = new URLSearchParams({ utm_source: req.body.source, utm_medium: req.body.medium, utm_campaign: code, utm_content: req.body.content, utm_term: req.body.term, utm_sf_cmp_id: req.body.salesforceCampaignId });
    const fullUrl = `${req.body.destinationUrl}${req.body.destinationUrl.includes("?") ? "&" : "?"}${params}`;
    const [u] = await db.insert(utmLinks).values({ campaignId: c.id, destinationUrl: req.body.destinationUrl, fullUrl, taxonomyVersion: "2026.1", generatedValues: Object.fromEntries(params), validation: "Valid", status: "Draft" }).returning();
    res.status(201).json({ id: u.id, destinationUrl: u.destinationUrl, fullUrl: u.fullUrl, taxonomyVersion: u.taxonomyVersion, validation: u.validation, status: u.status });
  } catch (e) { next(e); }
});

router.get("/portfolio", async (_req, res, next) => {
  try {
    const cs = await db.select().from(campaigns);
    const fs = await db.select().from(conflicts);
    res.json({ campaigns: cs.map(summary), conflicts: fs.map((f) => ({ id: f.id, classification: f.classification, severity: f.severity, title: f.title, reason: f.reason, campaigns: (f.campaignIds as string[]).map((id) => cs.find((c) => c.id === id)?.name ?? id), dates: f.dates, recommendation: f.recommendation, owner: f.owner, status: f.status })), summary: { campaigns: cs.length, live: cs.filter((c) => c.lifecycle === "Live").length, conflicts: fs.filter((f) => f.status !== "Resolved").length, ready: cs.filter((c) => c.readiness >= 70).length } });
  } catch (e) { next(e); }
});

router.post("/conflicts/run", async (_req, res, next) => {
  try {
    const cs = await db.select().from(campaigns);
    const duplicateGroups = new Map<string, typeof cs>();
    for (const campaign of cs) {
      const normalized = campaign.normalizedName ?? normalizeCampaignName(campaign.name);
      const group = duplicateGroups.get(normalized) ?? [];
      group.push(campaign);
      duplicateGroups.set(normalized, group);
    }
    for (const [normalized, duplicates] of duplicateGroups) {
      if (normalized && duplicates.length > 1) {
        const ids = duplicates.map((campaign) => campaign.id);
        const title = `Duplicate campaign name: ${normalized}`;
        const existing = await db.select().from(conflicts).where(eq(conflicts.title, title));
        if (!existing.length) {
          await db.insert(conflicts).values({
            classification: "Naming conflict",
            severity: "High",
            title,
            reason: "Campaign names normalize to the same punctuation-insensitive identifier.",
            campaignIds: ids,
            dates: "Current",
            recommendation: "Rename one campaign before publishing.",
            owner: "Campaign team",
            status: "Open",
          });
        }
      }
    }
    const emeas = cs.filter((c) => c.region === "EMEA" && c.audience.toLowerCase().includes("asset manager"));
    if (emeas.length > 1) {
      const ids = emeas.slice(0, 2).map((c) => c.id);
      const existing = await db.select().from(conflicts).where(eq(conflicts.title, "EMEA asset manager audience pressure"));
      if (!existing.length) await db.insert(conflicts).values({ classification: "Coordination required", severity: "High", title: "EMEA asset manager audience pressure", reason: "Two Index campaigns target the same audience in the November launch window.", campaignIds: ids, dates: "November 2026", recommendation: "Sequence communications or coordinate a shared audience plan.", owner: "Portfolio lead", status: "Open" });
    }
    const rows = await db.select().from(conflicts);
    res.json(rows.map((f) => ({ id: f.id, classification: f.classification, severity: f.severity, title: f.title, reason: f.reason, campaigns: (f.campaignIds as string[]).map((id) => cs.find((c) => c.id === id)?.name ?? id), dates: f.dates, recommendation: f.recommendation, owner: f.owner, status: f.status })));
  } catch (e) { next(e); }
});

router.get("/governance", async (_req, res, next) => {
  try {
    const [v] = await db.select().from(taxonomyVersions);
    const terms = v ? await db.select().from(taxonomyTerms).where(eq(taxonomyTerms.versionId, v.id)) : [];
    res.json({ version: v?.version ?? "2026.1", activityTypes: ["Email", "Content", "Webinar", "Event", "Paid social", "Paid search", "Display", "Video", "Landing page", "Sales handoff", "Custom"], taxonomyTerms: terms.map((t) => ({ category: t.category, label: t.label, shortcode: t.shortcode })), namingExamples: ["Commodity Indexes Launch — EMEA", "EMEA_AM_EMAIL_INVITE", "IDX-COM-2026-EMEA"] });
  } catch (e) { next(e); }
});

router.get("/adapters/status", (_req, res) => res.json({
  airtable: { configured: process.env.AIRTABLE_ENABLED === "true" && !!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN && !!process.env.AIRTABLE_BASE_ID, mode: "Manual sync", status: process.env.AIRTABLE_ENABLED === "true" ? "Configuration incomplete" : "Not configured", errors: [] },
  ai: { configured: !!process.env.AI_PROVIDER, mode: "Explicit acceptance", actions: ["Draft", "Recommend", "Critique", "Explain conflict"], status: process.env.AI_PROVIDER ? "Available" : "Not configured" },
}));

router.get("/campaigns/:id/export/:format", async (req, res, next) => {
  try {
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, req.params.id));
    if (!c) { res.status(404).send("Campaign not found"); return; }
    const map = await mapFor(c.id);
    if (req.params.format === "json") { res.type("application/json").send(JSON.stringify(await detail(c), null, 2)); return; }
    if (req.params.format === "utm-csv") {
      const links = await db.select().from(utmLinks).where(eq(utmLinks.campaignId, c.id));
      res.type("text/csv").send(["Destination URL,Tagged URL,Taxonomy version,Validation,Status", ...links.map((u) => [u.destinationUrl, u.fullUrl, u.taxonomyVersion, u.validation, u.status].map((x) => JSON.stringify(x)).join(","))].join("\n")); return;
    }
    if (req.params.format === "activities-csv") { res.type("text/csv").send(["Name,Type,Audience,Region,Timing,Status,Owner", ...map.activities.map((a) => [a.name, a.type, a.audience, a.region, a.timing, a.status, a.owner].map((x) => JSON.stringify(x)).join(","))].join("\n")); return; }
    res.type("text/plain").send(`${c.name}\n${c.scope} · ${c.region}\nAudience: ${c.audience}\nOutcome: ${c.outcome}\nTiming: ${c.timing}\nReadiness: ${c.readiness}%\n\nAudience journey\n${map.activities.map((a) => `• ${a.name} — ${a.timing} — ${a.status}`).join("\n")}`);
  } catch (e) { next(e); }
});

export default router;