import type { PrimaryRuleType, RuleId, WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import type { RuleEvaluationResult } from "../webinar-standard-evaluation/types";
import { validateWebinarException } from "../webinar-standard-exceptions/validate";
import type { ExceptionResolvedBlocker, ReadinessIssue } from "./types";
import { compareText, isRecord } from "./safe-data";

function assertNever(value: never): never {
  throw new Error("Unknown primary rule type.");
}

/** Severity alone determines blocking; applicability is represented by result status. */
export function isBlockingType(type: PrimaryRuleType): boolean {
  switch (type) {
    case "Mandatory blocker":
    case "Conditional blocker":
      return true;
    case "Warning":
    case "Recommended default":
    case "Optional":
      return false;
  }
  return assertNever(type);
}

export function isBlockingFailure(result: RuleEvaluationResult): boolean {
  return isBlockingType(result.rule.primaryRuleType) && result.status === "fail";
}

/** Internal helper; receives the owned data-only snapshot from the public boundary. */
export function resolveClaims(
  rawClaims: unknown, rawExceptions: unknown, catalog: WebinarStandardCatalog,
  results: readonly RuleEvaluationResult[], duplicateRuleIds: readonly RuleId[],
  evaluationTime: number | null,
): { resolutions: readonly ExceptionResolvedBlocker[]; issues: readonly ReadinessIssue[] } {
  const rules = new Map(catalog.rules.map((rule) => [rule.ruleId as string, rule]));
  const issues: ReadinessIssue[] = [];
  const resolutions: ExceptionResolvedBlocker[] = [];
  const issue = (code: string, ruleId: string | null, message: string) => {
    issues.push({ code, ruleId, stage: ruleId === null ? null : rules.get(ruleId)?.readinessStage ?? null, message });
  };
  const claims: { ruleId: string; exceptionId: string }[] = [];
  if (!Array.isArray(rawClaims)) issue("invalid_exception_claims", null, "Exception claims must be an array.");
  else for (const item of rawClaims) {
    if (!isRecord(item) || Object.keys(item).sort().join(",") !== "exceptionId,ruleId"
      || typeof item.ruleId !== "string" || typeof item.exceptionId !== "string" || !item.exceptionId.trim()) {
      issue("invalid_exception_claim", isRecord(item) && typeof item.ruleId === "string" ? item.ruleId : null,
        "Each claim requires exactly one rule ID and one nonempty exception ID.");
    } else {
      // Nonblocking rules need no exception. Their claims cannot affect readiness
      // or consume an exception link belonging to a genuine blocker.
      const rule = rules.get(item.ruleId);
      if (rule && !isBlockingType(rule.primaryRuleType)) continue;
      claims.push({ ruleId: item.ruleId, exceptionId: item.exceptionId });
    }
  }
  const exceptions = new Map<string, unknown[]>();
  if (!Array.isArray(rawExceptions)) issue("invalid_exceptions", null, "Exception records must be an array.");
  else for (const item of rawExceptions) {
    if (!isRecord(item) || typeof item.exceptionId !== "string" || !item.exceptionId.trim()) {
      issue("invalid_exception_record", null, "Exception record identity is missing.");
    } else exceptions.set(item.exceptionId, [...(exceptions.get(item.exceptionId) ?? []), item]);
  }
  const byRule = new Map<string, number>();
  const byException = new Map<string, number>();
  for (const claim of claims) {
    byRule.set(claim.ruleId, (byRule.get(claim.ruleId) ?? 0) + 1);
    byException.set(claim.exceptionId, (byException.get(claim.exceptionId) ?? 0) + 1);
  }
  for (const claim of claims.sort((a, b) => compareText(a.ruleId, b.ruleId) || compareText(a.exceptionId, b.exceptionId))) {
    const rule = rules.get(claim.ruleId);
    if (!rule) {
      issue("unknown_exception_rule", claim.ruleId, "Claim references an unknown rule.");
      continue;
    }
    if (byRule.get(claim.ruleId) !== 1 || byException.get(claim.exceptionId) !== 1) {
      issue("ambiguous_exception_claim", rule.ruleId, "A resolution must link one exception to one rule failure exactly once.");
      continue;
    }
    const findings = results.filter((result) => result.ruleId === rule.ruleId);
    if (findings.length !== 1 || duplicateRuleIds.includes(rule.ruleId) || !isBlockingFailure(findings[0]!)) {
      issue("invalid_exception_target", rule.ruleId, "Claim must reference a single valid failed blocker result.");
      continue;
    }
    const records = exceptions.get(claim.exceptionId) ?? [];
    if (records.length !== 1) {
      issue("missing_or_duplicate_exception", rule.ruleId, "Claim must reference exactly one supplied exception record.");
      continue;
    }
    if (evaluationTime === null) {
      issue("invalid_exception_time", rule.ruleId, "A valid observation time is required to establish exception effectiveness.");
      continue;
    }
    const validation = validateWebinarException(records[0], catalog, evaluationTime, rule.ruleId);
    if (!validation.ok) {
      for (const problem of validation.issues) {
        issue("invalid_exception", rule.ruleId, `${problem.field}: ${problem.message}`);
      }
      continue;
    }
    resolutions.push({
      ruleId: rule.ruleId, classification: "resolvedByException",
      originalFailure: findings[0]!, exception: validation.exception,
    });
  }
  return { resolutions, issues };
}