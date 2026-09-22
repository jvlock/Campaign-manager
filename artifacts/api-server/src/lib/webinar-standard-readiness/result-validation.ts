import type {
  ReadinessStage, RuleId, WebinarStandardCatalog, WebinarStandardRule,
} from "../webinar-standard-catalog/types";
import type { RuleEvaluationResult } from "../webinar-standard-evaluation/types";
import type { ReadinessIssue } from "./types";

const RESULT_FIELDS = Object.freeze([
  "mode", "standardId", "standardVersion", "ruleId", "rule", "status",
  "reason", "participantId", "evidence",
] as const);

const REASONS_BY_STATUS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  pass: Object.freeze(["satisfied"]),
  fail: Object.freeze(["violation", "missing_evidence", "invalid_context"]),
  not_applicable: Object.freeze(["condition_not_met"]),
  unimplemented: Object.freeze(["not_implemented"]),
});

const own = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function frozenIssue(
  code: string,
  ruleId: string | null,
  stage: ReadinessStage | null,
  message: string,
): ReadinessIssue {
  return Object.freeze({ code, ruleId, stage, message });
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return Object.getOwnPropertySymbols(value).length === 0
    && keys.length === expected.length
    && keys.every((key) => expected.includes(key));
}

function isDenseStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!own(value, index) || typeof value[index] !== "string") return false;
  }
  return true;
}

function matchesCanonicalRule(
  value: unknown,
  canonical: WebinarStandardRule,
): boolean {
  if (!isRecord(value)) return false;
  const fields = Object.keys(canonical).sort();
  if (!sameKeys(value, fields)) return false;
  return fields.every((field) => own(value, field)
    && value[field] === canonical[field as keyof WebinarStandardRule]);
}

function canonicalResult(
  value: Record<string, unknown>,
  rule: WebinarStandardRule,
  catalog: WebinarStandardCatalog,
): RuleEvaluationResult {
  const ruleSnapshot = Object.freeze({
    ruleId: rule.ruleId,
    ruleName: rule.ruleName,
    hierarchyLevel: rule.hierarchyLevel,
    trigger: rule.trigger,
    expectedBehavior: rule.expectedBehavior,
    primaryRuleType: rule.primaryRuleType,
    evidenceBasis: rule.evidenceBasis,
    readinessStage: rule.readinessStage,
    validationMethod: rule.validationMethod,
    exceptionEligible: rule.exceptionEligible,
    exceptionEligibleNote: rule.exceptionEligibleNote,
    failureMessage: rule.failureMessage,
    resolutionGuidance: rule.resolutionGuidance,
  });
  return Object.freeze({
    mode: "descriptive_only",
    standardId: catalog.standardId,
    standardVersion: catalog.standardVersion,
    ruleId: rule.ruleId,
    rule: ruleSnapshot,
    status: value.status,
    reason: value.reason,
    participantId: value.participantId,
    evidence: Object.freeze([...(value.evidence as string[])]),
  }) as RuleEvaluationResult;
}

function serializedResult(value: RuleEvaluationResult): string {
  return JSON.stringify({
    evidence: value.evidence,
    mode: value.mode,
    participantId: value.participantId,
    reason: value.reason,
    rule: {
      evidenceBasis: value.rule.evidenceBasis,
      exceptionEligible: value.rule.exceptionEligible,
      exceptionEligibleNote: value.rule.exceptionEligibleNote,
      expectedBehavior: value.rule.expectedBehavior,
      failureMessage: value.rule.failureMessage,
      hierarchyLevel: value.rule.hierarchyLevel,
      primaryRuleType: value.rule.primaryRuleType,
      readinessStage: value.rule.readinessStage,
      resolutionGuidance: value.rule.resolutionGuidance,
      ruleId: value.rule.ruleId,
      ruleName: value.rule.ruleName,
      trigger: value.rule.trigger,
      validationMethod: value.rule.validationMethod,
    },
    ruleId: value.ruleId,
    standardId: value.standardId,
    standardVersion: value.standardVersion,
    status: value.status,
  });
}

/**
 * Internal readiness boundary. Callers snapshot untrusted input to safe plain data
 * before invoking this pure validator; this function still only returns fresh,
 * deeply frozen result records and never mutates either argument.
 */
