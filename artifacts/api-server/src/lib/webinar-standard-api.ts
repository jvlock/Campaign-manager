import { pool } from "@workspace/db";
import { z } from "zod";
import { assertOccurrenceEligibility, loadOccurrenceSources } from "./webinar-evaluation-sources";
import { simulateWebinarOccurrence, simulationFingerprint, sourceInputFingerprint } from "./webinar-evaluation-orchestration";
import { WebinarPersistence, PersistenceConflict } from "./webinar-persistence";
import { simulationSnapshotSchema, type SimulationSnapshot } from "./webinar-simulation-snapshot";
import { STANDARD_ID, STANDARD_VERSION, RULE_IDS } from "./webinar-standard-catalog/types";
import { COMPLETE_OBLIGATIONS } from "./webinar-standard-readiness";
import { inspectFoundationObservations, type FoundationInspection } from "./webinar-foundation-service";
import { configuredFoundationProvider } from "./webinar-foundation";
import { FoundationProviderError } from "./webinar-foundation";
import { captureWebinarRelease } from "./webinar-release-provenance";

export class WebinarApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
export function classifyWebinarApiError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof WebinarApiError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof PersistenceConflict) {
    const idempotency = /Idempotency key|Simulation retry/.test(error.message);
    return { status: 409, code: idempotency ? "IDEMPOTENCY_CONFLICT" : "CONFLICT",
      message: idempotency ? "Idempotency key does not match the original request" : "Occurrence changed; reload and retry" };
  }
  if (error instanceof FoundationProviderError) {
    if (error.reason === "not_configured")
      return { status: 409, code: "PROVIDER_NOT_CONFIGURED", message: "Synthetic Foundation provider is not configured" };
    if (error.reason === "unsupported_version")
      return { status: 422, code: "UNSUPPORTED_GOVERNED_OUTPUT", message: "Governed output version is unsupported" };
    if (error.reason === "expired" || error.reason === "deprecated")
      return { status: 409, code: "STALE_INPUT", message: "Governed observation is stale" };
    if (["unreachable", "timeout", "rate_limited", "unavailable", "authentication", "authorization"].includes(error.reason))
      return { status: 503, code: "PROVIDER_UNAVAILABLE", message: "Synthetic Foundation provider is unavailable" };
    return { status: 502, code: "PROVIDER_RESPONSE_INVALID", message: "Synthetic Foundation observation was invalid" };
  }
  if ((error as { status?: number } | null)?.status === 404)
    return { status: 404, code: "NOT_FOUND", message: "Webinar occurrence not found" };
  return { status: 503, code: "INTERNAL_ERROR", message: "Synthetic webinar operation could not be completed" };
}
export interface WebinarApiScope { campaignId: string; sessionId: string }
export interface WebinarApiContext {
  scope: WebinarApiScope;
  sources: Awaited<ReturnType<typeof loadOccurrenceSources>>;
  latest: { id: string; revision: number; release_id: string | null;
    payload: { simulation: SimulationSnapshot; evidenceIds: string[]; exceptionIds: string[] } } | null;
  exceptionAudits: Record<string, { expiresAt: string; reasonCode: string }>;
  retrievedAt: string;
  foundationInspection: FoundationInspection;
  currentEngineReleaseFingerprint: string;
}
const boundary = (error: unknown): never => {
  if ((error as { status?: number }).status === 404)
    throw new WebinarApiError("NOT_FOUND", 404, "Webinar occurrence not found");
  if (error instanceof PersistenceConflict)
    throw new WebinarApiError("CAPABILITY_UNAVAILABLE", 409, "Only an explicitly bound new synthetic webinar occurrence is supported");
  throw error;
};
/** Repeatable-read one-occurrence projection: source records and last immutable result cannot tear. */
export async function loadWebinarApiContext(scope: WebinarApiScope, activityId?: string): Promise<WebinarApiContext> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const sources = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
    if (sources.activity.activity_type_id !== "webinar")
      throw new WebinarApiError("CAPABILITY_UNAVAILABLE", 409, "Activity is not an exact-standard webinar");
    if (activityId && sources.activity.id !== activityId)
      throw new WebinarApiError("NOT_FOUND", 404, "Occurrence does not belong to the selected webinar activity");
    assertOccurrenceEligibility(sources);
    const last = await client.query(`SELECT id,revision,release_id,payload FROM webinar_persistence_records
      WHERE campaign_id=$1 AND session_id=$2 AND kind='readiness' AND payload ? 'simulation'
      ORDER BY revision DESC LIMIT 1`, [scope.campaignId, scope.sessionId]);
    const row = last.rows[0];
    const latest = row ? { ...row, payload: { simulation: simulationSnapshotSchema.parse(row.payload.simulation),
      evidenceIds: Array.isArray(row.payload.evidenceIds) ? row.payload.evidenceIds : [],
      exceptionIds: Array.isArray(row.payload.exceptionIds) ? row.payload.exceptionIds : [] } } : null;
    const audits = await client.query(`SELECT details FROM organization_audit
      WHERE campaign_id=$1 AND activity_id=$2 AND action='development_webinar_exception_requested'
      AND details->>'occurrenceId'=$3 ORDER BY created_at,id`,
    [scope.campaignId, sources.activity.id, scope.sessionId]);
    const exceptionAudits = Object.fromEntries(audits.rows.filter((r: { details: Record<string, unknown> }) =>
      typeof r.details.recordId === "string" && typeof r.details.expiresAt === "string")
      .map((r: { details: { recordId: string; expiresAt: string; reasonCode: string } }) =>
        [r.details.recordId, { expiresAt: r.details.expiresAt, reasonCode: r.details.reasonCode }]));
    await client.query("COMMIT");
    const retrievedAt = new Date().toISOString();
    const asOf = latest?.payload.simulation.calculationAt
      ? new Date(latest.payload.simulation.calculationAt) : new Date(retrievedAt);
    const release = await captureWebinarRelease(asOf.getTime());
    return { scope, sources, latest, exceptionAudits, retrievedAt,
      currentEngineReleaseFingerprint: release.engineReleaseFingerprint,
      foundationInspection: inspectFoundationObservations(sources, asOf, configuredFoundationProvider(), release.digest) };
  } catch (e) {
    await client.query("ROLLBACK");
    return boundary(e);
  } finally { client.release(); }
}
function currentSnapshot(context: WebinarApiContext) {
  const snapshot = context.latest?.payload.simulation ?? null;
  // An old result is never silently upgraded to a new source revision.
  return { snapshot, snapshotId: context.latest?.id ?? null, snapshotRevision: context.latest?.revision ?? null,
    staleness: snapshot
      ? context.latest?.revision === context.sources.binding?.revision
        && sourceInputFingerprint(context.sources, snapshot.calculationAt) === snapshot.inputFingerprint
        && (!snapshot.engineReleaseFingerprint
          || snapshot.engineReleaseFingerprint === context.currentEngineReleaseFingerprint)
        && !context.foundationInspection.observations.some(o =>
          o.status === "expired" || o.status === "stale" || o.status === "deprecated")
        ? "current" as const : "stale" as const
      : "not_evaluated" as const };
}
export function projection(context: WebinarApiContext, resource: "summary" | "readiness" | "completion" | "evaluations") {
  const { snapshot, snapshotId, snapshotRevision, staleness } = currentSnapshot(context);
  const source = context.sources;
  const identity = { campaignId: context.scope.campaignId, activityId: source.activity.id,
    occurrenceId: source.occurrence.id, standard: { id: STANDARD_ID, version: STANDARD_VERSION },
    retrievedAt: context.retrievedAt, calculationAt: snapshot?.calculationAt ?? null,
    // A legacy as-of-dependent digest is an evaluation-context fingerprint, NOT an engine release.
    engineReleaseFingerprint: snapshot?.engineReleaseFingerprint ?? null,
    engineRelease: snapshot?.engineRelease ?? null,
    releaseIdentityStatus: !snapshot ? "not_evaluated"
      : snapshot.engineReleaseFingerprint ? "recorded" : "unavailable-historical",
    evaluationContextFingerprint: snapshot?.releaseFingerprint ?? null,
    inputFingerprint: snapshot?.inputFingerprint ?? null,
    snapshotId, snapshotRevision, staleness, operationalStatus: "simulation-only" as const,
    unverified: true, authoritative: false, operationalReadiness: false,
    capabilities: { view: true, evaluateSynthetic: true, submitUnverifiedEvidence: true,
      requestDraftException: true, reviewException: false, send: false, publish: false } };
  if (resource === "evaluations") return { ...identity, status: snapshot ? "available-synthetic" : "not_evaluated",
    results: snapshot?.results ?? [], evaluatorCoverage: snapshot?.evaluatorCoverage ?? null,
    missingInputData: snapshot?.missingInputData ?? [], unavailableExternalObservations: snapshot?.unavailableExternalObservations ?? [],
    sourceReferences: snapshot?.sourceReferences ?? [] };
  if (resource === "readiness") return { ...identity, status: snapshot ? "available-synthetic" : "not_evaluated",
    stages: snapshot?.readinessStages.map(stage => ({
      ...stage, calculationAt: snapshot.calculationAt, applicableRuleCount: stage.applicableRuleIds.length,
      passedRules: stage.passes, unresolvedBlockingFailures: stage.failedBlockers,
      resolvedBlockingFailures: stage.exceptionResolvedBlockers, nonblockingFailures: stage.failedNonBlocking,
      missingInputs: snapshot.missingInputData, missingEvaluatorCoverage: stage.missingRuleIds,
      evidenceReferences: context.latest?.payload.evidenceIds ?? [],
      exceptionReferences: context.latest?.payload.exceptionIds ?? [], staleness })) ?? [],
    issues: snapshot?.readinessIssues ?? [], evaluatorCoverage: snapshot?.evaluatorCoverage ?? null };
  if (resource === "completion") return { ...identity, status: snapshot ? "available-synthetic" : "not_evaluated",
    result: snapshot?.completionResult ?? null, evidenceReferences: context.latest?.payload.evidenceIds ?? [],
    exceptionReferences: context.latest?.payload.exceptionIds ?? [], missingInputData: snapshot?.missingInputData ?? [],
    obligations: { required: [...COMPLETE_OBLIGATIONS],
      // Only canonical completion gaps can declare an unsatisfied obligation. The
      // snapshot cannot prove operational satisfaction; everything else stays unknown.
      satisfiedOperational: [],
      unsatisfiedOperational: snapshot
        ? COMPLETE_OBLIGATIONS.filter(name => snapshot.completionResult.operationalGaps.includes(name)) : [],
      unknownOperational: COMPLETE_OBLIGATIONS.filter(name =>
        !snapshot?.completionResult.operationalGaps.includes(name)),
      diagnosticOperationalGaps: snapshot?.completionResult.operationalGaps ?? [] },
    measurementObligations: { status: "unavailable", operationalEvidence: false },
    operationalObservations: "unavailable" };
  const lastPlan = source.records.filter(r => r.kind === "plan").at(-1);
  const fixtureIds = new Set(source.participants.map(p => p.id));
  const registrationByParticipant = new Map<string, string>();
  for (const row of source.registrations) if (typeof row.person_id === "string" && fixtureIds.has(row.person_id) && row.result === "registered")
    registrationByParticipant.set(row.person_id, "registered");
  for (const event of source.lifecycleEvents) {
    if (typeof event.person_id !== "string" || !fixtureIds.has(event.person_id)) continue;
    if (event.action === "waitlist") registrationByParticipant.set(event.person_id, "waitlisted");
    else if (event.action === "cancel-registration") registrationByParticipant.set(event.person_id, "cancelled");
    else if (event.action === "register" || event.action === "promote")
      registrationByParticipant.set(event.person_id, "registered");
  }
  const registrationTotals = {
    registered: [...registrationByParticipant.values()].filter(v => v === "registered").length,
    cancelled: [...registrationByParticipant.values()].filter(v => v === "cancelled").length,
    waitlisted: [...registrationByParticipant.values()].filter(v => v === "waitlisted").length,
  };
  const state = (rows: Record<string, unknown>[], field: string) =>
    Object.fromEntries([...new Set(rows.map(row => String(row[field] ?? "unknown")))].sort()
      .map(key => [key, rows.filter(row => String(row[field] ?? "unknown") === key).length]));
  return { ...identity, status: snapshot ? "available-synthetic" : "not_evaluated",
    eventStatus: lastPlan?.payload.eventStatus ?? "unavailable",
    population: { total: source.participantTotal,
      registration: state(source.registrations.filter(r => fixtureIds.has(r.person_id)), "result"),
      attendance: state(source.attendances.filter(r => fixtureIds.has(r.person_id)), "result"),
      lifecycle: state(source.lifecycleEvents.filter(r => r.person_id == null || fixtureIds.has(r.person_id)), "action"),
      remaining: source.participantRemaining },
    registrationSummary: { status: source.participantTotal ? "synthetic-recorded" : "not_recorded",
      ...registrationTotals, notRegistered: Math.max(0, source.participantTotal - registrationByParticipant.size) },
    attendanceSummary: { status: source.attendances.length ? "synthetic-recorded" : "not_recorded",
      attended: source.attendances.filter(r => fixtureIds.has(r.person_id) && r.result === "attended").length,
      noShow: source.attendances.filter(r => fixtureIds.has(r.person_id) && r.result === "no_show").length,
      operationallyVerified: false },
    communications: { configured: source.communications.length, applicationRecords: source.applicationCommunications.length,
      planStatus: source.communications.length ? "configured-synthetic" : "not_configured", executionStatus: "unavailable" },
    suppression: { recordedObligations: source.lifecycleObligations.filter(o => fixtureIds.has(o.person_id)).length,
      operational: false },
    evidence: { records: source.records.filter(r => r.kind === "evidence").length,
      verificationStatus: "unverified", includedInLastEvaluation: context.latest?.payload.evidenceIds ?? [] },
    foundation: { inspection: "development/foundation/observations", liveProduction: false },
    evaluation: { applicable: snapshot?.applicableRules.length ?? 0, passed: snapshot?.passedRules.length ?? 0,
      coverage: snapshot?.evaluatorCoverage ?? null, missingEvaluatorCoverage: snapshot?.evaluatorCoverage.missingEvaluatorRuleIds ?? [],
      lastEvaluationId: snapshotId },
    readinessStages: snapshot?.readinessStages ?? [], completion: snapshot?.completionResult ?? null,
    missingInputData: snapshot?.missingInputData ?? [], unavailableExternalObservations: snapshot?.unavailableExternalObservations ?? [],
    unresolvedBlockingFailures: snapshot?.unresolvedBlockingFailures ?? [],
    nonblockingFailures: snapshot?.nonblockingFailures ?? [], resolvedBlockers: snapshot?.blockersResolvedByExceptions ?? [],
    links: { evaluations: "evaluations", readiness: "readiness", completion: "completion",
      evidence: "evidence", exceptions: "exceptions", history: "history" } };
}
export async function webinarSummary(context: WebinarApiContext) {
  // The inspection was built from the same one-occurrence MVCC source projection.
  const inspected = context.foundationInspection;
  const statusFor = (type: typeof inspected.observations[number]["type"]) => {
    if (type !== "taxonomy") return "unsupported";
    if (!inspected.connectorConfigured) return "not_configured";
    const row = inspected.observations.filter(o => o.type === type).at(-1);
    if (!row) return "configured_but_unavailable";
    return row.status === "available" ? "available-synthetic"
      : row.status === "stale" || row.status === "expired" || row.status === "deprecated" ? "stale"
      : row.error === "unreachable" || row.error === "timeout" || row.error === "malformed_response" ? "failed"
      : "configured_but_unavailable";
  };
  const observations = inspected.observations.map(o => {
    const receiptRow = context.sources.records.filter(r => r.kind === "source" && r.payload.sourceType === "foundation")
      .filter(r => {
        const receipt = r.payload.governedReceipt as { request?: { inputFingerprint?: string; type?: string } } | undefined;
        return receipt?.request?.inputFingerprint === o.inputFingerprint && receipt.request.type === o.type;
      }).at(-1);
    const receipt = receiptRow ? { id: receiptRow.id, createdAt: receiptRow.recorded_at,
      supersedesId: (receiptRow.payload.governedReceipt as { supersedesId?: string | null }).supersedesId ?? null } : null;
    return { type: o.type, status: o.status, providerSource: o.source, error: o.error,
      requestReference: o.requestReference, inputFingerprint: o.inputFingerprint,
      serviceVersion: o.response?.serviceVersion ?? null,
      taxonomyVersion: o.response?.taxonomyVersion ?? null, supportedByFixture: o.type === "taxonomy",
      validity: o.status, effectiveVersion: o.response?.taxonomyVersion ?? o.response?.serviceVersion ?? null,
      provenance: o.response?.provenance ?? null, providerIdentity: o.response?.serviceId ?? null,
      observationId: receipt?.id ?? null, createdAt: receipt?.createdAt ?? null,
      supersessionState: receipt && context.sources.records.some(r => r.kind === "source"
        && (r.payload.governedReceipt as { supersedesId?: string | null } | undefined)?.supersedesId === receipt.id)
        ? "superseded" : receipt ? "latest-for-input" : "no-matching-receipt",
      receipt };
  });
  const outputTypes = ["taxonomy", "internal_title", "campaign_code", "utm",
    "objective_membership", "campaign_exclusion"] as const;
  return { ...projection(context, "summary"), foundation: {
    evaluatorImplemented: inspected.evaluatorImplemented, connectorConfigured: inspected.connectorConfigured,
    connectorReachable: inspected.connectorReachable, liveProductionConnection: false,
    environment: "synthetic-contract-only", observationAvailable: inspected.observationAvailable,
    capabilities: { taxonomy: statusFor("taxonomy"), internalTitle: statusFor("internal_title"),
      campaignCode: statusFor("campaign_code"), utm: statusFor("utm"),
      objective: statusFor("objective_membership"), exclusion: statusFor("campaign_exclusion") },
    observations, outputs: outputTypes.map(type => {
      const observed = observations.find(o => o.type === type);
      const unavailableError = inspected.connectorConfigured ? "unavailable" : "not_configured";
      return {
      ...(observed ?? {
        providerSource: "none", error: type === "taxonomy" ? unavailableError : "unsupported",
        requestReference: null, inputFingerprint: null, serviceVersion: null, taxonomyVersion: null,
        validity: "unsupported", effectiveVersion: null, provenance: null, providerIdentity: null,
        observationId: null, createdAt: null, supersessionState: "no-matching-receipt", receipt: null,
      }), type, status: statusFor(type), supportedByFixture: type === "taxonomy",
      configured: inspected.connectorConfigured, environment: "synthetic-contract-only",
      availableFromRealProvider: false,
      validity: type === "taxonomy" ? observed?.validity ?? "unavailable" : "unsupported",
      error: type === "taxonomy" ? observed ? observed.error : unavailableError : "unsupported" };
    }),
    inspection: "/api/development/foundation/observations",
  } };
}
export async function evaluateWebinarApi(scope: WebinarApiScope, activityId: string, input: {
  expectedRevision: number; idempotencyKey: string; calculationAt: string;
}) {
  const context = await loadWebinarApiContext(scope, activityId);
  const actor = await pool.query("SELECT creator_id FROM development_planning_environment WHERE id=true");
  if (!actor.rows[0]?.creator_id) throw new WebinarApiError("CAPABILITY_UNAVAILABLE", 503, "Development actor unavailable");
  // Fixed diagnostic calculation time is accepted ONLY on this synthetic development route.
  const calculationAt = input.calculationAt;
  const { releaseFingerprint, ...result } = await simulateWebinarOccurrence({ ...scope, actorId: actor.rows[0].creator_id,
    calculationAt, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey });
  return { ...result, evaluationContextFingerprint: releaseFingerprint,
    calculationAt, status: "available-synthetic", simulation: true,
    operationalReadiness: false, unverified: true, authoritative: false,
    activityId: context.sources.activity.id };
}
export async function historyWebinarApi(context: WebinarApiContext, afterRevision: number, limit: number) {
  const page = await new WebinarPersistence().load(context.scope.campaignId, context.scope.sessionId, afterRevision, limit);
  return { campaignId: context.scope.campaignId, activityId: context.sources.activity.id,
    occurrenceId: context.scope.sessionId, retrievedAt: new Date().toISOString(),
    total: page.totalCount, returned: page.returnedCount, nextRevision: page.nextRevision,
    records: page.records.map(row => ({ id: row.id, revision: row.revision, kind: row.kind,
      parentId: row.parent_id, releaseId: row.release_id, calculationAt: row.calculation_at,
      createdAt: row.recorded_at, inputFingerprint: row.input_fingerprint,
      // Only references and simulation-safe metadata; no arbitrary stored provider payloads.
       payload: row.kind === "plan" ? { state: row.payload.state, eventStatus: row.payload.eventStatus ?? null }
         : row.kind === "source" ? { sourceType: row.payload.sourceType, sourceVersion: row.payload.sourceVersion,
           status: row.payload.status }
         : row.kind === "readiness" ? { result: row.payload.result, stage: row.payload.stage }
         : row.kind === "completion" ? { result: row.payload.result }
         : row.kind === "evidence" ? { evidenceType: row.payload.evidenceType, result: row.payload.result }
         : row.kind === "exception-request" ? { ruleId: row.payload.ruleId, reasonCode: row.payload.reasonCode }
         : row.kind === "exception-disposition" ? { disposition: row.payload.disposition }
         : row.kind === "legal-hold" ? { held: row.payload.held }
        : row.kind === "release" ? { evaluationContextFingerprint: row.payload.digest,
          engineReleaseFingerprint: row.payload.engineReleaseFingerprint ?? null,
          engineRelease: row.payload.engineRelease ?? null }
         : {} })), simulationOnly: true, unverified: true };
}
export const evidenceInput = z.object({
  sourceId: z.string().uuid(), evidenceType: z.enum(["qa", "manual-review", "source-observation"]),
  sourceType: z.enum(["occurrence", "content", "foundation", "delivery", "measurement"]),
  sourceVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().uuid(),
  calculationAt: z.string().datetime({ offset: true }),
}).strict();
export const exceptionInput = z.object({
  ruleId: z.enum(RULE_IDS), evidenceId: z.string().uuid(),
  reasonCode: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/),
  expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().uuid(),
  calculationAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
}).strict();
async function actor() {
  const { rows } = await pool.query("SELECT creator_id FROM development_planning_environment WHERE id=true");
  if (!rows[0]?.creator_id) throw new WebinarApiError("CAPABILITY_UNAVAILABLE", 503, "Development actor unavailable");
  return rows[0].creator_id as string;
}
/** This is an unverified reference, NEVER a passing operational evidence assertion. */
export async function submitWebinarEvidence(scope: WebinarApiScope, activityId: string, input: z.infer<typeof evidenceInput>) {
  return new WebinarPersistence().withEvaluationTransaction(scope, async (client, repository) => {
    const sources = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
    if (sources.activity.id !== activityId) throw new WebinarApiError("NOT_FOUND", 404, "Webinar occurrence not found");
    if (sources.activity.activity_type_id !== "webinar") throw new WebinarApiError("CAPABILITY_UNAVAILABLE", 409, "Activity is not a webinar");
    assertOccurrenceEligibility(sources);
    const source = sources.records.find(r => r.id === input.sourceId && r.kind === "source");
    if (!source || source.payload.status !== "available")
      throw new WebinarApiError("MISSING_REQUIRED_INPUT", 422, "An existing available scoped source reference is required");
    if (source.payload.sourceType !== input.sourceType || source.payload.sourceVersion !== input.sourceVersion
      || source.payload.sourceHash !== input.sourceHash)
      throw new WebinarApiError("STALE_INPUT", 409, "Source type, version and content hash must match the immutable scoped source");
    if (Date.parse(source.payload.observedAt as string) > Date.parse(input.calculationAt))
      throw new WebinarApiError("STALE_INPUT", 409, "Source was not observed at the requested calculation instant");
    if ((input.evidenceType === "qa" && !["content", "occurrence"].includes(input.sourceType))
      || (input.evidenceType === "manual-review" && input.sourceType !== "content"))
      throw new WebinarApiError("VALIDATION_ERROR", 400, "Evidence type is not compatible with the referenced source");
    if (input.sourceType === "foundation") {
      const receipt = source.payload.governedReceipt as {
        response: { status: string }; releaseFingerprint: string;
        request: { type: FoundationInspection["observations"][number]["type"]; inputFingerprint: string };
      } | undefined;
      if (!receipt || receipt.response.status !== "success")
        throw new WebinarApiError("MISSING_REQUIRED_INPUT", 422, "A successful governed observation receipt is required");
      const observation = inspectFoundationObservations(sources, new Date(input.calculationAt),
        configuredFoundationProvider(), receipt.releaseFingerprint).observations.find(o =>
        o.type === receipt.request.type && o.inputFingerprint === receipt.request.inputFingerprint);
      if (!observation || observation.status !== "available")
        throw new WebinarApiError("STALE_INPUT", 409, "Governed observation is unavailable, expired, or no longer valid");
    }
    const retry = await client.query("SELECT id FROM webinar_persistence_records WHERE campaign_id=$1 AND session_id=$2 AND idempotency_key=$3",
      [scope.campaignId, scope.sessionId, `evidence:${input.idempotencyKey}`]);
    const row = await repository.append({ ...scope, actorId: await actor(), expectedRevision: input.expectedRevision,
      idempotencyKey: `evidence:${input.idempotencyKey}`,
      standard: { id: STANDARD_ID, version: STANDARD_VERSION }, calculationAt: input.calculationAt,
       inputFingerprint: simulationFingerprint({ sourceId: source.id, sourceType: input.sourceType,
         sourceVersion: input.sourceVersion, sourceHash: input.sourceHash,
         type: input.evidenceType, calculationAt: input.calculationAt }),
      parentId: source.id, operational: false, payload: { kind: "evidence", evidenceType: input.evidenceType,
         contentFingerprint: simulationFingerprint({ sourceId: source.id, sourceType: input.sourceType,
           sourceVersion: input.sourceVersion, sourceHash: input.sourceHash,
           type: input.evidenceType }), result: "unknown" } });
    return { id: row.id, revision: row.revision, sourceId: source.id, sourceType: input.sourceType,
      sourceVersion: input.sourceVersion, sourceHash: input.sourceHash, evidenceType: input.evidenceType,
      result: "unknown", authenticated: false, unverified: true, operational: false,
      replayed: !!retry.rowCount, recordedAt: row.recorded_at };
  });
}
/** Draft exception requests cannot resolve readiness without independent trusted review. */
export async function requestDraftException(scope: WebinarApiScope, activityId: string, input: z.infer<typeof exceptionInput>) {
  if (input.ruleId === "WEB-EXC-001") throw new WebinarApiError("VALIDATION_ERROR", 400, "WEB-EXC-001 cannot exempt itself");
  if (Date.parse(input.expiresAt) <= Date.parse(input.calculationAt))
    throw new WebinarApiError("VALIDATION_ERROR", 400, "Exception expiry must be after calculation instant");
  return new WebinarPersistence().withEvaluationTransaction(scope, async (client, repository) => {
    const sources = await loadOccurrenceSources(client, scope.campaignId, scope.sessionId);
    if (sources.activity.id !== activityId) throw new WebinarApiError("NOT_FOUND", 404, "Webinar occurrence not found");
    if (sources.activity.activity_type_id !== "webinar") throw new WebinarApiError("CAPABILITY_UNAVAILABLE", 409, "Activity is not a webinar");
    assertOccurrenceEligibility(sources);
    // A verified exact retry must not become invalid solely because another evaluation
    // has since advanced the occurrence. Its original immutable request remains unchanged.
    const retry = await client.query(`SELECT id,revision,recorded_at,parent_id,calculation_at,payload
      FROM webinar_persistence_records WHERE campaign_id=$1 AND session_id=$2 AND idempotency_key=$3`,
    [scope.campaignId, scope.sessionId, `exception:${input.idempotencyKey}`]);
    if (retry.rows[0]) {
      const previous = retry.rows[0];
      const audit = await client.query(`SELECT details FROM organization_audit
        WHERE campaign_id=$1 AND activity_id=$2 AND action='development_webinar_exception_requested'
          AND details->>'recordId'=$3 AND details->>'occurrenceId'=$4`,
      [scope.campaignId, activityId, previous.id, scope.sessionId]);
      const old = audit.rows[0]?.details;
      if (!old || previous.revision !== input.expectedRevision + 1
        || old.ruleId !== input.ruleId || old.evidenceId !== input.evidenceId
        || old.reasonCode !== input.reasonCode || old.expiresAt !== input.expiresAt
        || old.calculationAt !== input.calculationAt || previous.parent_id !== input.evidenceId
        || previous.payload.ruleId !== input.ruleId || previous.payload.reasonCode !== input.reasonCode)
        throw new WebinarApiError("IDEMPOTENCY_CONFLICT", 409, "Idempotency key does not match the original draft request");
      return { id: previous.id, revision: previous.revision, ruleId: input.ruleId, evidenceId: input.evidenceId,
        reasonCode: input.reasonCode, expiryRequested: input.expiresAt, authenticated: false,
        status: "draft-unverified", reviewAvailable: false, resolvesBlocker: false, operational: false,
        replayed: true };
    }
    const prior = await client.query(`SELECT id,revision,payload FROM webinar_persistence_records
      WHERE campaign_id=$1 AND session_id=$2 AND kind='readiness' AND payload ? 'simulation'
      ORDER BY revision DESC LIMIT 1`, [scope.campaignId, scope.sessionId]);
    const latest = prior.rows[0] ? simulationSnapshotSchema.parse(prior.rows[0].payload.simulation) : null;
    const failed = latest?.unresolvedBlockingFailures.find(r => r.ruleId === input.ruleId);
    if (!latest || !failed) throw new WebinarApiError("EVALUATION_INCOMPLETE", 422, "A current failed blocking rule is required");
    if (!failed.rule.exceptionEligible) throw new WebinarApiError("CAPABILITY_UNAVAILABLE", 409, "Rule does not permit exception requests");
    const evidence = sources.records.find(r => r.id === input.evidenceId && r.kind === "evidence");
    if (!evidence) throw new WebinarApiError("MISSING_REQUIRED_INPUT", 422, "Existing scoped evidence is required");
    if (evidence.payload.result !== "unknown"
      || !sources.records.some(r => r.id === evidence.parent_id && r.kind === "source" && r.payload.status === "available"))
      throw new WebinarApiError("MISSING_REQUIRED_INPUT", 422, "Only a scoped unverified reference to an available source can support a draft");
    // The current snapshot must have included this evidence; stale evidence cannot justify a new request.
    const snapshotRow = prior.rows[0];
    if (snapshotRow.revision !== sources.binding?.revision
      || sourceInputFingerprint(sources, latest.calculationAt) !== latest.inputFingerprint
      || input.calculationAt !== latest.calculationAt
      || !snapshotRow.payload.evidenceIds?.includes(evidence.id))
      throw new WebinarApiError("STALE_INPUT", 409, "Re-evaluate with this evidence before requesting a draft exception");
    const row = await repository.append({ ...scope, actorId: await actor(), expectedRevision: input.expectedRevision,
      idempotencyKey: `exception:${input.idempotencyKey}`,
      standard: { id: STANDARD_ID, version: STANDARD_VERSION }, calculationAt: input.calculationAt,
      inputFingerprint: simulationFingerprint({ snapshotId: snapshotRow.id, ruleId: input.ruleId,
        evidenceId: input.evidenceId, reasonCode: input.reasonCode, expiresAt: input.expiresAt }),
      parentId: evidence.id, operational: false, payload: { kind: "exception-request",
        ruleId: input.ruleId, findingFingerprint: simulationFingerprint(failed), reasonCode: input.reasonCode } });
    // Append-only expiry metadata and exact-retry identity share the immutable request's transaction.
    await client.query(`INSERT INTO organization_audit(actor_id,action,campaign_id,activity_id,details)
      VALUES($1,'development_webinar_exception_requested',$2,$3,$4::jsonb)`,
    [row.actor_id, scope.campaignId, activityId, JSON.stringify({ recordId: row.id, occurrenceId: scope.sessionId,
      evidenceId: evidence.id, ruleId: input.ruleId, reasonCode: input.reasonCode, calculationAt: input.calculationAt,
      expiresAt: input.expiresAt, authenticated: false, status: "draft-unverified" })]);
    return { id: row.id, revision: row.revision, ruleId: input.ruleId, evidenceId: input.evidenceId,
      reasonCode: input.reasonCode, expiryRequested: input.expiresAt, authenticated: false,
      status: "draft-unverified", reviewAvailable: false, resolvesBlocker: false, operational: false,
      replayed: false };
  });
}