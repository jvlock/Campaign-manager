import { createHash } from "node:crypto";
import { z } from "zod";
import { loadWebinarStandardCatalog, STANDARD_ID, STANDARD_VERSION } from "./webinar-standard-catalog";
import { validateWebinarStandardCatalog } from "./webinar-standard-catalog/validate";
import { RULE_IDS, type RuleId, type WebinarStandardCatalog } from "./webinar-standard-catalog/types";
import { assembleEvaluationInput } from "./webinar-domain-adapters";
import type { AssemblyResult, SourceReference } from "./webinar-domain-adapters";
import { immutable } from "./webinar-domain-adapters/common";
import { createWebinarEvaluatorRegistry } from "./webinar-standard-evaluation";
import type { EvaluationContext, EventOperationalStatus, RuleEvaluationResult, PartialEvaluatorRegistry } from "./webinar-standard-evaluation";
import { COMPLETION_DEPENDENCY_GRAPH, COMPLETION_DONE_RULE_ID, deriveCompletionRegistryFingerprint, evaluateCompletionDoneWithDiagnostics } from "./webinar-standard-evaluation/completion-done";
import { aggregateWebinarReadiness, COMPLETE_OBLIGATIONS } from "./webinar-standard-readiness";
import type { ExceptionResolutionClaim } from "./webinar-standard-readiness/types";
import { captureWebinarRelease, resolveWebinarRepositoryRoot } from "./webinar-release-provenance";
import { WebinarPersistence, PersistenceConflict, type WebinarTransactionClient } from "./webinar-persistence";
import { simulationFindingSchema, simulationSnapshotSchema, type SimulationSnapshot } from "./webinar-simulation-snapshot";
import { assertOccurrenceEligibility, loadOccurrenceSources, lockEvaluationSources, occurrenceAssemblySource, type OccurrenceSources } from "./webinar-evaluation-sources";

export interface SimulationDiagnostics {
  readonly invokedRuleIds: readonly RuleId[];
  readonly evaluatorErrors: readonly { ruleId: RuleId; code: string }[];
  readonly sourceRecordCount: number;
  readonly replayed: boolean;
}
/** A broken implementation cannot be persisted as a successful missing-input simulation. */
export class EvaluationImplementationError extends Error {
  readonly code = "webinar_evaluation_implementation_error";
  readonly status = 503;
  constructor(message: string, readonly diagnostics: SimulationDiagnostics) { super(message); }
}
export type WebinarSimulationResult = SimulationSnapshot & {
  readonly snapshotId: string; readonly revision: number; readonly diagnostics: SimulationDiagnostics;
};
const commandSchema = z.object({
  campaignId: z.string().uuid(), sessionId: z.string().uuid(), actorId: z.string().uuid(),
  calculationAt: z.string().datetime(), expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/),
}).strict();
export type WebinarSimulationInput = z.infer<typeof commandSchema>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function simulationFingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
/** Snapshot writes/revisions are outputs, not new domain facts on the next retry. */
export function sourceInputFingerprint(sources: OccurrenceSources, calculationAt: string): string {
  // Canvas position and its general row audit counters are not evaluation facts.
  // Relevant activity content remains fully hashed. The separate read token below
  // still detects any concurrent version change during this request.
  const { x: _x, y: _y, row_version: _version, updated_at: _updated, ...activityFacts } = sources.activity;
  return simulationFingerprint({ ...sources, activity: activityFacts, binding: sources.binding && {
    standard_id: sources.binding.standard_id, standard_version: sources.binding.standard_version,
  }, calculationAt });
}

function assertExactInventory(label: string, ids: readonly string[]): void {
  if (ids.length !== 106 || new Set(ids).size !== 106
    || [...ids].sort().join("|") !== [...RULE_IDS].sort().join("|")) {
    throw new EvaluationImplementationError(`Canonical 106-rule ${label} inventory drift`, immutable({
      invokedRuleIds: [], evaluatorErrors: [], sourceRecordCount: 0, replayed: false,
    }));
  }
}

