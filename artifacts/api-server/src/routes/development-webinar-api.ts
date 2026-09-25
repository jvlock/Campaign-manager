import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { loadWebinarApiContext, projection, webinarSummary, evaluateWebinarApi,
  historyWebinarApi, submitWebinarEvidence, requestDraftException,
  evidenceInput, exceptionInput, classifyWebinarApiError } from "../lib/webinar-standard-api";
import { inspectFoundationObservations } from "../lib/webinar-foundation-service";
import { configuredFoundationProvider } from "../lib/webinar-foundation";

const router = Router();
const uuid = z.string().uuid();
const params = z.object({ campaignId: uuid, sessionId: uuid }).strict();
const empty = z.object({}).strict();
const evaluationInput = z.object({
  expectedRevision: z.number().int().nonnegative(), idempotencyKey: uuid,
  // Explicit fixed clock is permitted only on this isolated diagnostic development API.
  // It is required here so an exact retry is deterministic without a process-local cache.
  calculationAt: z.string().datetime({ offset: true }),
}).strict();
const page = z.object({
  afterRevision: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const path = "/campaigns/:campaignId/webinars/:sessionId/standard";
const sendError = (error: unknown, res: Response, _next: NextFunction) => {
  const mapped = classifyWebinarApiError(error);
  res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message } });
};
function validate(req: Request, res: Response, body: z.ZodTypeAny = empty, query: z.ZodTypeAny = empty) {
  const p = params.safeParse(req.params);
  const b = body.safeParse(req.body ?? {});
  const q = query.safeParse(req.query);
  const bytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8");
  if (bytes > 16_384 || Number(req.headers["content-length"] ?? 0) > 16_384) {
    res.status(413).json({ error: { code: "VALIDATION_ERROR", message: "Request exceeds webinar API payload limit" } });
    return null;
  }
  if (req.headers["x-actor-id"] || req.headers["x-actor-role"] || req.headers["x-provider-provenance"]) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Client identity and provider provenance are not accepted" } });
    return null;
  }
  if (!p.success || !b.success || !q.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid scoped webinar API request" } });
    return null;
  }
  return { scope: { campaignId: p.data.campaignId as string, sessionId: p.data.sessionId as string },
    body: b.data, query: q.data };
}
for (const resource of ["summary", "evaluations", "readiness", "completion"] as const) {
  router.get(`${path}/${resource}`, async (req, res, next) => {
    const parsed = validate(req, res);
    if (!parsed) return;
    try {
      const context = await loadWebinarApiContext(parsed.scope);
      res.json(resource === "summary" ? await webinarSummary(context) : projection(context, resource));
    }
    catch (error) { sendError(error, res, next); }
  });
}
router.post(`${path}/evaluations`, async (req, res, next) => {
  const parsed = validate(req, res, evaluationInput);
  if (!parsed) return;
  try {
    const context = await loadWebinarApiContext(parsed.scope);
    res.json(await evaluateWebinarApi(parsed.scope, context.sources.activity.id, parsed.body));
  } catch (error) { sendError(error, res, next); }
});
router.get(`${path}/evidence`, async (req, res, next) => {
  const parsed = validate(req, res);
  if (!parsed) return;
  try {
    const context = await loadWebinarApiContext(parsed.scope);
    // Project only the already persisted, occurrence-scoped source identities.
    // Match the POST's existing source/receipt inspection at this read's as-of
    // instant; POST still independently validates every assertion in its lock.
    const inspections = new Map<string, ReturnType<typeof inspectFoundationObservations>>();
    const availableSources = context.sources.records.filter(r => r.kind === "source").map(r => {
      let unavailableReason: string | null = r.payload.status === "available" ? null : String(r.payload.status ?? "unavailable");
      if (!unavailableReason && Date.parse(r.payload.observedAt as string) > Date.parse(context.retrievedAt))
        unavailableReason = "not_yet_observed";
      if (!unavailableReason && r.payload.sourceType === "foundation") {
        const receipt = r.payload.governedReceipt as {
          response?: { status?: string }; releaseFingerprint?: string;
          request?: { type?: string; inputFingerprint?: string };
        } | undefined;
        if (!receipt || receipt.response?.status !== "success" || !receipt.releaseFingerprint || !receipt.request)
          unavailableReason = "governed_receipt_unavailable";
        else {
          let inspected = inspections.get(receipt.releaseFingerprint);
          if (!inspected) {
            inspected = inspectFoundationObservations(context.sources, new Date(context.retrievedAt),
              configuredFoundationProvider(), receipt.releaseFingerprint);
            inspections.set(receipt.releaseFingerprint, inspected);
          }
          const observation = inspected.observations.find(o =>
            o.type === receipt.request?.type && o.inputFingerprint === receipt.request?.inputFingerprint);
          if (!observation || observation.status !== "available")
            unavailableReason = observation?.status ?? "unavailable";
        }
      }
      return { sourceId: r.id, sourceType: r.payload.sourceType,
        sourceVersion: r.payload.sourceVersion, sourceHash: r.payload.sourceHash,
        usable: unavailableReason === null, unavailableReason };
    });
    res.json({ campaignId: parsed.scope.campaignId, activityId: context.sources.activity.id, occurrenceId: parsed.scope.sessionId,
      retrievedAt: context.retrievedAt, revision: context.sources.binding!.revision, simulationOnly: true,
      availableSources,
      records: context.sources.records.filter(r => r.kind === "evidence").map(r => ({
        id: r.id, revision: r.revision, sourceId: r.parent_id, type: r.payload.evidenceType,
        sourceType: context.sources.records.find(parent => parent.id === r.parent_id)?.payload.sourceType ?? null,
        sourceVersion: context.sources.records.find(parent => parent.id === r.parent_id)?.payload.sourceVersion ?? null,
        sourceHash: context.sources.records.find(parent => parent.id === r.parent_id)?.payload.sourceHash ?? null,
        result: r.payload.result, recordedAt: r.recorded_at, authenticated: false, unverified: true })) });
  } catch (error) { sendError(error, res, next); }
});
router.post(`${path}/evidence`, async (req, res, next) => {
  const parsed = validate(req, res, evidenceInput);
  if (!parsed) return;
  try {
    const context = await loadWebinarApiContext(parsed.scope);
    res.status(201).json(await submitWebinarEvidence(parsed.scope, context.sources.activity.id, parsed.body));
  } catch (error) { sendError(error, res, next); }
});
router.get(`${path}/exceptions`, async (req, res, next) => {
  const parsed = validate(req, res);
  if (!parsed) return;
  try {
    const context = await loadWebinarApiContext(parsed.scope);
    res.json({ campaignId: parsed.scope.campaignId, activityId: context.sources.activity.id,
      occurrenceId: parsed.scope.sessionId, retrievedAt: context.retrievedAt, simulationOnly: true,
      reviewAvailable: false, records: context.sources.records.filter(r => r.kind === "exception-request").map(r => ({
        id: r.id, revision: r.revision, ruleId: r.payload.ruleId, evidenceId: r.parent_id,
        reasonCode: r.payload.reasonCode, recordedAt: r.recorded_at,
        requestedExpiresAt: context.exceptionAudits[r.id]?.expiresAt ?? null,
        status: "draft-unverified", resolvesBlocker: false })) });
  } catch (error) { sendError(error, res, next); }
});
router.post(`${path}/exceptions`, async (req, res, next) => {
  const parsed = validate(req, res, exceptionInput);
  if (!parsed) return;
  try {
    const context = await loadWebinarApiContext(parsed.scope);
    res.status(201).json(await requestDraftException(parsed.scope, context.sources.activity.id, parsed.body));
  } catch (error) { sendError(error, res, next); }
});
router.post(`${path}/exceptions/:exceptionId/review`, (req, res) => {
  const p = params.extend({ exceptionId: uuid }).strict().safeParse(req.params);
  const b = empty.safeParse(req.body ?? {});
  if (Number(req.headers["content-length"] ?? 0) > 16_384) {
    res.status(413).json({ error: { code: "VALIDATION_ERROR", message: "Request exceeds webinar API payload limit" } }); return;
  }
  if (!p.success || !b.success || Object.keys(req.query).length || Buffer.byteLength(JSON.stringify(req.body ?? {})) > 16_384) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid exception review request" } }); return;
  }
  // Open-development has no trusted reviewer identity. Never read a client-provided role.
  res.status(403).json({ error: { code: "UNAUTHORIZED",
    message: "Exception review requires independently verified reviewer identity and authorization" } });
});
router.get(`${path}/history`, async (req, res, next) => {
  const parsed = validate(req, res, empty, page);
  if (!parsed) return;
  try {
    const context = await loadWebinarApiContext(parsed.scope);
    res.json(await historyWebinarApi(context, parsed.query.afterRevision, parsed.query.limit));
  } catch (error) { sendError(error, res, next); }
});
router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Neither SQL errors nor provider exceptions or stack traces may cross this contract.
  if (res.headersSent) return;
  res.status(503).json({ error: { code: "INTERNAL_ERROR",
    message: "Synthetic webinar operation could not be completed; retry after checking development availability" } });
});
export default router;