export function validateIncomingResults(
  input: unknown,
  catalog: WebinarStandardCatalog,
): {
  readonly results: readonly RuleEvaluationResult[];
  readonly duplicateRuleIds: readonly RuleId[];
  readonly issues: readonly ReadinessIssue[];
} {
  const issues: ReadinessIssue[] = [];
  const results: RuleEvaluationResult[] = [];
  const ruleById = new Map<string, WebinarStandardRule>(
    catalog.rules.map((rule) => [rule.ruleId, rule]),
  );

  if (!Array.isArray(input)) {
    issues.push(frozenIssue(
      "invalid_results", null, null, "Evaluation results must be an array.",
    ));
    return Object.freeze({
      results: Object.freeze(results),
      duplicateRuleIds: Object.freeze([] as RuleId[]),
      issues: Object.freeze(issues),
    });
  }

  // Count recognizable catalog IDs before schema validation. Consequently even
  // malformed records participate in duplicate coverage diagnostics.
  const counts = new Map<RuleId, number>();
  for (const entry of input) {
    if (!isRecord(entry) || typeof entry.ruleId !== "string") continue;
    const rule = ruleById.get(entry.ruleId);
    if (rule) counts.set(rule.ruleId, (counts.get(rule.ruleId) ?? 0) + 1);
  }
  const duplicateRuleIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([ruleId]) => ruleId)
    .sort();
  for (const ruleId of duplicateRuleIds) {
    const rule = ruleById.get(ruleId)!;
    issues.push(frozenIssue(
      "duplicate_result", ruleId, rule.readinessStage,
      "More than one evaluation result references this rule.",
    ));
  }

  for (const entry of input) {
    if (!isRecord(entry)) {
      issues.push(frozenIssue(
        "invalid_result", null, null, "Each evaluation result must be a plain data object.",
      ));
      continue;
    }
    const suppliedId = typeof entry.ruleId === "string" ? entry.ruleId : null;
    const rule = suppliedId === null ? undefined : ruleById.get(suppliedId);
    if (!rule) {
      issues.push(frozenIssue(
        suppliedId === null ? "invalid_result" : "unknown_rule",
        suppliedId, null,
        suppliedId === null
          ? "Evaluation result must contain a string ruleId."
          : "Evaluation result references a ruleId absent from the supplied catalog.",
      ));
      continue;
    }

    let valid = true;
    const invalid = (message: string): void => {
      valid = false;
      issues.push(frozenIssue("invalid_result", rule.ruleId, rule.readinessStage, message));
    };
    if (!sameKeys(entry, RESULT_FIELDS)) {
      invalid("Evaluation result must contain exactly the allowed result properties.");
    }
    if (entry.mode !== "descriptive_only") invalid("Result mode must be descriptive_only.");
    if (entry.standardId !== catalog.standardId) invalid("Result standardId must match the catalog.");
    if (entry.standardVersion !== catalog.standardVersion) invalid("Result standardVersion must match the catalog.");
    if (!matchesCanonicalRule(entry.rule, rule)) {
      invalid("Embedded rule metadata must exactly match the complete canonical catalog rule.");
    }
    const reasons = typeof entry.status === "string" ? REASONS_BY_STATUS[entry.status] : undefined;
    if (!reasons) {
      invalid("Result status must be a closed evaluation status.");
    } else if (typeof entry.reason !== "string" || !reasons.includes(entry.reason)) {
      invalid("Result reason must be coherent with its status.");
    }
    if (entry.participantId !== null && typeof entry.participantId !== "string") {
      invalid("Result participantId must be a string or null.");
    }
    if (!isDenseStringArray(entry.evidence)) {
      invalid("Result evidence must be a dense array of strings.");
    }
    if (valid) results.push(canonicalResult(entry, rule, catalog));
  }

  const compare = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  results.sort((left, right) => compare(serializedResult(left), serializedResult(right)));
  issues.sort((left, right) =>
    compare(left.code, right.code)
    || compare(left.stage ?? "", right.stage ?? "")
    || compare(left.ruleId ?? "", right.ruleId ?? "")
    || compare(left.message, right.message));

  return Object.freeze({
    results: Object.freeze(results),
    duplicateRuleIds: Object.freeze(duplicateRuleIds),
    issues: Object.freeze(issues),
  });
}