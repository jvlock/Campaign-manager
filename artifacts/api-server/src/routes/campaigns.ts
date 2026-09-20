import { Router, type IRouter } from "express";
import { syncCapacityConflicts } from "../lib/implementation-tasks";
import { and, desc, eq, inArray, not, or, sql } from "drizzle-orm";
import {
  db, campaigns, campaignStrategy, activities, activityConnections,
  activityTasks, communications, conflicts, scheduleRules, taxonomyTerms, taxonomyVersions, utmLinks,
  webinarSessions,
} from "@workspace/db";
import { deliveryFor } from "../lib/delivery";
import { ensureWebinarForActivity } from "../lib/webinar-standard";
import {
  appendUtm,
  compileUtm,
  normalizeGoverned,
  UtmInputError,
  type UtmCategoryKey,
  type UtmFormula,
} from "../lib/utm-compiler";
import {
  ACTIVITY_TYPE_CONFIGURATIONS,
  ActivityModelError,
  GOVERNED_CHANNELS,
  assertMcpSafe,
  assertNoSuppliedGeneratedIdentity,
  activityConfiguration,
  normalizeCampaignInheritance,
  validateActivityModel,
  renderActivityName,
} from "../lib/activity-model";
import { assertCampaignDeliverablesReady, DeliverableError } from "../lib/deliverables";
import {
  assertNoFinalityRequest,
  GovernanceQuarantineError,
  PROVISIONAL_GOVERNANCE,
} from "../lib/governance-quarantine";

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
  governance: PROVISIONAL_GOVERNANCE,
});

async function mapFor(campaignId: string) {
  const [nodes, edges, campaignRows, strategyRows] = await Promise.all([
    db.select().from(activities).where(eq(activities.campaignId, campaignId)),
    db.select().from(activityConnections).where(eq(activityConnections.campaignId, campaignId)),
    db.select().from(campaigns).where(eq(campaigns.id, campaignId)),
    db.select().from(campaignStrategy).where(eq(campaignStrategy.campaignId, campaignId)),
  ]);
  const campaign = campaignRows[0];
  const inherited = campaign ? inheritedFor(campaign, strategyRows[0]) : {};
  return {
    activities: nodes.map((a) => activityResponse(
      a,
      a.activityTypeId
        ? Object.fromEntries(activityConfiguration(a.activityTypeId).allowedOverrides.map((key) => [
            key,
            Object.prototype.hasOwnProperty.call(a.activityOverrides, key) ? a.activityOverrides[key] : inherited[key as keyof typeof inherited],
          ]))
        : a.effectiveInheritance,
    )),
    connections: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, trigger: e.trigger, timing: e.timing, exclusions: e.exclusions as string[], sentence: e.sentence, parentBranchId: e.parentBranchId, entryCondition: e.entryCondition, suppressionRule: e.suppressionRule })),
  };
}

function inheritedFor(
  campaign: typeof campaigns.$inferSelect,
  strategy: typeof campaignStrategy.$inferSelect | undefined,
): Record<string, unknown> {
  const inheritance = (strategy?.inheritance ?? {}) as Record<string, unknown>;
  return {
    deliveryStartDate: inheritance.deliveryStartDate,
    deliveryEndDate: inheritance.deliveryEndDate,
    productValueIds: inheritance.productValueIds,
    owner: Object.prototype.hasOwnProperty.call(inheritance, "owner") ? inheritance.owner : campaign.owner,
    region: Object.prototype.hasOwnProperty.call(inheritance, "region") ? inheritance.region : campaign.region,
    language: inheritance.language,
    primaryCta: inheritance.primaryCta,
    landingDestination: inheritance.landingDestination,
  };
}

function activityModelError(res: any, error: ActivityModelError) {
  res.status(400).json({ error: { field: error.field, code: error.code, message: error.message } });
}

function activityResponse(
  activity: typeof activities.$inferSelect,
  effectiveInheritance: Record<string, unknown> = activity.effectiveInheritance,
) {
  return {
    id: activity.id, name: activity.name, type: activity.type, audience: activity.audience,
    region: activity.region, timing: activity.timing, status: activity.status,
    owner: activity.owner, conflict: activity.conflict, decisionStatus: activity.decisionStatus,
    rowVersion: activity.rowVersion, activityTypeId: activity.activityTypeId,
    answers: activity.activityAnswers, overrides: activity.activityOverrides,
    generatedName: activity.generatedName, namingInput: activity.namingInput,
    generatedNameGovernance: PROVISIONAL_GOVERNANCE,
    effectiveInheritance, position: { x: Number(activity.x), y: Number(activity.y) },
  };
}

