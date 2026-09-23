import type { RuleId, WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { validateWebinarStandardCatalog } from "../webinar-standard-catalog/validate";
import { EVALUATORS, IMPLEMENTED_RULE_IDS } from "./evaluators";
import { createSetupEvaluators } from "./setup-evaluators";
import type {
  EvaluationContext, EvaluatorRegistryEntry, PartialEvaluatorRegistry,
  RuleEvaluationResult, RuleEvaluator,
} from "./types";

/** Pure catalog validation creates a defensive, deeply frozen metadata snapshot. */
export function createWebinarEvaluatorRegistry(catalog: WebinarStandardCatalog): PartialEvaluatorRegistry {
  const validation = validateWebinarStandardCatalog(catalog);
  if (!validation.ok) {
    throw new Error(`Invalid webinar standard catalog: ${validation.issues
      .map((issue) => `${issue.field}: ${issue.message}`).join("; ")}`);
  }
  const snapshot = validation.catalog;
  const boundEvaluators = Object.freeze({ ...EVALUATORS, ...createSetupEvaluators(snapshot) });
  const implemented = new Set<RuleId>(IMPLEMENTED_RULE_IDS);
  if (implemented.size !== 38 || Object.keys(boundEvaluators).length !== implemented.size) {
    throw new Error("Invalid webinar evaluator registry: duplicate or missing implementations.");
  }
  const catalogIds = new Set(snapshot.rules.map((rule) => rule.ruleId));
  for (const id of IMPLEMENTED_RULE_IDS) {
    if (!catalogIds.has(id) || typeof boundEvaluators[id] !== "function") {
      throw new Error(`Invalid webinar evaluator registry: missing rule or evaluator ${id}.`);
    }
  }
  const unimplementedRuleIds = Object.freeze(snapshot.rules
    .filter((rule) => !implemented.has(rule.ruleId)).map((rule) => rule.ruleId));
  if (unimplementedRuleIds.length !== 68) {
    throw new Error("Invalid webinar evaluator registry: expected exactly 68 unimplemented rules.");
  }
  const evaluators: Partial<Record<RuleId, RuleEvaluator>> = boundEvaluators;
  const results = new Map<RuleId, (context: EvaluationContext) => RuleEvaluationResult>();
  const entries: EvaluatorRegistryEntry[] = [];
  for (const rule of snapshot.rules) {
    const evaluator = evaluators[rule.ruleId];
    const evaluate = (context: EvaluationContext): RuleEvaluationResult => {
      const finding = evaluator ? evaluator(context) : {
        status: "unimplemented" as const,
        reason: "not_implemented" as const,
        evidence: [`${rule.ruleId}: no evaluator is implemented; no policy conclusion is made.`],
      };
      return Object.freeze({
        mode: "descriptive_only" as const,
        standardId: snapshot.standardId,
        standardVersion: snapshot.standardVersion,
        ruleId: rule.ruleId,
        rule,
        status: finding.status,
        reason: finding.reason,
        participantId: context.participant?.participantId ?? null,
        evidence: Object.freeze([...finding.evidence]),
      });
    };
    results.set(rule.ruleId, evaluate);
    if (evaluator) entries.push(Object.freeze({ ruleId: rule.ruleId, rule, evaluate }));
  }
  return Object.freeze({
    implementedRuleIds: IMPLEMENTED_RULE_IDS,
    unimplementedRuleIds,
    entries: Object.freeze(entries),
    evaluate: (ruleId: RuleId, context: EvaluationContext): RuleEvaluationResult => {
      const evaluate = results.get(ruleId);
      if (!evaluate) throw new Error(`Unknown webinar standard rule ID: ${String(ruleId)}`);
      return evaluate(context);
    },
  });
}