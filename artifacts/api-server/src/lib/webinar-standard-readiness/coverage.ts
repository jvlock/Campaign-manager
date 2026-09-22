import type { RuleId, WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import type { PartialEvaluatorRegistry } from "../webinar-standard-evaluation/types";
import type { ReadinessReport } from "./types";

/** Compute implementation coverage from registry entries, checking the published partition. */
export function registryCoverage(
  catalog: WebinarStandardCatalog, registry: PartialEvaluatorRegistry,
): ReadinessReport["coverage"] {
  const canonical = new Map(catalog.rules.map((rule) => [rule.ruleId, rule]));
  const implemented = registry.entries.map((entry) => {
    const rule = canonical.get(entry.ruleId);
    if (!rule || typeof entry.evaluate !== "function" || Object.keys(entry.rule).length !== Object.keys(rule).length
      || Object.entries(rule).some(([key, value]) => entry.rule[key as keyof typeof rule] !== value)) {
      throw new Error("Registry entry does not match the validated catalog.");
    }
    return entry.ruleId;
  }).sort();
  const unique = new Set<RuleId>(implemented);
  const missing = catalog.rules.map((rule) => rule.ruleId).filter((id) => !unique.has(id)).sort();
  if (unique.size !== implemented.length
    || JSON.stringify([...registry.implementedRuleIds].sort()) !== JSON.stringify(implemented)
    || JSON.stringify([...registry.unimplementedRuleIds].sort()) !== JSON.stringify(missing)) {
    throw new Error("Registry implementation inventory is inconsistent.");
  }
  return {
    totalRuleCount: catalog.rules.length,
    implementedRuleCount: implemented.length,
    missingEvaluatorCount: missing.length,
    implementedRuleIds: implemented,
    missingEvaluatorRuleIds: missing,
  };
}