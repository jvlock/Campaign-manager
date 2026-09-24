import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { configuredFoundationProvider } from "../lib/webinar-foundation";
import { inspectFoundationObservations, refreshFoundationObservations, type FoundationInspection } from "../lib/webinar-foundation-service";
import { assertOccurrenceEligibility, loadOccurrenceSources } from "../lib/webinar-evaluation-sources";
import type { OccurrenceSources } from "../lib/webinar-evaluation-sources";
import { PersistenceConflict } from "../lib/webinar-persistence";
import { captureWebinarRelease } from "../lib/webinar-release-provenance";
import { classifyWebinarApiError } from "../lib/webinar-standard-api";

const router = Router();
const uuid = z.string().uuid();
const scope = z.object({ campaignId: uuid, activityId: uuid, occurrenceId: uuid }).strict();
const refresh = scope.extend({
  expectedRevision: z.number().int().nonnegative(),
  calculationAt: z.string().datetime({ offset: true }),
  idempotencyKey: uuid,
}).strict();
const affectedRules: Record<string, string[]> = {
  taxonomy: ["WEB-RDY-REC-008", "WEB-QA-005"],
  internal_title: ["WEB-RDY-REC-008"],
  campaign_code: ["WEB-RDY-REC-008"],
  utm: ["WEB-RDY-REC-008", "WEB-QA-005"],
  objective_membership: ["WEB-SETUP-003"],
  campaign_exclusion: ["WEB-REC-010"],
};
const governedOutputs = ["taxonomy", "internal_title", "campaign_code", "utm",
  "objective_membership", "campaign_exclusion"] as const;
