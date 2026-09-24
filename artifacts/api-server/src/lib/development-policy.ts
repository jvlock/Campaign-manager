import type { RequestHandler } from "express";

// Deliberate method + path allowlist. New router operations remain closed.
const rules: [string, RegExp][] = [
  ["GET", /^\/(?:campaigns|portfolio|activity-model\/catalog|task-defaults|owner-capacities)$/],
  ["POST", /^\/(?:campaigns|activity-model\/render-name|conflicts\/run)$/],
  ["GET", /^\/campaigns\/[^/]+$/],
  ["PATCH", /^\/campaigns\/[^/]+$/],
  ["PUT", /^\/campaigns\/[^/]+\/map$/],
  ["GET", /^\/campaigns\/[^/]+\/activities\/[^/]+\/task-settings$/],
  ["PATCH", /^\/campaigns\/[^/]+\/activities\/[^/]+\/task-settings$/],
  ["POST", /^\/campaigns\/[^/]+\/(?:activities|communications|tasks|ctas|landing-pages|content-assets|schedule-rules|webinars)$/],
  ["GET", /^\/campaigns\/[^/]+\/(?:delivery|deliverables|schedule-rules|scheduled-instances|webinars)$/],
  ["PATCH", /^\/campaigns\/[^/]+\/(?:communications|tasks|ctas|landing-pages|content-assets|schedule-rules)\/[^/]+$/],
  ["POST", /^\/campaigns\/[^/]+\/communications\/[^/]+\/(?:ctas|landing-pages)$/],
  ["PUT", /^\/campaigns\/[^/]+\/communications\/[^/]+\/dependencies$/],
  ["POST", /^\/campaigns\/[^/]+\/schedule-rules\/recompute$/],
  ["PATCH", /^\/campaigns\/[^/]+\/scheduled-instances\/[^/]+\/adjust$/],
  ["GET", /^\/campaigns\/[^/]+\/webinars\/[^/]+(?:\/(?:evaluation|standard|standard\/eligibility))?$/],
  ["PATCH", /^\/campaigns\/[^/]+\/webinars\/[^/]+(?:\/standard)?$/],
  ["POST", /^\/campaigns\/[^/]+\/webinars\/[^/]+\/evaluate$/],
  ["GET", /^\/development\/(?:groups|calendar|ownership\/(?:campaigns|activities)\/[^/]+)$/],
  ["GET", /^\/development\/simulations\/context$/],
  ["POST", /^\/development\/(?:groups|simulations)$/],
  ["GET", /^\/development\/participants\/(?:context|fixtures|population|suppression|history)$/],
  ["POST", /^\/development\/participants\/(?:fixtures|transitions)$/],
  ["GET", /^\/development\/foundation\/observations$/],
  ["POST", /^\/development\/foundation\/observations\/refresh$/],
  // Read and simulation-only contracts are scoped to the existing webinar occurrence.
  ["GET", /^\/campaigns\/[^/]+\/webinars\/[^/]+\/standard\/(?:summary|evaluations|readiness|completion|evidence|exceptions|history)$/],
  ["POST", /^\/campaigns\/[^/]+\/webinars\/[^/]+\/standard\/(?:evaluations|evidence|exceptions)$/],
  ["POST", /^\/campaigns\/[^/]+\/webinars\/[^/]+\/standard\/exceptions\/[^/]+\/review$/],
  ["PUT", /^\/development\/ownership\/(?:campaigns|activities)\/[^/]+$/],
];
export function allowsDevelopmentPlanning(method: string, path: string): boolean {
  return rules.some(([verb, pattern]) => verb === method && pattern.test(path));
}
export const developmentPolicy: RequestHandler = (req, res, next) => {
  if (!allowsDevelopmentPlanning(req.method, req.path)) {
    res.status(403).json({ error: { code: "development_operation_blocked", message: "Only isolated planning is enabled. Operational, authority, export and destructive actions are disabled." } });
    return;
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    const origin = req.get("origin");
    // No identity is inferred from these headers. They only prevent browser cross-site writes.
    if (req.get("sec-fetch-site") === "cross-site" || (origin && (() => {
      try { return new URL(origin).host !== req.get("host"); } catch { return true; }
    })())) {
      res.status(403).json({ error: { code: "origin_rejected", message: "Planning mutations require a same-origin browser request." } });
      return;
    }
  }
  res.setHeader("X-Planning-Attribution", "unverified-development");
  res.locals.openDevelopment = true;
  next();
};