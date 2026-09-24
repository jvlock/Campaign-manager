import { foundationFingerprint, buildFoundationRequests, configuredFoundationProvider, validateFoundationResponse,
  FoundationProviderError, type FoundationFailure, type FoundationRequest, type FoundationResponse,
  type GovernanceFoundationProvider } from "./webinar-foundation";
import type { OccurrenceSources } from "./webinar-evaluation-sources";
import { STANDARD_ID, STANDARD_VERSION } from "./webinar-standard-catalog/types";
import type { WebinarPersistence, WebinarTransactionClient } from "./webinar-persistence";

export interface FoundationInspection {
  contractLabel: "synthetic-contract-only";
  evaluatorImplemented: true;
  observationAvailable: boolean;
  connectorConfigured: boolean;
  connectorReachable: boolean;
  liveProductionConnection: false;
  observations: readonly { type: FoundationRequest["type"]; requestReference: string; inputFingerprint: string;
    status: "available" | "unavailable" | "expired" | "deprecated" | "stale";
    error: FoundationFailure | null; source: "synthetic-provider" | "immutable-history" | "none";
    response: FoundationResponse | null; retryCount: number }[];
}
type Receipt = { request: FoundationRequest; response: FoundationResponse; releaseFingerprint: string;
  supersedesId: string | null; receivedAt: string; retryCount: number; simulationOnly: true };
type Saved = { id: string; payload: { governedReceipt?: Receipt } };
const failures = new Set<FoundationFailure>(["unreachable", "timeout", "rate_limited", "internal_error"]);
function failure(error: unknown): FoundationProviderError {
  return error instanceof FoundationProviderError ? error : new FoundationProviderError("internal_error");
}
/** Verify the immutable original transport receipt, then require current validity as well.
 * Evaluation as-of remains the caller's fixed calculation instant in both checks. */