function present(inspection: FoundationInspection, revision: number, sources: OccurrenceSources,
  freshReceipts: readonly { request: { inputFingerprint: string }; receivedAt: string }[] = []) {
  return {
    ...inspection, observations: [...inspection.observations.map(item => {
      const receiptRow = sources.records.filter(record => record.kind === "source" && record.payload.sourceType === "foundation")
        .filter(record => {
          const receipt = record.payload.governedReceipt as { request?: { inputFingerprint?: string; type?: string } } | undefined;
          return receipt?.request?.inputFingerprint === item.inputFingerprint && receipt.request.type === item.type;
        }).at(-1);
      const receipt = receiptRow?.payload.governedReceipt as {
        receivedAt: string; supersedesId: string | null; response: { environment: string };
      } | undefined;
      return {
      ...item, status: item.type === "taxonomy" ? item.status : "unsupported",
      observationState: item.status, error: item.type === "taxonomy" ? item.error : "unsupported",
      affectedRules: affectedRules[item.type] ?? [],
      supportedByFixture: item.type === "taxonomy",
      providerConfigured: inspection.connectorConfigured,
      providerKind: inspection.connectorConfigured ? "synthetic-contract-only" : "unconfigured",
      environment: item.response?.environment ?? receipt?.response.environment ?? "synthetic-only",
      validity: item.type === "taxonomy" ? item.status : "unsupported",
      effectiveVersion: item.type === "taxonomy" ? item.response?.taxonomyVersion ?? item.response?.serviceVersion ?? null : null,
      providerIdentity: item.response?.serviceId ?? null,
      validFrom: item.response?.validFrom ?? null,
      observationId: receiptRow?.id ?? null,
      observationCreatedAt: receiptRow?.recorded_at ?? null,
      supersedesId: receipt?.supersedesId ?? null,
      supersessionState: receiptRow ? sources.records.some(r => r.kind === "source"
        && (r.payload.governedReceipt as { supersedesId?: string | null } | undefined)?.supersedesId === receiptRow.id)
        ? "superseded" : "latest-for-input" : "no-matching-receipt",
      receipt: receiptRow ? { id: receiptRow.id, createdAt: receiptRow.recorded_at,
        supersedesId: receipt?.supersedesId ?? null, receivedAt: receipt?.receivedAt ?? null } : null,
      output: item.type === "taxonomy" ? item.response?.output ?? null : null,
      serviceId: item.response?.serviceId ?? null,
      serviceVersion: item.response?.serviceVersion ?? null,
      taxonomyVersion: item.response?.taxonomyVersion ?? null,
      provenance: item.response?.provenance ?? null,
      receivedAt: item.response ? (item.source === "synthetic-provider"
        ? freshReceipts.find(value => value.request.inputFingerprint === item.inputFingerprint)?.receivedAt
        : receipt?.receivedAt) ?? receipt?.receivedAt ?? null : null,
      respondedAt: item.response?.respondedAt ?? null,
      expiresAt: item.response?.expiresAt ?? null,
      simulationOnly: true,
      response: undefined,
    }; }), ...governedOutputs.filter(type => !inspection.observations.some(item => item.type === type))
      .map(type => ({ type, status: "unsupported" as const, error: "unsupported" as const,
        supportedByFixture: type === "taxonomy", providerConfigured: inspection.connectorConfigured,
        providerKind: inspection.connectorConfigured ? "synthetic-contract-only" : "unconfigured",
        environment: "synthetic-only", availability: "unsupported",
        validity: "unsupported", effectiveVersion: null, providerIdentity: null,
        serviceId: null, serviceVersion: null, taxonomyVersion: null, validFrom: null,
        inputFingerprint: null, requestReference: null, receipt: null, observationId: null,
        observationCreatedAt: null, supersedesId: null, supersessionState: "no-matching-receipt",
        affectedRules: affectedRules[type] ?? [], output: null, provenance: null, receivedAt: null,
        respondedAt: null, expiresAt: null, retryCount: 0, source: "none", simulationOnly: true }))],
    revision, operationalStatus: "simulation-only", unverified: true, authoritative: false,
  };
}
function routeError(error: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (error instanceof PersistenceConflict) {
    res.status(409).json({ error: error.message, code: /Idempotency key|Simulation retry/.test(error.message) ? "IDEMPOTENCY_CONFLICT" : "CONFLICT" }); return;
  }
  if ((error as { status?: number }).status === 404) {
    res.status(404).json({ error: "Synthetic occurrence not found in selected campaign.", code: "NOT_FOUND" }); return;
  }
  const mapped = classifyWebinarApiError(error);
  res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
}
router.get("/development/foundation/observations", async (req, res, next) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A campaign, activity and occurrence scope is required.", code: "VALIDATION_ERROR" }); return; }
  const { campaignId, activityId, occurrenceId } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const sources = await loadOccurrenceSources(client, campaignId, occurrenceId);
    if (sources.activity.id !== activityId) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Occurrence is not in selected activity.", code: "NOT_FOUND" }); return;
    }
    if (sources.activity.activity_type_id !== "webinar") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Activity is not a webinar.", code: "CAPABILITY_UNAVAILABLE" }); return;
    }
    assertOccurrenceEligibility(sources);
    // A release digest includes the fixed calculation instant. Reconstruct the
    // latest snapshot's as-of instead of inventing a different digest on every GET.
    const latest = await client.query(`SELECT calculation_at FROM webinar_persistence_records
      WHERE campaign_id=$1 AND session_id=$2 AND kind='readiness'
      ORDER BY revision DESC LIMIT 1`, [campaignId, occurrenceId]);
    const asOf = latest.rows[0] ? new Date(latest.rows[0].calculation_at) : new Date();
    const release = await captureWebinarRelease(asOf.getTime());
    await client.query("COMMIT");
    res.json(present(inspectFoundationObservations(sources, asOf, configuredFoundationProvider(), release.digest), sources.binding!.revision, sources));
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); routeError(error, res, next); } finally { client.release(); }
});
router.post("/development/foundation/observations/refresh", async (req, res, next) => {
  const parsed = refresh.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Fixed scoped calculationAt, idempotencyKey and expectedRevision are required; governed output is not editable.", code: "VALIDATION_ERROR" }); return; }
  const provider = configuredFoundationProvider();
  if (!provider || provider.environment !== "synthetic") {
    res.status(409).json({ error: "No approved synthetic Foundation contract fixture is configured on this server; refresh is unavailable.", code: "PROVIDER_NOT_CONFIGURED" }); return;
  }
  const { campaignId, activityId, occurrenceId, calculationAt, expectedRevision, idempotencyKey } = parsed.data;
  try {
    const actor = await pool.query("SELECT creator_id FROM development_planning_environment WHERE id=true");
    if (!actor.rowCount) { res.status(503).json({ error: "Development actor is unavailable.", code: "CAPABILITY_UNAVAILABLE" }); return; }
    const client = await pool.connect();
    try {
      const sources = await loadOccurrenceSources(client, campaignId, occurrenceId);
      if (sources.activity.id !== activityId) { res.status(404).json({ error: "Occurrence is not in selected activity.", code: "NOT_FOUND" }); return; }
      if (sources.activity.activity_type_id !== "webinar") {
        res.status(409).json({ error: "Activity is not a webinar.", code: "CAPABILITY_UNAVAILABLE" }); return;
      }
      assertOccurrenceEligibility(sources);
      // Revision/idempotency enforcement belongs to the sole orchestrator, including replay.
    } finally { client.release(); }
    const simulation = await refreshFoundationObservations({
      campaignId, sessionId: occurrenceId, actorId: actor.rows[0].creator_id,
      calculationAt, expectedRevision, idempotencyKey,
    }, provider);
    const read = await pool.connect();
    try {
      const sources = await loadOccurrenceSources(read, campaignId, occurrenceId);
      const inspection = simulation.diagnostics.foundation
        ?? inspectFoundationObservations(sources, new Date(calculationAt), provider, simulation.releaseFingerprint);
      res.json({ inspection: present(inspection, sources.binding!.revision, sources),
        simulation: { ...simulation, simulation: true, operationalReadiness: false,
          unverified: true, authoritative: false } });
    } finally { read.release(); }
  } catch (error) { routeError(error, res, next); }
});
router.use((error: unknown, _req: import("express").Request, res: import("express").Response,
  _next: import("express").NextFunction) => {
  const mapped = classifyWebinarApiError(error);
  res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
});
export default router;