router.get("/activity-model/catalog", (_req, res) => {
  res.json({
    channels: GOVERNED_CHANNELS.map((channel) => ({ ...channel, governance: PROVISIONAL_GOVERNANCE })),
    activityTypes: ACTIVITY_TYPE_CONFIGURATIONS.map((activityType) => ({ ...activityType, governance: PROVISIONAL_GOVERNANCE })),
    governance: PROVISIONAL_GOVERNANCE,
  });
});

router.post("/activity-model/render-name", (req, res) => {
  try {
    assertNoFinalityRequest(req.body);
    const template = req.body?.template;
    if (typeof template !== "string") throw new ActivityModelError("template", "required", "template is required");
    const builtins = req.body?.builtins;
    const answers = req.body?.answers;
    if (!builtins || typeof builtins !== "object" || Array.isArray(builtins)) throw new ActivityModelError("builtins", "invalid_type", "builtins must be an object");
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new ActivityModelError("answers", "invalid_type", "answers must be an object");
    res.json({ name: renderActivityName(template, builtins, answers), governance: PROVISIONAL_GOVERNANCE });
  } catch (error) {
    if (error instanceof GovernanceQuarantineError) {
      res.status(error.status).json({ error: { field: error.field, code: error.code, message: error.message } });
      return;
    }
    if (error instanceof ActivityModelError) { activityModelError(res, error); return; }
    throw error;
  }
});

async function detail(c: typeof campaigns.$inferSelect) {
  const [strategy] = await db.select().from(campaignStrategy).where(eq(campaignStrategy.campaignId, c.id));
  const links = await db.select().from(utmLinks).where(eq(utmLinks.campaignId, c.id));
  const delivery = await deliveryFor(c.id);
  return {
    ...summary(c), strategy: (strategy?.data ?? {}) as Record<string, unknown>,
    inheritance: (strategy?.inheritance ?? {}) as Record<string, unknown>,
    map: await mapFor(c.id),
    utmLinks: links.map((u) => ({
      id: u.id, destinationUrl: u.destinationUrl, fullUrl: u.fullUrl,
      taxonomyVersion: u.taxonomyVersion, validation: u.validation, status: u.status,
      governance: PROVISIONAL_GOVERNANCE,
    })),
    communications: delivery.communications,
    tasks: delivery.tasks,
  };
}

router.get("/campaigns", async (_req, res, next) => {
  try { res.json((await db.select().from(campaigns)).map(summary)); } catch (e) { next(e); }
});

router.post("/campaigns", async (req, res, next) => {
  try {
    assertNoFinalityRequest(req.body);
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
  } catch (e) {
    if (e instanceof GovernanceQuarantineError) {
      res.status(e.status).json({ error: { field: e.field, code: e.code, message: e.message } });
      return;
    }
    if (e instanceof ActivityModelError) { activityModelError(res, e); return; }
    next(e);
  }
});

router.get("/campaigns/:id", async (req, res, next) => {
  try {
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, req.params.id));
    if (!c) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json(await detail(c));
  } catch (e) {
    if (e instanceof GovernanceQuarantineError) {
      res.status(e.status).json({ error: { field: e.field, code: e.code, message: e.message } });
      return;
    }
    if (e instanceof ActivityModelError) { activityModelError(res, e); return; }
    next(e);
  }
});