/** Canonical dependency ordering, rather than parallel rule-specific business logic. */
function evaluationOrder(catalog: WebinarStandardCatalog): RuleId[] {
  const ordered: RuleId[] = [], visited = new Set<string>(), active = new Set<string>();
  const ids = new Set(catalog.rules.map(r => r.ruleId));
  function visit(id: RuleId) {
    if (visited.has(id)) return;
    if (active.has(id)) throw new Error("Canonical evaluation dependency cycle");
    active.add(id);
    for (const dependency of [...(COMPLETION_DEPENDENCY_GRAPH[id] ?? [])].sort()) {
      if (!ids.has(dependency as RuleId)) throw new Error("Unknown canonical evaluation dependency");
      visit(dependency as RuleId);
    }
    active.delete(id); visited.add(id); ordered.push(id);
  }
  for (const id of [...ids].filter(id => id !== COMPLETION_DONE_RULE_ID).sort()) visit(id);
  visit(COMPLETION_DONE_RULE_ID);
  return ordered;
}

/** Pure evaluation boundary; injectable documentary inputs are for internal adapters/tests,
 * never request bodies. All conclusions and exception decisions come from canonical modules.
 */
export function evaluateCanonicalAssembly(input: {
  assembly: AssemblyResult; catalog: WebinarStandardCatalog; activityId: string; occurrenceId: string;
  calculationAt: string; releaseFingerprint: string; inputFingerprint: string;
  sourceReferences?: readonly SourceReference[]; exceptions?: readonly unknown[];
  exceptionClaims?: readonly ExceptionResolutionClaim[];
  /** Internal test/integration dependency only; never sourced from HTTP input. */
  registry?: PartialEvaluatorRegistry;
}): { snapshot: SimulationSnapshot; diagnostics: SimulationDiagnostics } {
  const { assembly, catalog } = input;
  assertExactInventory("catalog", catalog.rules.map(rule => rule.ruleId));
  if (catalog.ruleCount !== 106 || !validateWebinarStandardCatalog(catalog).ok
    || catalog.standardId !== STANDARD_ID || catalog.standardVersion !== STANDARD_VERSION) {
    throw new Error("Evaluation requires the exact canonical standard identity");
  }
  const registry = input.registry ?? createWebinarEvaluatorRegistry(catalog);
  assertExactInventory("implemented evaluator", registry.implementedRuleIds);
  assertExactInventory("registry entry", registry.entries.map(entry => entry.ruleId));
  if (registry.unimplementedRuleIds.length !== 0 || typeof registry.evaluate !== "function") {
    throw new EvaluationImplementationError("Missing canonical evaluator implementation", immutable({
      invokedRuleIds: [], evaluatorErrors: [], sourceRecordCount: 0, replayed: false,
    }));
  }
  const time = Date.parse(input.calculationAt);
  const exceptions = input.exceptions ?? [], exceptionClaims = input.exceptionClaims ?? [];
  const obligations = Object.fromEntries(COMPLETE_OBLIGATIONS.map(key => [key, "unknown" as const])) as Record<(typeof COMPLETE_OBLIGATIONS)[number], "unknown">;
  const results: RuleEvaluationResult[] = [];
  const invokedRuleIds: RuleId[] = [], evaluatorErrors: { ruleId: RuleId; code: string }[] = [];
  // Invalid structural input stays invalid: this is not a fabricated event or a favorable default.
  const absentContext = { observedAtEpochMs: time, event: null, participant: null, communications: [],
    registrationFlowTest: null, joinLinkOrVenueTest: null, consent: null, governance: null, followUp: null } as unknown as EvaluationContext;
  let context = assembly.context ?? absentContext;
  for (const id of evaluationOrder(catalog)) {
    if (assembly.context && id === COMPLETION_DONE_RULE_ID) {
      const registryFingerprint = deriveCompletionRegistryFingerprint(catalog);
      context = immutable({ ...context, completionSnapshot: {
        standardId: catalog.standardId, standardVersion: catalog.standardVersion, eventId: input.occurrenceId,
        occurrenceId: input.occurrenceId, calculatedAtEpochMs: time, registryFingerprint,
        exceptionSnapshotId: input.inputFingerprint, canonicalRuleIds: catalog.rules.map(r => r.ruleId),
        exceptions, exceptionClaims, operationalObligations: obligations,
        // A fully enumerated evaluation is not proof of a complete evidence inventory.
        evidenceSnapshot: { snapshotId: input.inputFingerprint, snapshotCompleteness: "partial" as const,
          eventId: input.occurrenceId, occurrenceId: input.occurrenceId, calculatedAtEpochMs: time, registryFingerprint },
        results: results.map(result => ({ result, eventId: input.occurrenceId, occurrenceId: input.occurrenceId,
          calculatedAtEpochMs: time, snapshotFingerprint: registryFingerprint,
          evidenceSnapshotId: input.inputFingerprint, exceptionSnapshotId: input.inputFingerprint })),
      } });
    }
    invokedRuleIds.push(id);
    let result: RuleEvaluationResult | undefined;
    try { result = registry.evaluate(id, context); }
    catch {
      // Invalid contexts are a documented input boundary; valid-context exceptions are
      // implementation failures that abort the entire transaction, never missing evidence.
      evaluatorErrors.push({ ruleId: id, code: assembly.context ? "evaluator-implementation-error" : "required-input-unavailable" });
      result = undefined;
    }
    if (result !== undefined) {
      try {
        simulationFindingSchema.parse(result);
        if (result.ruleId !== id || result.standardId !== catalog.standardId
          || result.standardVersion !== catalog.standardVersion || result.status === "unimplemented"
          || simulationFingerprint(result.rule) !== simulationFingerprint(catalog.rules.find(rule => rule.ruleId === id))) {
          throw new Error("Evaluator returned an incorrect canonical result identity");
        }
      } catch {
        evaluatorErrors.push({ ruleId: id, code: "evaluator-invalid-result" });
        result = undefined;
      }
    } else if (!evaluatorErrors.some(error => error.ruleId === id)) {
      evaluatorErrors.push({ ruleId: id, code: "evaluator-invalid-result" });
    }
    if (!assembly.context) {
      const rule = catalog.rules.find(rule => rule.ruleId === id)!;
      result = { mode: "descriptive_only", standardId: catalog.standardId, standardVersion: catalog.standardVersion,
        ruleId: id, rule, status: "evidence_unavailable", reason: "missing_evidence", participantId: null,
        evidence: ["Canonical evaluation input is missing or invalid; this rule was not assessed."] };
    }
    if (result) results.push(result);
  }
  assertExactInventory("invocation", invokedRuleIds);
  if (evaluatorErrors.some(error => error.code !== "required-input-unavailable")) {
    throw new EvaluationImplementationError("Canonical evaluator implementation failed; no simulation snapshot was produced", immutable({
      invokedRuleIds, evaluatorErrors, sourceRecordCount: assembly.sourceReferences.length, replayed: false,
    }));
  }
  assertExactInventory("result", results.map(result => result.ruleId));
  results.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const readiness = aggregateWebinarReadiness(catalog, registry, {
    evaluationTimeEpochMs: time, results, exceptions, exceptionClaims, completeObligations: obligations,
  });
  const completion = evaluateCompletionDoneWithDiagnostics(catalog, context).projection;
  const resolved = readiness.stages.flatMap(s => s.exceptionResolvedBlockers);
  const resolvedIds = new Set(resolved.map(r => r.ruleId));
  const refs = [...assembly.sourceReferences, ...(input.sourceReferences ?? [])];
  const sourceReferences = [...new Map(refs.map(r => [`${r.sourceType}:${r.sourceId}`, r])).values()]
    .sort((a, b) => `${a.sourceType}:${a.sourceId}`.localeCompare(`${b.sourceType}:${b.sourceId}`));
  const snapshot = simulationSnapshotSchema.parse({
    activityId: input.activityId, occurrenceId: input.occurrenceId,
    standard: { id: catalog.standardId, version: catalog.standardVersion }, calculationAt: input.calculationAt,
    releaseFingerprint: input.releaseFingerprint, inputFingerprint: input.inputFingerprint, sourceReferences, results,
    applicableRules: results.filter(r => r.status !== "not_applicable").map(r => r.ruleId),
    passedRules: results.filter(r => r.status === "pass").map(r => r.ruleId),
    unresolvedBlockingFailures: readiness.stages.flatMap(s => s.failedBlockers).filter(r => !resolvedIds.has(r.ruleId)),
    blockersResolvedByExceptions: resolved, nonblockingFailures: readiness.stages.flatMap(s => s.failedNonBlocking),
    warnings: readiness.stages.flatMap(s => s.warnings), missingInputData: assembly.missingInputs,
    unavailableExternalObservations: assembly.unavailableInputs, mappingErrors: assembly.mappingErrors,
    evaluatorCoverage: readiness.coverage, readinessStages: readiness.stages, readinessIssues: readiness.issues,
    completionResult: completion, operationalStatus: "simulation-only",
  });
  return immutable({ snapshot, diagnostics: { invokedRuleIds, evaluatorErrors, sourceRecordCount: sourceReferences.length, replayed: false } });
}

