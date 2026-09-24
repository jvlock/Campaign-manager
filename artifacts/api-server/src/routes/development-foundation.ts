import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { configuredFoundationProvider } from "../lib/webinar-foundation";
import { inspectFoundationObservations, refreshFoundationObservations, type FoundationInspection } from "../lib/webinar-foundation-service";
import { assertOccurrenceEligibility, loadOccurrenceSources } from "../lib/webinar-evaluation-sources";
import type { OccurrenceSources } from "../lib/webinar-evaluation-sources";
import { PersistenceConflict } from "../lib/webinar-persistence";
import { captureWebinarRelease } from "../lib/webinar-release-provenance";

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
function present(inspection: FoundationInspection, revision: number, sources: OccurrenceSources,
  freshReceipts: readonly { request: { inputFingerprint: string }; receivedAt: string }[] = []) {
  return {
    ...inspection, observations: inspection.observations.map(item => {
      const receipt = sources.records.filter(record => record.kind === "source" && record.payload.sourceType === "foundation")
        .map(record => record.payload.governedReceipt)
        .filter((value): value is { request: { inputFingerprint: string }; receivedAt: string } =>
          !!value && typeof value === "object" && "request" in value && "receivedAt" in value
          && typeof value.receivedAt === "string" && !!value.request && typeof value.request === "object"
          && "inputFingerprint" in value.request && typeof value.request.inputFingerprint === "string")
        .filter(value => value.request.inputFingerprint === item.inputFingerprint).at(-1);
      return {
      ...item, affectedRules: affectedRules[item.type] ?? [],
      output: item.response?.output ?? null,
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
    }; }),
    revision, operationalStatus: "simulation-only", unverified: true, authoritative: false,
  };
}
function routeError(error: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (error instanceof PersistenceConflict) {
    res.status(409).json({ error: error.message, code: error.code }); return;
  }
  if ((error as { status?: number }).status === 404) {
    res.status(404).json({ error: "Synthetic occurrence not found in selected campaign." }); return;
  }
  next(error);
}
router.get("/development/foundation/observations", async (req, res, next) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A campaign, activity and occurrence scope is required." }); return; }
  const { campaignId, activityId, occurrenceId } = parsed.data;
  const client = await pool.connect();
  try {
    const sources = await loadOccurrenceSources(client, campaignId, occurrenceId);
    if (sources.activity.id !== activityId) { res.status(404).json({ error: "Occurrence is not in selected activity." }); return; }
    assertOccurrenceEligibility(sources);
    // A release digest includes the fixed calculation instant. Reconstruct the
    // latest snapshot's as-of instead of inventing a different digest on every GET.
    const latest = await client.query(`SELECT calculation_at FROM webinar_persistence_records
      WHERE campaign_id=$1 AND session_id=$2 AND kind='readiness'
      ORDER BY revision DESC LIMIT 1`, [campaignId, occurrenceId]);
    const asOf = latest.rows[0] ? new Date(latest.rows[0].calculation_at) : new Date();
    const release = await captureWebinarRelease(asOf.getTime());
    res.json(present(inspectFoundationObservations(sources, asOf, configuredFoundationProvider(), release.digest), sources.binding!.revision, sources));
  } catch (error) { routeError(error, res, next); } finally { client.release(); }
});
router.post("/development/foundation/observations/refresh", async (req, res, next) => {
  const parsed = refresh.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Fixed scoped calculationAt, idempotencyKey and expectedRevision are required; governed output is not editable." }); return; }
  const provider = configuredFoundationProvider();
  if (!provider || provider.environment !== "synthetic") {
    res.status(409).json({ error: "No approved synthetic Foundation contract fixture is configured on this server; refresh is unavailable." }); return;
  }
  const { campaignId, activityId, occurrenceId, calculationAt, expectedRevision, idempotencyKey } = parsed.data;
  try {
    const actor = await pool.query("SELECT creator_id FROM development_planning_environment WHERE id=true");
    if (!actor.rowCount) { res.status(503).json({ error: "Development actor is unavailable." }); return; }
    const client = await pool.connect();
    try {
      const sources = await loadOccurrenceSources(client, campaignId, occurrenceId);
      if (sources.activity.id !== activityId) { res.status(404).json({ error: "Occurrence is not in selected activity." }); return; }
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
export default router;