router.patch("/campaigns/:id", async (req, res, next) => {
  try {
    assertNoFinalityRequest(req.body);
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
    const [currentStrategy] = await db.select().from(campaignStrategy).where(eq(campaignStrategy.campaignId, req.params.id));
    const currentInheritance = (currentStrategy?.inheritance ?? {}) as Record<string, unknown>;
    const proposedInheritance = req.body.inheritance !== undefined
      ? normalizeCampaignInheritance(currentInheritance, req.body.inheritance)
      : currentInheritance;
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
    const proposedCampaign = { ...current, name: patch.name ?? current.name };
    const canonicalActivities = await db.select().from(activities).where(and(
      eq(activities.campaignId, req.params.id),
      sql`${activities.activityTypeId} IS NOT NULL`,
    ));
    const hasMcp = canonicalActivities.some((activity) => activity.activityTypeId === "mcp");
    if (hasMcp) assertMcpSafe(req.body, "campaignUpdate");
    const refreshedActivities = canonicalActivities.map((activity) => {
      if (req.body.lifecycle === "Live" && activity.activityTypeId === "mcp") {
        assertMcpSafe({
          persisted: activity,
          effectiveInheritance: activity.effectiveInheritance,
          campaignName: proposedCampaign.name,
          generatedName: activity.generatedName,
        }, `activity.${activity.id}`);
      }
      const model = validateActivityModel({
        activityTypeId: activity.activityTypeId,
        name: activity.namingInput,
        answers: activity.activityAnswers,
        overrides: activity.activityOverrides,
        campaignName: proposedCampaign.name,
        inherited: inheritedFor(proposedCampaign, {
          ...currentStrategy,
          inheritance: proposedInheritance,
        } as typeof campaignStrategy.$inferSelect),
      });
      return { activity, model };
    });
    const c = await db.transaction(async (tx) => {
      if (req.body.lifecycle === "Live") {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${req.params.id}))`);
        await assertCampaignDeliverablesReady(req.params.id, tx);
      }
      const [updated] = await tx.update(campaigns).set({
        ...patch,
        rowVersion: sql`${campaigns.rowVersion} + 1`,
      }).where(and(eq(campaigns.id, req.params.id), eq(campaigns.rowVersion, version))).returning();
      if (!updated) {
        return null;
      }
      if (req.body.strategy !== undefined || req.body.inheritance !== undefined) {
        await tx.update(campaignStrategy).set({
          ...(req.body.strategy !== undefined ? { data: req.body.strategy } : {}),
          ...(req.body.inheritance !== undefined ? { inheritance: proposedInheritance } : {}),
          updatedAt: new Date(),
        }).where(eq(campaignStrategy.campaignId, req.params.id));
      }
      if (req.body.name !== undefined || req.body.inheritance !== undefined) {
        for (const { activity, model } of refreshedActivities) {
          await tx.update(activities).set({
            name: model.generatedName,
            generatedName: model.generatedName,
            effectiveInheritance: model.effectiveInheritance,
            rowVersion: sql`${activities.rowVersion} + 1`,
            updatedAt: new Date(),
          }).where(and(eq(activities.id, activity.id), eq(activities.campaignId, req.params.id)));
        }
      }
      return updated;
    });
    if (!c) {
      res.status(409).json({ error: "Campaign has changed", rowVersion: current.rowVersion });
      return;
    }
    res.json(await detail(c));
  } catch (e) {
    if (e instanceof GovernanceQuarantineError) {
      res.status(e.status).json({ error: { field: e.field, code: e.code, message: e.message } });
      return;
    }
    if (e instanceof ActivityModelError) { activityModelError(res, e); return; }
    if (e instanceof DeliverableError) {
      res.status(e.status).json({ error: { field: e.field, code: e.code, message: e.message } });
      return;
    }
    next(e);
  }
});

router.put("/campaigns/:id/map", async (req, res, next) => {
  try {
    assertNoFinalityRequest(req.body);
    const campaignVersion = expectedRowVersion(req);
    if (campaignVersion === undefined) {
      res.status(428).json({ error: "rowVersion is required for an existing campaign map" });
      return;
    }
    if (campaignVersion === null) {
      res.status(400).json({ error: "rowVersion must be a positive integer" });
      return;
    }
    const [existingCampaign] = await db.select().from(campaigns).where(eq(campaigns.id, req.params.id));
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
    const [activityStrategy] = await db.select().from(campaignStrategy).where(eq(campaignStrategy.campaignId, req.params.id));
    const inherited = inheritedFor(existingCampaign, activityStrategy);
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
        const activityTypeSupplied = Object.prototype.hasOwnProperty.call(n, "activityTypeId");
        const unchangedLegacyNull = activityTypeSupplied
          && n.activityTypeId === null
          && existing?.activityTypeId === null;
        if (activityTypeSupplied && !unchangedLegacyNull) {
          if (typeof n.activityTypeId !== "string" || n.activityTypeId === "") {
            throw new ActivityModelError("activityTypeId", "invalid_activity_type", "activityTypeId must be a non-empty canonical activity type ID");
          }
          activityConfiguration(n.activityTypeId);
          if (existing?.activityTypeId && n.activityTypeId !== existing.activityTypeId) {
            throw new ActivityModelError("activityTypeId", "activity_type_immutable", "A governed activity type cannot be changed");
          }
        }
        const activityTypeId = unchangedLegacyNull
          ? null
          : activityTypeSupplied ? n.activityTypeId : existing?.activityTypeId;
        let modelValues: Partial<typeof activities.$inferInsert> = {};
        if (activityTypeId) {
          assertNoSuppliedGeneratedIdentity(n, existing
            ? { path: "activity", allowUnchanged: { name: existing.name, generatedName: existing.generatedName } }
            : { path: "activity" });
          assertNoSuppliedGeneratedIdentity(n.webinarSetup, { path: "activity.webinarSetup" });
          if (!existing) {
            throw new ActivityModelError(
              "id",
              "map_activity_creation_not_allowed",
              "New activities must use the governed activity creation endpoint so the server assigns their UUID",
            );
          }
          if (activityTypeId === "mcp") assertMcpSafe(n, "activity");
          const namingInput = n.namingInput !== undefined ? n.namingInput : existing?.namingInput;
          const model = validateActivityModel({
            activityTypeId,
            name: namingInput,
            answers: n.answers ?? existing?.activityAnswers ?? {},
            overrides: n.overrides ?? existing?.activityOverrides ?? {},
            campaignName: existingCampaign.name,
            inherited,
          });
          modelValues = {
            name: model.generatedName,
            type: model.configuration.id,
            activityTypeId: model.configuration.id,
            activityAnswers: model.answers,
            activityOverrides: model.overrides,
            generatedName: model.generatedName,
            namingInput: namingInput === undefined || namingInput === null ? null : String(namingInput),
            effectiveInheritance: model.effectiveInheritance,
          };
        } else if (!existing) {
          throw new ActivityModelError("activityTypeId", "required", "New activities require a governed activityTypeId");
        } else {
          assertNoSuppliedGeneratedIdentity(n, {
            path: "activity",
            allowUnchanged: { name: existing.name, generatedName: existing.generatedName },
          });
          if (n.type !== existing.type) {
            throw new ActivityModelError("type", "legacy_type_immutable", "A legacy activity type cannot be changed; create a governed activity instead");
          }
        }
        const values = {
          name: n.name, type: n.type, audience: n.audience, region: n.region, timing: n.timing,
          status: n.status, owner: n.owner, conflict: n.conflict, decisionStatus: n.decisionStatus ?? "Estimated",
          x: String(n.position?.x ?? 0), y: String(n.position?.y ?? 0), updatedAt: new Date(), ...modelValues,
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
    if (e instanceof GovernanceQuarantineError) {
      res.status(e.status).json({ error: { field: e.field, code: e.code, message: e.message } });
      return;
    }
    if (e instanceof ActivityModelError) { activityModelError(res, e); return; }
    if (e && typeof e === "object" && "statusCode" in e && typeof e.statusCode === "number") {
      res.status(e.statusCode).json({ error: e instanceof Error ? e.message : "Map update rejected" });
      return;
    }
    next(e);
  }
});

router.post("/campaigns/:id/activities", async (req, res, next) => {
  try {
    assertNoFinalityRequest(req.body);
    assertNoSuppliedGeneratedIdentity(req.body, { includeId: true, path: "activity" });
    assertNoSuppliedGeneratedIdentity(req.body.webinarSetup, { path: "activity.webinarSetup" });
    const version = expectedRowVersion(req);
    if (version === undefined) {
      res.status(428).json({ error: "rowVersion is required for an existing campaign" });
      return;
    }
    if (version === null) {
      res.status(400).json({ error: "rowVersion must be a positive integer" });
      return;
    }
    const [existingCampaign] = await db.select().from(campaigns).where(eq(campaigns.id, req.params.id));
    if (!existingCampaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const [activityStrategy] = await db.select().from(campaignStrategy).where(eq(campaignStrategy.campaignId, req.params.id));
    if (req.body.activityTypeId === "mcp") assertMcpSafe(req.body, "activity");
    const model = validateActivityModel({
        activityTypeId: req.body.activityTypeId,
        name: req.body.namingInput,
        answers: req.body.answers ?? {},
        overrides: req.body.overrides ?? {},
        campaignName: existingCampaign.name,
        inherited: inheritedFor(existingCampaign, activityStrategy),
      });
    const [a] = await db.transaction(async (tx) => {
      const [campaign] = await tx.update(campaigns).set({
        rowVersion: sql`${campaigns.rowVersion} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(campaigns.id, req.params.id), eq(campaigns.rowVersion, version as number))).returning();
      if (!campaign) throw versionError(409, "Campaign has changed");
      const [activity] = await tx.insert(activities).values({
        name: model.generatedName, type: model.configuration.id, audience: req.body.audience, region: req.body.region,
        timing: req.body.timing, status: req.body.status, owner: req.body.owner,
        conflict: req.body.conflict ?? false, decisionStatus: req.body.decisionStatus ?? "Estimated",
        campaignId: req.params.id, x: String(req.body.position?.x ?? 0), y: String(req.body.position?.y ?? 0),
        activityTypeId: model.configuration.id, activityAnswers: model.answers,
        activityOverrides: model.overrides, generatedName: model.generatedName,
        namingInput: req.body.namingInput !== undefined && req.body.namingInput !== null ? String(req.body.namingInput) : null,
        effectiveInheritance: model.effectiveInheritance,
      }).returning();
      await ensureWebinarForActivity(req.params.id, activity, req.body.webinarSetup, tx);
      return [activity];
    });
    res.status(201).json(activityResponse(a, model.effectiveInheritance));
  } catch (e) {
    if (e instanceof GovernanceQuarantineError) {
      res.status(e.status).json({ error: { field: e.field, code: e.code, message: e.message } });
      return;
    }
    if (e instanceof ActivityModelError) { activityModelError(res, e); return; }
    if (e && typeof e === "object" && "statusCode" in e && typeof e.statusCode === "number") {
      res.status(e.statusCode).json({ error: e instanceof Error ? e.message : "Activity update rejected" });
      return;
    }
    next(e);
  }
});

