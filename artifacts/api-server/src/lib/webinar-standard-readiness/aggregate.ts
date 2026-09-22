import {
  READINESS_STAGES, type WebinarStandardCatalog,
} from "../webinar-standard-catalog/types";
import { validateWebinarStandardCatalog } from "../webinar-standard-catalog/validate";
import type { PartialEvaluatorRegistry } from "../webinar-standard-evaluation/types";
import {
  COMPLETE_OBLIGATIONS, type ReadinessIssue, type ReadinessReport,
  type StageReadinessResult, type PrerequisiteIssue,
} from "./types";
import { registryCoverage } from "./coverage";
import { resolveClaims, isBlockingFailure } from "./claims";
import { validateIncomingResults } from "./result-validation";
import { compareText, freezeOwned, isRecord, snapshotData } from "./safe-data";

const INPUT_FIELDS = ["evaluationTimeEpochMs", "results", "exceptions", "exceptionClaims", "completeObligations"];
const issueKey = (issue: ReadinessIssue): string =>
  JSON.stringify([issue.stage, issue.ruleId, issue.code, issue.message]);

/**
 * Pure inventory and readiness calculation. Result coverage is not evaluator
 * implementation coverage. No evaluator, clock, identity service or delivery
 * capability is invoked here. Unimplemented/invalid results remain missing.
 */
export function aggregateWebinarReadiness(
  catalog: WebinarStandardCatalog, registry: PartialEvaluatorRegistry, input: unknown,
): ReadinessReport {
  const validation = validateWebinarStandardCatalog(catalog);
  if (!validation.ok) throw new Error("Readiness requires a valid webinar standard catalog.");
  const canonical = validation.catalog;
  const coverage = registryCoverage(canonical, registry);
  const snapshot = snapshotData(input);
  const data = snapshot.ok && isRecord(snapshot.value) ? snapshot.value : {};
  const issues: ReadinessIssue[] = [];
  const globalIssue = (code: string, message: string) => issues.push({ code, ruleId: null, stage: null, message });
  if (!snapshot.ok || !isRecord(snapshot.value)) globalIssue("invalid_input", "Readiness requires plain, acyclic data without executable properties.");
  for (const field of Object.keys(data).filter((key) => !INPUT_FIELDS.includes(key)).sort()) {
    void field;
    globalIssue("unknown_input_field", "Input includes a field outside the readiness contract.");
  }
  const suppliedTime = data.evaluationTimeEpochMs;
  const evaluationTime = typeof suppliedTime === "number" && Number.isSafeInteger(suppliedTime)
    && suppliedTime >= 0 && suppliedTime <= 8_640_000_000_000_000 ? suppliedTime : null;
  if (evaluationTime === null) globalIssue("invalid_evaluation_time", "Supply a valid epoch-millisecond observation time.");

  const incoming = validateIncomingResults(data.results, canonical);
  issues.push(...incoming.issues);
  const claims = resolveClaims(data.exceptionClaims, data.exceptions, canonical, incoming.results,
    incoming.duplicateRuleIds, evaluationTime);
  issues.push(...claims.issues);
  const obligations = isRecord(data.completeObligations) ? data.completeObligations : {};
  for (const key of Object.keys(obligations).filter((key) => !(COMPLETE_OBLIGATIONS as readonly string[]).includes(key)).sort()) {
    void key;
    issues.push({ code: "unknown_obligation", stage: "Complete", ruleId: null, message: "Unknown Complete obligation supplied." });
  }
  if (!isRecord(data.completeObligations)) {
    issues.push({ code: "missing_obligations", stage: "Complete", ruleId: null, message: "Complete requires explicit obligation evidence." });
  }
  const stages: StageReadinessResult[] = [];
  // Stage order comes from the catalog contract; only follow-up consults run.
  for (const stage of READINESS_STAGES) {
    const assigned = canonical.rules.filter((rule) => rule.readinessStage === stage).map((rule) => rule.ruleId).sort();
    const assignedSet = new Set(assigned);
    const findings = incoming.results.filter((result) => assignedSet.has(result.ruleId));
    const uniqueValid = findings.filter((result) => !incoming.duplicateRuleIds.includes(result.ruleId)
      && result.status !== "unimplemented");
    const evaluated = uniqueValid.map((result) => result.ruleId).sort();
    const evaluatedSet = new Set(evaluated);
    const missing = assigned.filter((id) => !evaluatedSet.has(id));
    const notApplicable = uniqueValid.filter((result) => result.status === "not_applicable");
    const notApplicableIds = new Set(notApplicable.map((result) => result.ruleId));
    const failedBlockers = findings.filter(isBlockingFailure);
    const resolved = claims.resolutions.filter((resolution) => assignedSet.has(resolution.ruleId));
    const resolvedIds = new Set(resolved.map((resolution) => resolution.ruleId));
    const unresolved = [...new Set(failedBlockers.map((result) => result.ruleId).filter((id) => !resolvedIds.has(id)))].sort();
    const stageIssues = issues.filter((issue) => issue.stage === null || issue.stage === stage);
    const prerequisites: PrerequisiteIssue[] = [];
    if (stage === "Ready to follow up") {
      const run = stages.find((result) => result.stage === "Ready to run");
      if (!run) throw new Error("Canonical stage order is missing Ready to run.");
      if (run.status !== "ready") prerequisites.push({
        prerequisite: "Ready to run", status: run.status,
        message: `Ready to follow up requires Ready to run; its status is ${run.status}.`,
      });
    }
    if (stage === "Complete") {
      for (const obligation of COMPLETE_OBLIGATIONS) {
        const status = obligations[obligation];
        if (status === "unresolved") prerequisites.push({
          prerequisite: obligation, status: "blocked", message: `Unresolved obligation: ${obligation}.`,
        });
        else if (status !== "resolved" && status !== "not_applicable") prerequisites.push({
          prerequisite: obligation, status: "incomplete", message: `Missing or unknown obligation evidence: ${obligation}.`,
        });
      }
    }
    const blocked = unresolved.length > 0 || prerequisites.some((issue) => issue.status === "blocked");
    const incomplete = missing.length > 0 || stageIssues.length > 0 || prerequisites.some((issue) => issue.status === "incomplete");
    stages.push({
      stage, status: blocked ? "blocked" : incomplete ? "incomplete" : "ready",
      fullyEvaluated: missing.length === 0 && stageIssues.length === 0,
      assignedRuleIds: assigned,
      applicableRuleIds: assigned.filter((id) => !notApplicableIds.has(id)),
      evaluatedRuleIds: evaluated, missingRuleIds: missing,
      passes: uniqueValid.filter((result) => result.status === "pass"),
      notApplicable, failedBlockers,
      failedNonBlocking: findings.filter((result) => result.status === "fail" && !isBlockingFailure(result)),
      exceptionResolvedBlockers: resolved, unresolvedRuleIds: unresolved,
      diagnosticCoveragePercent: assigned.length === 0 ? 100 : 100 * evaluated.length / assigned.length,
      issues: [...stageIssues].sort((a, b) => compareText(issueKey(a), issueKey(b))),
      prerequisiteIssues: prerequisites,
    });
  }
  return freezeOwned({
    mode: "descriptive_only", evaluationTimeEpochMs: evaluationTime, coverage, stages,
    issues: [...issues].sort((a, b) => compareText(issueKey(a), issueKey(b))),
  });
}