function sourceReferences(sources: OccurrenceSources): SourceReference[] {
  const ref = (sourceType: string, r: Record<string, unknown>) => ({
    sourceType, sourceId: String(r.id ?? [r.communication_id, r.cta_id, r.landing_page_id, r.content_asset_id, r.activity_id].filter(Boolean).join(":")),
    sourceHash: simulationFingerprint(r),
    ...(r.row_version !== undefined || r.updated_at !== undefined || r.revision !== undefined
      ? { sourceVersion: String(r.row_version ?? r.updated_at ?? r.revision) } : {}),
  });
  return [
    ref("campaign", sources.campaign), ref("activity", sources.activity), ref("webinar-session", sources.occurrence),
    ...Object.entries(sources).flatMap(([sourceType, records]) =>
      Array.isArray(records) ? records.map((r: Record<string, unknown>) => ref(sourceType, r)) : []),
  ];
}

/** Internal development boundary; no evaluators or domain rules live in routes. */
export async function simulateWebinarOccurrence(raw: WebinarSimulationInput): Promise<WebinarSimulationResult> {
  const input = commandSchema.parse(raw);
  input.calculationAt = new Date(input.calculationAt).toISOString();
  const repository = new WebinarPersistence();
  return repository.withEvaluationTransaction(input, async (client, transaction) => {
    const sources = await loadOccurrenceSources(client, input.campaignId, input.sessionId);
    assertOccurrenceEligibility(sources);
    const sourceReadToken = simulationFingerprint(sources);
    const inputFingerprint = sourceInputFingerprint(sources, input.calculationAt);
    const release = await captureWebinarRelease(Date.parse(input.calculationAt));
    // Idempotency retries are resolved before stale-revision checks, but never across source/release changes.
    const existing = await client.query(`SELECT * FROM webinar_persistence_records
      WHERE session_id=$1 AND campaign_id=$2 AND kind='readiness'
      AND (idempotency_key=$3 OR (input_fingerprint=$4 AND calculation_at=$5))
      ORDER BY revision LIMIT 1`, [input.sessionId, input.campaignId, input.idempotencyKey, inputFingerprint, input.calculationAt]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      const saved = simulationSnapshotSchema.parse(row.payload.simulation);
      if (saved.inputFingerprint !== inputFingerprint || saved.releaseFingerprint !== release.digest
        || saved.calculationAt !== input.calculationAt || row.actor_id !== input.actorId
        || row.idempotency_key === input.idempotencyKey && row.revision !== input.expectedRevision + 2) {
        throw new PersistenceConflict("Simulation retry has changed source, calculation, attribution or release");
      }
      await lockEvaluationSources(client);
      if (simulationFingerprint(await loadOccurrenceSources(client, input.campaignId, input.sessionId)) !== sourceReadToken) {
        throw new PersistenceConflict("Source records changed during simulation retry");
      }
      return immutable({ ...saved, snapshotId: row.id, revision: row.revision,
        diagnostics: { invokedRuleIds: [], evaluatorErrors: [], sourceRecordCount: saved.sourceReferences.length, replayed: true } });
    }
    if (sources.binding!.revision !== input.expectedRevision) throw new PersistenceConflict("Occurrence revision changed; reload before simulation");
    const assembly = assembleEvaluationInput(occurrenceAssemblySource(sources, input.calculationAt));
    // The loader's source-relative default is intentionally not valid after bundling.
    // Use the same server-known workspace root as release capture.
    const catalog = await loadWebinarStandardCatalog({ repositoryRoot: resolveWebinarRepositoryRoot() });
    const incompleteExceptions = sources.records.filter(r => r.kind === "exception-disposition").map(r => {
      const request = sources.records.find(q => q.id === r.parent_id && q.kind === "exception-request");
      // Opaque persistence metadata cannot manufacture canonical rationale/expiry/audit/identity.
      return { exceptionId: r.id, standardId: STANDARD_ID, standardVersion: STANDARD_VERSION,
        ruleId: request?.payload.ruleId, decision: r.payload.disposition === "approved" ? "approved" : "rejected",
        requestor: request?.actor_id, reviewer: r.actor_id, reviewerVerificationStatus: "unverified" };
    });
    const exceptionClaims = incompleteExceptions.filter(e => typeof e.ruleId === "string" && e.decision === "approved")
      .map(e => ({ ruleId: e.ruleId as string, exceptionId: e.exceptionId }));
    const evaluated = evaluateCanonicalAssembly({ assembly, catalog, activityId: sources.activity.id,
      occurrenceId: input.sessionId, calculationAt: input.calculationAt, releaseFingerprint: release.digest,
      inputFingerprint, sourceReferences: sourceReferences(sources), exceptions: incompleteExceptions, exceptionClaims });
    await lockEvaluationSources(client);
    const finalSources = await loadOccurrenceSources(client, input.campaignId, input.sessionId);
    if (simulationFingerprint(finalSources) !== sourceReadToken) {
      throw new PersistenceConflict("Source records changed during evaluation; reload before simulation");
    }
    const command = { ...input, standard: { id: STANDARD_ID, version: STANDARD_VERSION }, inputFingerprint, operational: false as const };
    const releaseRecord = await transaction.append({ ...command, idempotencyKey: `${input.idempotencyKey}:release`, payload: { kind: "release" } });
    if (releaseRecord.payload.digest !== release.digest) throw new PersistenceConflict("Application release changed during evaluation");
    const snapshot = evaluated.snapshot;
    const row = await transaction.append({ ...command, expectedRevision: input.expectedRevision + 1,
      releaseId: releaseRecord.id, payload: { kind: "readiness", stage: "completion",
        result: snapshot.readinessStages.some(s => s.status === "blocked") ? "not-ready" : "unknown",
        resultFingerprint: simulationFingerprint(snapshot), evidenceIds: sources.records.filter(r => r.kind === "evidence").map(r => r.id),
        exceptionIds: sources.records.filter(r => r.kind === "exception-disposition").map(r => r.id), simulation: snapshot } });
    return immutable({ ...snapshot, snapshotId: row.id, revision: row.revision, diagnostics: evaluated.diagnostics });
  });
}