const utmFieldCategories: Record<string, UtmCategoryKey> = {
  productLine: "product_line", campaignShortcode: "campaign_shortcode", subcampaign: "subcampaign",
  adsSubtype: "ads_subtype", objective: "utm_objective", audience: "audience",
  audienceSegment: "audience_segment", region: "utm_region", creativeType: "creative_type",
  imageSize: "image_size", videoLength: "video_length", contentType: "content_type",
  creativeCta: "creative_cta", contentOrder: "content_order", emailType: "email_type",
  owner: "owner", displayPartner: "display_partner", source: "source",
  captureSource: "capture_source", newsletterVersion: "newsletter_version",
  linkPosition: "link_position", nurtureSequence: "nurture_sequence",
};

const formulaRequiredFields: Record<UtmFormula, string[]> = {
  paid_search: ["productLine", "campaignShortcode", "subcampaign", "adsSubtype", "objective", "audience", "audienceSegment"],
  paid_social: ["productLine", "campaignShortcode", "subcampaign", "adsSubtype", "objective", "audience", "audienceSegment", "creativeType", "contentType", "creativeCta"],
  display: ["productLine", "campaignShortcode", "subcampaign", "adsSubtype", "objective", "audience", "audienceSegment", "creativeType", "contentType", "creativeCta"],
  newsletter_email: ["owner", "productLine", "campaignShortcode", "subcampaign", "objective", "audience", "newsletterVersion", "linkPosition", "contentType"],
  nurture_email: ["owner", "productLine", "campaignShortcode", "subcampaign", "objective", "audience"],
  pre_event_email: ["owner", "productLine", "campaignShortcode", "subcampaign", "emailType", "objective", "audience", "creativeCta", "contentType"],
  post_event_email: ["owner", "productLine", "campaignShortcode", "subcampaign", "emailType", "objective", "audience", "creativeCta", "contentType"],
  events: ["productLine", "campaignShortcode", "subcampaign", "region", "captureSource"],
};

