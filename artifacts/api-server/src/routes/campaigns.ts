import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, campaigns, campaignStrategy, activities, activityConnections,
  conflicts, taxonomyTerms, taxonomyVersions, utmLinks,
} from "@workspace/db";

const router: IRouter = Router();

const summary = (c: typeof campaigns.$inferSelect) => ({
  id: c.id, parentId: c.parentId, name: c.name, scope: c.scope, region: c.region,
  audience: c.audience, outcome: c.outcome, lifecycle: c.lifecycle,
  readiness: c.readiness, timing: c.timing, owner: c.owner, updatedAt: c.updatedAt.toISOString(),
});

async function mapFor(campaignId: string) {
  const [nodes, edges] = await Promise.all([
    db.select().from(activities).where(eq(activities.campaignId, campaignId)),
    db.select().from(activityConnections).where(eq(activityConnections.campaignId, campaignId)),
  ]);
  return {
    activities: nodes.map((a) => ({ id: a.id, name: a.name, type: a.type, audience: a.audience, region: a.region, timing: a.timing, status: a.status, owner: a.owner, conflict: a.conflict, decisionStatus: a.decisionStatus, position: { x: Number(a.x), y: Number(a.y) } })),
    connections: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, trigger: e.trigger, timing: e.timing, exclusions: e.exclusions as string[], sentence: e.sentence })),
  };
}

async function detail(c: typeof campaigns.$inferSelect) {
  const [strategy] = await db.select().from(campaignStrategy).where(eq(campaignStrategy.campaignId, c.id));
  const links = await db.select().from(utmLinks).where(eq(utmLinks.campaignId, c.id));
  return {
    ...summary(c), strategy: (strategy?.data ?? {}) as Record<string, unknown>,
    inheritance: (strategy?.inheritance ?? {}) as Record<string, string>,
    map: await mapFor(c.id),
    utmLinks: links.map((u) => ({ id: u.id, destinationUrl: u.destinationUrl, fullUrl: u.fullUrl, taxonomyVersion: u.taxonomyVersion, validation: u.validation, status: u.status })),
  };
}

router.get("/campaigns", async (_req, res, next) => {
  try { res.json((await db.select().from(campaigns)).map(summary)); } catch (e) { next(e); }
});

router.post("/campaigns", async (req, res, next) => {
  try {
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
    const patch: Partial<typeof campaigns.$inferInsert> = { updatedAt: new Date() };
    if (req.body.name) patch.name = req.body.name;
    if (req.body.lifecycle) patch.lifecycle = req.body.lifecycle;
    const [c] = await db.update(campaigns).set(patch).where(eq(campaigns.id, req.params.id)).returning();
    if (req.body.strategy) await db.update(campaignStrategy).set({ data: req.body.strategy, updatedAt: new Date() }).where(eq(campaignStrategy.campaignId, req.params.id));
    res.json(await detail(c));
  } catch (e) { next(e); }
});

router.put("/campaigns/:id/map", async (req, res, next) => {
  try {
    await db.transaction(async (tx) => {
      for (const n of req.body.activities ?? []) {
        await tx.update(activities).set({ name: n.name, type: n.type, audience: n.audience, region: n.region, timing: n.timing, status: n.status, owner: n.owner, conflict: n.conflict, decisionStatus: n.decisionStatus ?? "Estimated", x: String(n.position.x), y: String(n.position.y), updatedAt: new Date() }).where(and(eq(activities.id, n.id), eq(activities.campaignId, req.params.id)));
      }
      await tx.delete(activityConnections).where(eq(activityConnections.campaignId, req.params.id));
      if (req.body.connections?.length) await tx.insert(activityConnections).values(req.body.connections.map((e: any) => ({ id: e.id, campaignId: req.params.id, source: e.source, target: e.target, trigger: e.trigger, timing: e.timing, exclusions: e.exclusions ?? [], sentence: e.sentence })));
    });
    res.json(await mapFor(req.params.id));
  } catch (e) { next(e); }
});

router.post("/campaigns/:id/activities", async (req, res, next) => {
  try {
    const [a] = await db.insert(activities).values({ ...req.body, campaignId: req.params.id, x: String(req.body.position.x), y: String(req.body.position.y) }).returning();
    res.status(201).json({ ...a, position: { x: Number(a.x), y: Number(a.y) } });
  } catch (e) { next(e); }
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