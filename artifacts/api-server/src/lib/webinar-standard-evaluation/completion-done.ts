import type { RuleId, WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { COMPLETE_OBLIGATIONS } from "../webinar-standard-readiness/types";
import { isBlockingType, resolveClaims } from "../webinar-standard-readiness/claims";
import { validateIncomingResults } from "../webinar-standard-readiness/result-validation";
import type { EvaluationContext, RuleEvaluationResult, RuleFinding } from "./types";
import type { CompletionDoneEvaluator, CompletionProjection, CompletionSnapshotContext, CompletionFindingEnvelope } from "./completion-done-types";

export const COMPLETION_DONE_RULE_ID = "WEB-DONE-001" as const;
export const COMPLETION_DONE_RULE_IDS = Object.freeze([COMPLETION_DONE_RULE_ID] as const);
export const COMPLETION_SECTION_E_RULE_IDS = Object.freeze([
  "WEB-FU-ATT-001", "WEB-FU-ATT-002", "WEB-FU-ATT-003", "WEB-FU-ATT-004", "WEB-FU-ATT-005",
  "WEB-FU-ABS-001", "WEB-FU-ABS-002", "WEB-FU-ABS-003", "WEB-FU-ABS-004", "WEB-FU-ABS-005",
  "WEB-FU-UNK-001", "WEB-FU-UNK-002", "WEB-FU-UNK-003",
  "WEB-FU-WL-001", "WEB-FU-WL-002", "WEB-FU-WL-003", "WEB-FU-WL-004",
  "WEB-FU-CAN-001", "WEB-FU-CAN-002", "WEB-FU-INT-001", "WEB-FU-INT-002", "WEB-FU-VAR-001",
] as const);

export type CompletionDependencyGraph = Readonly<Record<string, readonly string[]>>;
export const COMPLETION_DEPENDENCY_GRAPH: CompletionDependencyGraph = Object.freeze({
  "WEB-FU-ATT-001": Object.freeze([]),
  "WEB-FU-ABS-001": Object.freeze([]),
  "WEB-FU-UNK-001": Object.freeze([]),
  "WEB-FU-UNK-003": Object.freeze(["WEB-FU-UNK-001"]),
  "WEB-RDY-COMP-001": Object.freeze(["WEB-FU-UNK-001", "WEB-FU-UNK-003"]),
  "WEB-RDY-COMP-002": COMPLETION_SECTION_E_RULE_IDS,
  "WEB-RDY-COMP-003": Object.freeze(["WEB-EXC-001"]),
  "WEB-RDY-COMP-004": Object.freeze(["WEB-SETUP-018"]),
  "WEB-EXC-001": Object.freeze([]),
  [COMPLETION_DONE_RULE_ID]: Object.freeze([
    "WEB-RDY-COMP-001", "WEB-RDY-COMP-002", "WEB-RDY-COMP-003", "WEB-RDY-COMP-004", "WEB-EXC-001",
  ]),
});

export function createCompletionDependencyGraph(catalog: WebinarStandardCatalog): CompletionDependencyGraph {
  const graph: Record<string, readonly string[]> = {};
  for (const id of catalog.rules.map(rule => rule.ruleId)) graph[id] = Object.freeze([]);
  const ids = catalog.rules.map(rule => rule.ruleId);
  for (const id of COMPLETION_SECTION_E_RULE_IDS) {
    if (!ids.includes(id)) throw new Error(`Completion dependency references unknown canonical rule ${id}.`);
  }
  graph["WEB-RDY-COMP-001"] = Object.freeze(["WEB-FU-UNK-001", "WEB-FU-UNK-003"]);
  graph["WEB-RDY-COMP-002"] = COMPLETION_SECTION_E_RULE_IDS;
  graph["WEB-RDY-COMP-003"] = Object.freeze(catalog.rules.filter(rule => rule.exceptionEligible)
    .map(rule => rule.ruleId).filter(id => id !== "WEB-EXC-001" && id !== COMPLETION_DONE_RULE_ID));
  graph["WEB-RDY-COMP-004"] = Object.freeze(["WEB-SETUP-018"]);
  graph["WEB-EXC-001"] = Object.freeze(catalog.rules.filter(rule => rule.exceptionEligible)
    .map(rule => rule.ruleId).filter(id => id !== "WEB-EXC-001"));
  graph[COMPLETION_DONE_RULE_ID] = Object.freeze(ids.filter(id => id !== COMPLETION_DONE_RULE_ID));
  return Object.freeze(graph);
}

/** Deterministic DFS used both for the published graph and future additions. */
export function assertAcyclicCompletionDependencyGraph(graph: CompletionDependencyGraph): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) throw new Error(`Completion dependency cycle: ${[...path, id].join(" -> ")}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of [...(graph[id] ?? [])].sort()) {
      if (dependency === id) throw new Error(`Completion dependency cycle: ${id} -> ${id}`);
      visit(dependency, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of Object.keys(graph).sort()) visit(id, []);
}

assertAcyclicCompletionDependencyGraph(COMPLETION_DEPENDENCY_GRAPH);

/** Stable, deliberately boring fingerprint: it is derived from the supplied
 * canonical inventory and never from a count or an environment value. */
export function deriveCompletionRegistryFingerprint(catalog: WebinarStandardCatalog): string {
  return catalog.rules.map((rule) => rule.ruleId).join("|");
}

const finding = (status: RuleFinding["status"], reason: RuleFinding["reason"], evidence: readonly string[]): RuleFinding =>
  Object.freeze({ status, reason, evidence: Object.freeze([...evidence]) });

function projectionFailure(
  outcome: CompletionProjection["outcome"], issues: readonly string[],
): CompletionProjection {
  return Object.freeze({
    outcome, complete: false, blockers: Object.freeze([]), evidenceUnavailable: Object.freeze([]),
    operationalGaps: Object.freeze([]), resolvedByException: Object.freeze([]),
    advisories: Object.freeze([]), issues: Object.freeze([...issues]),
  });
}

function scope(snapshot: CompletionSnapshotContext, context: EvaluationContext): string[] {
  const issues: string[] = [];
  if (snapshot.standardId !== "WEB-STANDARD-001") issues.push("Snapshot standard is not WEB-STANDARD-001.");
  if (snapshot.eventId !== context.event.eventId) issues.push("Snapshot event does not match the evaluated event.");
  if (!snapshot.occurrenceId.trim()) issues.push("Snapshot occurrence is missing.");
  if (!Number.isSafeInteger(snapshot.calculatedAtEpochMs) || snapshot.calculatedAtEpochMs < 0
    || snapshot.calculatedAtEpochMs !== context.observedAtEpochMs) issues.push("Snapshot calculation time is stale or invalid.");
  if (!snapshot.registryFingerprint.trim()) issues.push("Registry fingerprint is missing.");
  if (!Array.isArray(snapshot.canonicalRuleIds) || snapshot.canonicalRuleIds.length === 0) issues.push("Canonical rule inventory is missing.");
  if (!snapshot.evidenceSnapshot) issues.push("Evidence snapshot is required.");
  else {
    if (!snapshot.evidenceSnapshot.snapshotId.trim()
      || snapshot.evidenceSnapshot.snapshotCompleteness !== "complete"
      || snapshot.evidenceSnapshot.eventId !== snapshot.eventId
      || snapshot.evidenceSnapshot.occurrenceId !== snapshot.occurrenceId
      || snapshot.evidenceSnapshot.calculatedAtEpochMs !== snapshot.calculatedAtEpochMs
      || snapshot.evidenceSnapshot.registryFingerprint !== snapshot.registryFingerprint) {
      issues.push("Evidence snapshot is incomplete, stale, or mis-scoped.");
    }
  }
  if (!snapshot.exceptionSnapshotId.trim()) issues.push("Exception snapshot identity is required.");
  return issues;
}

let lastProjection: CompletionProjection | null = null;
/** Projection is intentionally separate from the established RuleFinding
 * union; this accessor is useful to hosts that want rich diagnostics. */
export function getLastCompletionProjection(): CompletionProjection | null { return lastProjection; }

export function evaluateCompletionDone(catalog: WebinarStandardCatalog, context: EvaluationContext): RuleFinding {
  const snapshot = context.completionSnapshot;
  if (!snapshot) return finding("evidence_unavailable", "missing_evidence", ["A complete evaluation snapshot is required."]);
  const badScope = scope(snapshot, context);
  const canonical = catalog.rules.map((rule) => rule.ruleId);
  const canonicalSet = new Set(canonical);
  if (snapshot.standardVersion !== catalog.standardVersion) badScope.push("Snapshot standard version does not match the catalog.");
  if (snapshot.registryFingerprint !== deriveCompletionRegistryFingerprint(catalog)) badScope.push("Registry fingerprint does not match the canonical inventory.");
  if (snapshot.canonicalRuleIds.length !== canonical.length
    || new Set(snapshot.canonicalRuleIds).size !== snapshot.canonicalRuleIds.length
    || snapshot.canonicalRuleIds.some((id) => !canonicalSet.has(id))
    || canonical.some((id) => !snapshot.canonicalRuleIds.includes(id))) badScope.push("Snapshot canonical inventory is not an exact catalog inventory.");
  if (snapshot.evidenceSnapshot && (snapshot.evidenceSnapshot.eventId !== snapshot.eventId
    || snapshot.evidenceSnapshot.occurrenceId !== snapshot.occurrenceId
    || snapshot.evidenceSnapshot.snapshotCompleteness !== "complete")) badScope.push("Evidence snapshot is incomplete or mis-scoped.");
  if (badScope.length) {
    lastProjection = projectionFailure("incomplete_invalid_context", badScope);
    return finding("fail", "invalid_context", badScope);
  }

  const envelopes = snapshot.results;
  const envelopeIssues: string[] = [];
  const fingerprint = snapshot.registryFingerprint;
  const boundResults: unknown[] = [];
  for (const envelope of envelopes) {
    if (!envelope || typeof envelope !== "object" || !("result" in envelope)) {
      envelopeIssues.push("Every prerequisite requires an occurrence-bound result envelope.");
      continue;
    }
    const candidate = envelope as CompletionFindingEnvelope;
    if (candidate.eventId !== snapshot.eventId || candidate.occurrenceId !== snapshot.occurrenceId
      || candidate.calculatedAtEpochMs !== snapshot.calculatedAtEpochMs
      || candidate.snapshotFingerprint !== fingerprint
      || !candidate.evidenceSnapshotId.trim()
      || !candidate.exceptionSnapshotId.trim()
      || candidate.evidenceSnapshotId !== snapshot.evidenceSnapshot?.snapshotId
      || candidate.exceptionSnapshotId !== snapshot.exceptionSnapshotId) {
      envelopeIssues.push("A prerequisite result is stale or outside the evaluated occurrence.");
    } else boundResults.push(candidate.result);
  }
  if (envelopeIssues.length) {
    lastProjection = projectionFailure("incomplete_invalid_context", envelopeIssues);
    return finding("fail", "invalid_context", envelopeIssues);
  }
  const incoming = validateIncomingResults(boundResults, catalog);
  const expected = canonical.filter((id) => id !== COMPLETION_DONE_RULE_ID);
  const seen = new Set(incoming.results.map((result) => result.ruleId));
  const missing = expected.filter((id) => !seen.has(id));
  const issues = incoming.issues.map((issue) => `${issue.code}: ${issue.message}`);
  if (missing.length) issues.push(`Missing prerequisite results: ${missing.join(", ")}.`);
  if (incoming.duplicateRuleIds.length) issues.push(`Duplicate prerequisite results: ${incoming.duplicateRuleIds.join(", ")}.`);
  if (boundResults.some((value) => typeof value === "object" && value !== null
    && "ruleId" in value && (value as { ruleId?: unknown }).ruleId === COMPLETION_DONE_RULE_ID)) {
    issues.push("WEB-DONE-001 cannot be its own prerequisite.");
  }
  if (issues.length) {
    lastProjection = projectionFailure("incomplete_evaluator_unavailable", issues);
    return finding("fail", "invalid_context", issues);
  }
  const results = incoming.results;
  const exceptions = resolveClaims(snapshot.exceptionClaims, snapshot.exceptions, catalog, results, incoming.duplicateRuleIds, snapshot.calculatedAtEpochMs);
  const resolved = new Set(exceptions.resolutions.map((item) => item.ruleId));
  const blockers = results.filter((result) => isBlockingType(result.rule.primaryRuleType)
    && result.status === "fail" && !resolved.has(result.ruleId));
  const invalidFailures = results.filter(result => result.status === "fail" && result.reason === "invalid_context");
  const unavailable = results.filter((result) => isBlockingType(result.rule.primaryRuleType)
    && (result.status === "evidence_unavailable" || result.status === "unimplemented"));
  const advisories = results.filter((result) => !isBlockingType(result.rule.primaryRuleType)
    && (result.status === "fail" || result.status === "evidence_unavailable"));
  const operationalGaps: string[] = COMPLETE_OBLIGATIONS.filter(name => {
    const state = snapshot.operationalObligations[name];
    return state === undefined || state === "unresolved" || state === "unknown";
  });
  const obligationKeys = Object.keys(snapshot.operationalObligations).sort();
  if (obligationKeys.join("|") !== [...COMPLETE_OBLIGATIONS].sort().join("|")) {
    operationalGaps.push("operationalObligations");
  }
  const exceptionIssues = exceptions.issues.map((issue) => issue.message);
  if (exceptionIssues.length) issues.push(...exceptionIssues);
  if (invalidFailures.length) {
    lastProjection = projectionFailure("incomplete_invalid_context", ["A result reports invalid context."]);
    return finding("fail", "invalid_context", ["A result reports invalid context."]);
  }
  if (exceptionIssues.length) {
    lastProjection = projectionFailure("incomplete_invalid_context", exceptionIssues);
    return finding("fail", "invalid_context", exceptionIssues);
  }
  const outcome: CompletionProjection["outcome"] = blockers.length ? "incomplete_blocker"
    : unavailable.length ? "incomplete_evidence"
      : operationalGaps.length ? "incomplete_operational"
        : advisories.length ? "advisory"
          : resolved.size ? "resolvedByException" : "complete";
  const complete = outcome === "complete" || outcome === "resolvedByException" || outcome === "advisory";
  lastProjection = Object.freeze({
    outcome, complete, blockers: Object.freeze(blockers), evidenceUnavailable: Object.freeze(unavailable),
    operationalGaps: Object.freeze(operationalGaps), resolvedByException: Object.freeze([...resolved]),
    advisories: Object.freeze(advisories), issues: Object.freeze(issues),
  });
  if (!complete) return finding("fail", unavailable.some(result => result.status === "unimplemented")
    ? "invalid_context" : unavailable.length ? "missing_evidence" : "violation",
    [...blockers, ...unavailable].map((result) => result.rule.failureMessage).concat(operationalGaps));
  return finding("pass", "satisfied", advisories.map((result) => `Advisory retained: ${result.ruleId}.`));
}

export function createCompletionDoneEvaluator(catalog: WebinarStandardCatalog): Readonly<Record<typeof COMPLETION_DONE_RULE_ID, CompletionDoneEvaluator>> {
  return Object.freeze({ [COMPLETION_DONE_RULE_ID]: (context: EvaluationContext) => evaluateCompletionDone(catalog, context) });
}

export function createCompletionDoneEvaluators(catalog: WebinarStandardCatalog): Readonly<Record<typeof COMPLETION_DONE_RULE_ID, CompletionDoneEvaluator>> {
  return createCompletionDoneEvaluator(catalog);
}