class UtmGovernanceError extends Error {
  constructor(public field: string, public code: string, message: string) { super(message); }
}

function utmError(res: any, status: number, field: string, code: string, message: string) {
  res.status(status).json({ error: { field, code, message } });
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new UtmInputError(field, "invalid_type", `${field} must be a string`);
  if (value.trim().toLowerCase() === "undefined") throw new UtmInputError(field, "invalid_value", `${field} cannot be "undefined"`);
  return value;
}

router.post("/campaigns/:id/utm-links", async (req, res, next) => {
  try {
    assertNoFinalityRequest(req.body);
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, req.params.id));
    if (!c) { utmError(res, 404, "campaignId", "not_found", "Campaign not found"); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const allowedFields = new Set([
      "channel", "destinationUrl", ...Object.keys(utmFieldCategories), "keyword", "term",
      "sendDate", "eventDate", "automationName", "eventName", "creativeDescription",
      "eventCta", "salesforceCampaignId",
    ]);
    const unknownField = Object.keys(body).find((field) => !allowedFields.has(field));
    if (unknownField) throw new UtmInputError(unknownField, "unknown_field", `${unknownField} is not accepted`);
    const channelReference = optionalString(body, "channel");
    if (!channelReference) throw new UtmGovernanceError("channel", "required", "channel is required");

    const [version] = await db.select().from(taxonomyVersions)
      .where(sql`${taxonomyVersions.effectiveAt} <= now() AND (${taxonomyVersions.deprecatedAt} IS NULL OR ${taxonomyVersions.deprecatedAt} > now())`)
      .orderBy(desc(taxonomyVersions.effectiveAt)).limit(1);
    if (!version) throw new UtmGovernanceError("channel", "no_effective_taxonomy", "No taxonomy version is currently in effect");

    const versionTerms = await db.select().from(taxonomyTerms).where(eq(taxonomyTerms.versionId, version.id));
    const now = Date.now();
    const activeTerms = versionTerms.filter((term) =>
      !term.isDeprecated && !term.supersededBy && (!term.deprecatedAt || term.deprecatedAt.valueOf() > now));
    const findGovernedPreviewValue = (field: string, category: UtmCategoryKey, reference: string, expectedParentId?: string) => {
      const normalized = reference.trim().toLowerCase();
      const subject = field === "channel" ? `channel ${JSON.stringify(reference)}` : field;
      const categoryTerms = versionTerms.filter((term) => term.category === category);
      const idMatch = categoryTerms.find((term) => term.id.toLowerCase() === normalized);
      const stableKeyMatch = categoryTerms.find((term) => term.stableKey?.toLowerCase() === normalized);
      const identityMatch = idMatch ?? stableKeyMatch;
      const unscopedMatches = identityMatch ? [identityMatch] : categoryTerms.filter((term) =>
        term.shortcode.toLowerCase() === normalized || term.label.toLowerCase() === normalized);
      const matches = identityMatch || expectedParentId === undefined
        ? unscopedMatches
        : unscopedMatches.filter((term) => term.parentId === expectedParentId);
      if (!matches.length && expectedParentId !== undefined && unscopedMatches.length) {
        const expectedParent = field === "campaignShortcode" ? "productLine" : "campaignShortcode";
        throw new UtmGovernanceError(field, "invalid_hierarchy", `${field} must be a child of ${expectedParent}`);
      }
      if (!matches.length) throw new UtmGovernanceError(field, "not_governed", `${subject} is not a governed ${category} value`);
      const activeMatches = matches.filter((term) => activeTerms.some((active) => active.id === term.id));
      if (!activeMatches.length) throw new UtmGovernanceError(field, "inactive", `${subject} is not an active ${category} value`);
      if (activeMatches.length > 1) {
        throw new UtmGovernanceError(field, "ambiguous", `${subject} matches multiple active ${category} values; supply the term ID`);
      }
      const matched = activeMatches[0];
      return matched;
    };

    const channel = findGovernedPreviewValue("channel", "channel", channelReference);
    const metadata = channel.sourceMetadata && typeof channel.sourceMetadata === "object"
      ? channel.sourceMetadata as Record<string, unknown> : {};
    const channelId = channel.shortcode.toLowerCase();
    const directFormula: Partial<Record<string, UtmFormula>> = {
      psg: "paid_search", psl: "paid_social", disp: "display",
      evlv: "events", evind: "events", evvrt: "events",
    };
    const metadataFormula = typeof metadata.formulaKey === "string"
      && Object.prototype.hasOwnProperty.call(formulaRequiredFields, metadata.formulaKey)
      ? metadata.formulaKey as UtmFormula
      : undefined;
    let formula = directFormula[channelId] ?? metadataFormula;
    let resolvedEmailType: typeof taxonomyTerms.$inferSelect | undefined;
    if (["eml", "emlc", "emlp"].includes(channelId)) {
      const emailReference = optionalString(body, "emailType");
      if (!emailReference) throw new UtmGovernanceError("emailType", "required", `emailType is required for ${channel.label}`);
      resolvedEmailType = findGovernedPreviewValue("emailType", "email_type", emailReference);
      const emailKind = `${resolvedEmailType.shortcode} ${resolvedEmailType.label}`.toLowerCase();
      formula = emailKind.includes("newsletter") ? "newsletter_email"
        : emailKind.includes("nurture") ? "nurture_email"
        : emailKind.includes("post-event") || emailKind.includes("post event") ? "post_event_email"
        : emailKind.includes("event invitation") ? "pre_event_email"
        : undefined;
    }
    if (!formula) {
      throw new UtmGovernanceError("channel", "unsupported_formula", `channel ${JSON.stringify(channelReference)} does not have a specified UTM formula`);
    }
    if (typeof metadata.utmSource !== "string" || !metadata.utmSource.trim()) {
      throw new UtmGovernanceError("channel", "missing_source_metadata", "channel is missing utmSource metadata");
    }
    if (typeof metadata.utmMedium !== "string" || !metadata.utmMedium.trim()) {
      throw new UtmGovernanceError("channel", "missing_medium_metadata", "channel is missing utmMedium metadata");
    }

    const governedTerms = new Map<string, typeof taxonomyTerms.$inferSelect>();
    if (resolvedEmailType) governedTerms.set("emailType", resolvedEmailType);
    for (const [field, category] of Object.entries(utmFieldCategories)) {
      if (field === "productLine" || field === "campaignShortcode" || field === "subcampaign") continue;
      const reference = optionalString(body, field);
      if (reference) governedTerms.set(field, findGovernedPreviewValue(field, category, reference));
    }
    const productLineReference = optionalString(body, "productLine");
    if (productLineReference) {
      const product = findGovernedPreviewValue("productLine", "product_line", productLineReference);
      governedTerms.set("productLine", product);
      const campaignReference = optionalString(body, "campaignShortcode");
      if (campaignReference) {
        const campaignTerm = findGovernedPreviewValue("campaignShortcode", "campaign_shortcode", campaignReference, product.id);
        governedTerms.set("campaignShortcode", campaignTerm);
        const subcampaignReference = optionalString(body, "subcampaign");
        if (subcampaignReference) {
          governedTerms.set(
            "subcampaign",
            findGovernedPreviewValue("subcampaign", "subcampaign", subcampaignReference, campaignTerm.id),
          );
        }
      }
    }
    for (const field of formulaRequiredFields[formula]) {
      if (!governedTerms.has(field)) {
        throw new UtmGovernanceError(field, "required", `${field} is required for ${channel.label}`);
      }
    }
    if ((formula === "paid_social" || formula === "display")) {
      const hasImage = governedTerms.has("imageSize");
      const hasVideo = governedTerms.has("videoLength");
      if (hasImage === hasVideo) {
        throw new UtmGovernanceError("imageSize", "exactly_one_required", "Exactly one of imageSize or videoLength is required");
      }
    }
    const product = governedTerms.get("productLine")!;
    const campaignShortcode = governedTerms.get("campaignShortcode")!;
    const subcampaign = governedTerms.get("subcampaign")!;
    if (campaignShortcode.parentId !== product.id) {
      throw new UtmGovernanceError("campaignShortcode", "invalid_hierarchy", "campaignShortcode must be a child of productLine");
    }
    if (subcampaign.parentId !== campaignShortcode.id) {
      throw new UtmGovernanceError("subcampaign", "invalid_hierarchy", "subcampaign must be a child of campaignShortcode");
    }

    const values: Partial<Record<UtmCategoryKey, string>> = {};
    for (const [field, term] of governedTerms) values[utmFieldCategories[field]] = normalizeGoverned(term.shortcode);
    const displayPartner = governedTerms.get("displayPartner");
    const sourceOverride = governedTerms.get("source");
    const salesforceCampaignId = optionalString(body, "salesforceCampaignId");
    if (salesforceCampaignId && !/^701[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(salesforceCampaignId)) {
      throw new UtmInputError("salesforceCampaignId", "invalid_format", "salesforceCampaignId must be a 15 or 18 character Salesforce Campaign ID beginning with 701");
    }
    const compiled = compileUtm({
      formula,
      values,
      keyword: optionalString(body, "keyword") ?? optionalString(body, "term"),
      sendDate: optionalString(body, "sendDate"),
      eventDate: optionalString(body, "eventDate"),
      automationName: optionalString(body, "automationName"),
      eventName: optionalString(body, "eventName"),
      creativeDescription: optionalString(body, "creativeDescription"),
      eventCta: optionalString(body, "eventCta"),
      channelSource: normalizeGoverned(displayPartner?.shortcode ?? sourceOverride?.shortcode ?? String(metadata.utmSource)),
      channelMedium: normalizeGoverned(String(metadata.utmMedium)),
      salesforceCampaignId,
    });
    const destinationUrl = optionalString(body, "destinationUrl");
    if (!destinationUrl) {
      res.status(200).json({
        id: null, destinationUrl: null, fullUrl: null, taxonomyVersion: version.version,
        parameters: compiled.parameters, automationName: compiled.automationName,
        validation: "Valid", status: "Provisional preview",
        governance: compiled.governance,
        message: `Destination URL is required to build the full link. ${PROVISIONAL_GOVERNANCE.label}`,
      });
      return;
    }
    const fullUrl = appendUtm(destinationUrl, compiled.parameters);
    const [u] = await db.insert(utmLinks).values({
      campaignId: c.id, destinationUrl, fullUrl, taxonomyVersion: version.version,
      generatedValues: compiled.parameters, validation: "Valid", status: "Draft",
    }).returning();
    res.status(201).json({
      id: u.id, destinationUrl: u.destinationUrl, fullUrl: u.fullUrl,
      taxonomyVersion: u.taxonomyVersion, parameters: compiled.parameters,
      automationName: compiled.automationName, validation: u.validation,
      status: u.status, governance: compiled.governance,
      message: PROVISIONAL_GOVERNANCE.label,
    });
  } catch (e) {
    if (e instanceof GovernanceQuarantineError) { utmError(res, e.status, e.field, e.code, e.message); return; }
    if (e instanceof UtmGovernanceError) { utmError(res, 422, e.field, e.code, e.message); return; }
    if (e instanceof UtmInputError) { utmError(res, 400, e.field, e.code, e.message); return; }
    next(e);
  }
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
    await syncCapacityConflicts();
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
    res.json({
      version: v?.version ?? "2026.1",
      activityTypes: ACTIVITY_TYPE_CONFIGURATIONS.map((configuration) => configuration.id),
      taxonomyTerms: terms.map((t) => ({
        category: t.category, label: t.label, shortcode: t.shortcode,
        source_environment: "development",
        verification_status: "provisional",
        publishing_eligible: false,
        source_reference: "Campaign Governance Foundation, migrated via audit",
        requires_business_validation: true,
        governance: PROVISIONAL_GOVERNANCE,
      })),
      namingExamples: [],
      governance: PROVISIONAL_GOVERNANCE,
    });
  } catch (e) { next(e); }
});