/**
 * Called ONLY from the existing synthetic new-occurrence creation transaction.
 * Requiring xmin=current transaction prevents using this helper to opt in an old
 * default_5/legacy_9 occurrence. The source session is not altered.
 */
export async function initializeNewSyntheticOccurrence(client: WebinarTransactionClient,
  campaignId: string, sessionId: string, actorId: string, eventStatus: EventOperationalStatus) {
  const inserted = await client.query(`SELECT s.id FROM webinar_sessions s
    JOIN activities a ON a.id=s.activity_id AND a.campaign_id=s.campaign_id
    WHERE s.id=$1 AND s.campaign_id=$2 AND s.xmin::text=pg_current_xact_id()::text
      AND NOT EXISTS(SELECT 1 FROM legacy_activities l WHERE l.activity_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM legacy_campaigns l WHERE l.campaign_id=s.campaign_id)
      AND EXISTS(SELECT 1 FROM development_record_registry r WHERE r.entity_type='campaign' AND r.entity_id=s.campaign_id)
      AND EXISTS(SELECT 1 FROM development_record_registry r WHERE r.entity_type='activity' AND r.entity_id=a.id)`, [sessionId, campaignId]);
  if (!inserted.rowCount) throw new PersistenceConflict("Only a newly inserted synthetic occurrence can opt into development simulation");
  const payload = { kind: "plan" as const, state: "draft" as const, eventStatus,
    simulationEligibility: "new-synthetic-occurrence" as const,
    planFingerprint: simulationFingerprint({ campaignId, sessionId, eventStatus }) };
  return new WebinarPersistence().appendInCreationTransaction(client, {
    campaignId, sessionId, actorId, expectedRevision: 0, idempotencyKey: `initialize:${sessionId}`,
    standard: { id: STANDARD_ID, version: STANDARD_VERSION }, calculationAt: new Date().toISOString(),
    inputFingerprint: payload.planFingerprint, operational: false, payload,
  });
}