function validateRecordedReceipt(receipt: Receipt, request: FoundationRequest,
  versions: { serviceVersion: string; taxonomyVersion: string }, at: Date): FoundationResponse {
  const response = validateFoundationResponse(receipt.response, request, versions, at, new Date(receipt.receivedAt));
  validateFoundationResponse(response, request, versions, at, new Date());
  return response;
}
async function callProvider(provider: GovernanceFoundationProvider, request: FoundationRequest, at: Date) {
  let last: FoundationProviderError = new FoundationProviderError("unreachable");
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const raw = await Promise.race([provider.request(request, controller.signal),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new FoundationProviderError("timeout")), { once: true }))]);
      const receivedAt = new Date();
      return { response: validateFoundationResponse(raw, request, provider, at, receivedAt),
        receivedAt: receivedAt.toISOString(), retryCount: attempt };
    } catch (error) {
      last = failure(error);
      last.retryCount = attempt;
      if (!failures.has(last.reason) || attempt === 2) break;
      const delay = last.reason === "rate_limited" ? last.retryAfterMs ?? 200 : 50 * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, Math.min(delay, 2000)));
    } finally { clearTimeout(timer); controller.abort(); }
  }
  throw last;
}
/** Transaction is already serialized under the occurrence advisory lock. No cross-request in-memory cache. */
export async function resolveFoundationObservations(args: {
  sources: OccurrenceSources; client: WebinarTransactionClient; transaction: WebinarPersistence;
  actorId: string; calculationAt: string; releaseFingerprint: string;
  provider?: GovernanceFoundationProvider | null; fresh?: boolean;
}): Promise<{ inspection: FoundationInspection; revision: number; receipts: readonly Receipt[]; persistedIds: readonly string[] }> {
  const { sources, client, transaction } = args;
  const provider = args.provider === undefined ? configuredFoundationProvider() : args.provider;
  const requests = buildFoundationRequests(sources);
  const history = sources.records.filter(r => r.kind === "source" && r.payload.sourceType === "foundation" && r.payload.governedReceipt)
    .map(r => ({ id: r.id, payload: r.payload } as Saved));
  let revision = sources.binding!.revision;
  let reachable = false;
  const receipts: Receipt[] = [];
  const persistedIds: string[] = [];
  const observations: FoundationInspection["observations"][number][] = [];
  const at = new Date(args.calculationAt);
  for (const request of requests) {
    if (request.type === "utm" && request.input.destinationState !== "valid") {
      observations.push({ type: request.type, requestReference: request.requestReference,
        inputFingerprint: request.inputFingerprint, status: "unavailable", error: "invalid_request",
        source: "none", response: null, retryCount: 0 });
      continue;
    }
    const matching = history.filter(h => h.payload.governedReceipt?.request.type === request.type
      && foundationFingerprint(h.payload.governedReceipt.request.scope) === foundationFingerprint(request.scope));
    const sameInput = matching.filter(h => h.payload.governedReceipt?.request.inputFingerprint === request.inputFingerprint);
    const last = matching.at(-1);
    const previous = sameInput.at(-1)?.payload.governedReceipt;
    const digests = new Map<string, string>();
    let historicalConflict = false;
    for (const row of sameInput) {
      const receipt = row.payload.governedReceipt!;
      const key = foundationFingerprint({ serviceVersion: receipt.response.serviceVersion,
        taxonomyVersion: receipt.response.taxonomyVersion, environment: receipt.response.environment });
      const digest = foundationFingerprint(receipt.response.output);
      if (digests.has(key) && digests.get(key) !== digest) historicalConflict = true;
      digests.set(key, digest);
    }
    if (historicalConflict) {
      observations.push({ type: request.type, requestReference: request.requestReference,
        inputFingerprint: request.inputFingerprint, status: "stale", error: "conflict",
        source: "none", response: null, retryCount: 0 });
      continue;
    }
    const versions = provider ? { serviceVersion: provider.serviceVersion, taxonomyVersion: provider.taxonomyVersion } : null;
    let response: FoundationResponse | null = null, error: FoundationFailure | null = null;
    let source: "synthetic-provider" | "immutable-history" | "none" = "none", retryCount = 0;
    let acceptedReceipt: Receipt | null = null;
    // Reuse immutable original provenance, only while versions and validity remain current.
    if (previous && versions && !args.fresh && previous.releaseFingerprint === args.releaseFingerprint) {
      try {
        response = validateRecordedReceipt(previous, request, versions, at);
        acceptedReceipt = previous;
        source = "immutable-history";
      } catch (e) { error = failure(e).reason; }
    }
    if (!response && provider && provider.environment === "synthetic") {
      try {
        const result = await callProvider(provider, request, at);
        reachable = true; response = result.response; retryCount = result.retryCount; source = "synthetic-provider"; error = null;
        let previousCurrent = false;
        if (previous && previous.releaseFingerprint === args.releaseFingerprint) {
          try { validateRecordedReceipt(previous, request, provider, at); previousCurrent = true; }
          catch { /* Expired and superseded versions remain auditable, never current. */ }
        }
        // Same normalized input under the SAME exact versions cannot change its
        // business output, even when the prior receipt has since expired.
        if (sameInput.some(h => {
          const prior = h.payload.governedReceipt!;
          return prior.response.serviceVersion === response!.serviceVersion
            && prior.response.taxonomyVersion === response!.taxonomyVersion
            && foundationFingerprint(prior.response.output) !== foundationFingerprint(response!.output);
        })) throw new FoundationProviderError("conflict");
        if (previousCurrent) {
          if (foundationFingerprint(previous!.response.output) !== foundationFingerprint(response.output))
            throw new FoundationProviderError("conflict");
          // Same logical result: the original immutable receipt remains the authority.
          response = previous!.response;
          acceptedReceipt = previous!;
        }
        if (!previousCurrent) {
          if (response.output?.type === "campaign_code") {
            // Transaction-scoped GLOBAL code lock: serialized across occurrences,
            // retained until COMMIT, including the duplicate query and append.
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [`webinar-foundation-code:${response.output.code}`]);
            const duplicate = await client.query(`SELECT id FROM webinar_persistence_records
              WHERE kind='source' AND payload->>'sourceType'='foundation'
                AND payload #>> '{governedReceipt,response,output,type}'='campaign_code'
                AND payload #>> '{governedReceipt,response,output,code}'=$1
                AND (campaign_id<>$2 OR session_id<>$3) LIMIT 1`,
            [response.output.code, request.scope.campaignId, request.scope.occurrenceId]);
            if (duplicate.rowCount) throw new FoundationProviderError("conflict");
          }
          const receipt: Receipt = { request, response, releaseFingerprint: args.releaseFingerprint,
            supersedesId: last?.id ?? null, receivedAt: result.receivedAt, retryCount, simulationOnly: true };
          acceptedReceipt = receipt;
          const row = await transaction.append({ campaignId: request.scope.campaignId, sessionId: request.scope.occurrenceId,
            actorId: args.actorId, expectedRevision: revision,
            idempotencyKey: `foundation:${foundationFingerprint({ contract: request.contract, type: request.type,
              scope: request.scope, environment: request.environment, serviceVersion: response.serviceVersion,
              taxonomyVersion: response.taxonomyVersion, release: args.releaseFingerprint, request, response })}`,
            standard: { id: STANDARD_ID, version: STANDARD_VERSION }, calculationAt: args.calculationAt,
            inputFingerprint: request.inputFingerprint, operational: false,
            payload: { kind: "source", sourceSystem: "campaign-manager-synthetic-contract", sourceType: "foundation",
              sourceId: request.scope.occurrenceId, sourceVersion: response.serviceVersion,
              sourceHash: foundationFingerprint(response), observedAt: response.respondedAt, status: "available",
              governedReceipt: receipt } });
          revision = row.revision;
          persistedIds.push(row.id);
          history.push({ id: row.id, payload: { governedReceipt: receipt } });
        }
      } catch (e) {
        if (!(e instanceof FoundationProviderError)) throw e;
        response = null; acceptedReceipt = null; error = e.reason; retryCount = e.retryCount; source = "none";
      }
    } else if (!provider && !response) error = "not_configured";
    else if (provider && provider.environment !== "synthetic") error = "prohibited_environment";
    if (response) {
      if (!acceptedReceipt) throw new Error("Validated Foundation response lacks an immutable transport receipt");
      receipts.push(acceptedReceipt);
    }
    observations.push({ type: request.type, requestReference: request.requestReference, inputFingerprint: request.inputFingerprint,
      status: response ? "available" : error === "expired" ? "expired" : error === "deprecated" ? "deprecated"
        : previous ? "stale" : "unavailable", error, source, response, retryCount });
  }
  return { revision, persistedIds, receipts, inspection: { contractLabel: "synthetic-contract-only", evaluatorImplemented: true, observationAvailable: receipts.length > 0,
    connectorConfigured: !!provider && provider.environment === "synthetic", connectorReachable: reachable,
    liveProductionConnection: false, observations } };
}
/** Read-only, scope-bound inspection: never invokes a provider or writes a receipt. */
export function inspectFoundationObservations(sources: OccurrenceSources, at: Date,
  provider: GovernanceFoundationProvider | null = configuredFoundationProvider(), releaseFingerprint?: string): FoundationInspection {
  const observations = buildFoundationRequests(sources).map(request => {
    const history = sources.records.filter(r => r.kind === "source" && r.payload.sourceType === "foundation")
      .filter(r => (r.payload.governedReceipt as Receipt | undefined)?.request.inputFingerprint === request.inputFingerprint);
    const last = history.at(-1)?.payload.governedReceipt as Receipt | undefined;
    let response: FoundationResponse | null = null, error: FoundationFailure | null = null;
    const keyed = new Map<string, string>();
    let conflict = false;
    for (const row of history) {
      const prior = row.payload.governedReceipt as Receipt;
      const key = foundationFingerprint({ serviceVersion: prior.response.serviceVersion,
        taxonomyVersion: prior.response.taxonomyVersion, environment: prior.response.environment });
      const digest = foundationFingerprint(prior.response.output);
      if (keyed.has(key) && keyed.get(key) !== digest) conflict = true;
      keyed.set(key, digest);
    }
    if (conflict) error = "conflict";
    else if (last && provider && (!releaseFingerprint || last.releaseFingerprint === releaseFingerprint)) {
      try { response = validateRecordedReceipt(last, request, provider, at); }
      catch (e) { error = failure(e).reason; }
    } else error = provider ? "unavailable" : "not_configured";
    return { type: request.type, requestReference: request.requestReference, inputFingerprint: request.inputFingerprint,
      status: response ? "available" as const : error === "expired" ? "expired" as const
        : error === "deprecated" ? "deprecated" as const : last ? "stale" as const : "unavailable" as const,
      error, source: response ? "immutable-history" as const : "none" as const,
      response, retryCount: last?.retryCount ?? 0 };
  });
  return { contractLabel: "synthetic-contract-only", evaluatorImplemented: true, observationAvailable: observations.some(o => o.status === "available"),
    connectorConfigured: !!provider && provider.environment === "synthetic", connectorReachable: false,
    liveProductionConnection: false, observations };
}
/** Refresh is an orchestration command, never an observation-only write. */
export async function refreshFoundationObservations(input: import("./webinar-evaluation-orchestration").WebinarSimulationInput,
  provider?: GovernanceFoundationProvider | null) {
  const { simulateWebinarOccurrence } = await import("./webinar-evaluation-orchestration");
  return simulateWebinarOccurrence(input, provider, true);
}