router.get("/adapters/status", (_req, res) => res.json({
  airtable: { configured: process.env.AIRTABLE_ENABLED === "true" && !!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN && !!process.env.AIRTABLE_BASE_ID, mode: "Manual sync", status: process.env.AIRTABLE_ENABLED === "true" ? "Configuration incomplete" : "Not configured", errors: [] },
  ai: { configured: !!process.env.AI_PROVIDER, mode: "Explicit acceptance", actions: ["Draft", "Recommend", "Critique", "Explain conflict"], status: process.env.AI_PROVIDER ? "Available" : "Not configured" },
}));

router.get("/campaigns/:id/export/:format", async (req, res, next) => {
  try {
    assertNoFinalityRequest(req.query, "query");
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, req.params.id));
    if (!c) { res.status(404).send("Campaign not found"); return; }
    const map = await mapFor(c.id);
    res.setHeader("X-Governance-Status", "provisional-not-approved");
    res.setHeader("X-External-Publishing-Allowed", "false");
    if (req.params.format === "json") {
      res.type("application/json").send(JSON.stringify({
        governance: PROVISIONAL_GOVERNANCE,
        campaign: await detail(c),
      }, null, 2));
      return;
    }
    if (req.params.format === "utm-csv") {
      const links = await db.select().from(utmLinks).where(eq(utmLinks.campaignId, c.id));
      res.type("text/csv").send([
        "Provisional label,Destination URL,Tagged URL,Taxonomy version,Validation,Status,Governance approved,External publishing eligible",
        ...links.map((u) => [PROVISIONAL_GOVERNANCE.label, u.destinationUrl, u.fullUrl, u.taxonomyVersion, u.validation, u.status, false, false].map((x) => JSON.stringify(x)).join(",")),
      ].join("\n")); return;
    }
    if (req.params.format === "activities-csv") {
      res.type("text/csv").send([
        "Provisional label,Name,Type,Audience,Region,Timing,Status,Owner,Governance approved",
        ...map.activities.map((a) => [PROVISIONAL_GOVERNANCE.label, a.name, a.type, a.audience, a.region, a.timing, a.status, a.owner, false].map((x) => JSON.stringify(x)).join(",")),
      ].join("\n")); return;
    }
    res.type("text/plain").send(`${PROVISIONAL_GOVERNANCE.label}\n${PROVISIONAL_GOVERNANCE.message}\n\n${c.name}\n${c.scope} · ${c.region}\nAudience: ${c.audience}\nOutcome: ${c.outcome}\nTiming: ${c.timing}\nReadiness: ${c.readiness}%\n\nAudience journey\n${map.activities.map((a) => `• [PROVISIONAL] ${a.name} — ${a.timing} — ${a.status}`).join("\n")}`);
  } catch (e) {
    if (e instanceof GovernanceQuarantineError) {
      res.status(e.status).json({ error: { field: e.field, code: e.code, message: e.message } });
      return;
    }
    next(e);
  }
});

export default router;