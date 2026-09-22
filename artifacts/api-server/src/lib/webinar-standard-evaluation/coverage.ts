import type { RuleId } from "../webinar-standard-catalog/types";
import type { PartialEvaluatorRegistry } from "./types";

export type SemanticCheckId =
  | "registrationSuppressesFutureRecruitment"
  | "internalTestExcludedFromCustomerPathsAndReporting"
  | "noCommunicationScheduledInPast"
  | "eventStatusAndParticipantStatusSeparate"
  | "attendancePerRegistrant"
  | "attendedAbsentDistinctVariants"
  | "attendanceUnknownCannotGenerateBothVariants"
  | "sharedFollowUpAssetsPermitted"
  | "registrationTestingNonOverridable"
  | "joinLinkVenueTestingNonOverridable"
  | "requiredConsentControlsNonOverridable"
  | "governedNamingTaxonomyUtmNonBypassable"
  | "noRuleAuthorizesExternalSend"
  | "noRuleAuthorizesDeployment";

export type SemanticControl =
  | { readonly check: SemanticCheckId; readonly classification: "evaluator_backed"; readonly ruleIds: readonly RuleId[] }
  | { readonly check: SemanticCheckId; readonly classification: "structurally_enforced" | "containment_verified"; readonly ruleIds?: never };

const controls: readonly SemanticControl[] = [
  { check: "registrationSuppressesFutureRecruitment", classification: "evaluator_backed", ruleIds: ["WEB-REC-005"] },
  { check: "internalTestExcludedFromCustomerPathsAndReporting", classification: "evaluator_backed", ruleIds: ["WEB-REC-008", "WEB-FU-INT-001"] },
  { check: "noCommunicationScheduledInPast", classification: "evaluator_backed", ruleIds: ["WEB-REC-011", "WEB-WIN-006"] },
  { check: "eventStatusAndParticipantStatusSeparate", classification: "structurally_enforced" },
  { check: "attendancePerRegistrant", classification: "structurally_enforced" },
  { check: "attendedAbsentDistinctVariants", classification: "evaluator_backed", ruleIds: ["WEB-FU-VAR-001"] },
  { check: "attendanceUnknownCannotGenerateBothVariants", classification: "evaluator_backed", ruleIds: ["WEB-FU-UNK-002"] },
  { check: "sharedFollowUpAssetsPermitted", classification: "evaluator_backed", ruleIds: ["WEB-FU-VAR-001"] },
  { check: "registrationTestingNonOverridable", classification: "evaluator_backed", ruleIds: ["WEB-QA-003", "WEB-RDY-REC-002"] },
  { check: "joinLinkVenueTestingNonOverridable", classification: "evaluator_backed", ruleIds: ["WEB-QA-004", "WEB-RDY-RUN-001"] },
  { check: "requiredConsentControlsNonOverridable", classification: "evaluator_backed", ruleIds: ["WEB-SETUP-C07"] },
  { check: "governedNamingTaxonomyUtmNonBypassable", classification: "evaluator_backed", ruleIds: ["WEB-QA-005", "WEB-QA-006", "WEB-RDY-REC-008"] },
  { check: "noRuleAuthorizesExternalSend", classification: "containment_verified" },
  { check: "noRuleAuthorizesDeployment", classification: "containment_verified" },
];

export const SEMANTIC_CONTROLS: readonly SemanticControl[] = Object.freeze(controls.map((control) =>
  control.classification === "evaluator_backed"
    ? Object.freeze({ ...control, ruleIds: Object.freeze([...control.ruleIds]) })
    : Object.freeze({ ...control }),
));

/** Implementation inventory only; this never evaluates or calculates event readiness. */
export function describeCoverage(registry: PartialEvaluatorRegistry) {
  const implemented = new Set(registry.implementedRuleIds);
  const evaluatorBacked = SEMANTIC_CONTROLS.filter((control) =>
    control.classification === "evaluator_backed" && control.ruleIds.every((id) => implemented.has(id)),
  ).length;
  const structurallyEnforced = SEMANTIC_CONTROLS.filter((control) => control.classification === "structurally_enforced").length;
  const containmentVerified = SEMANTIC_CONTROLS.filter((control) => control.classification === "containment_verified").length;
  return Object.freeze({
    ruleEngineCoverage: "partial" as const,
    semanticChecksTotal: SEMANTIC_CONTROLS.length,
    semanticChecksAddressed: evaluatorBacked + structurallyEnforced + containmentVerified,
    evaluatorBacked,
    structurallyEnforced,
    containmentVerified,
    implementedRuleCount: registry.implementedRuleIds.length,
    unimplementedRuleCount: registry.unimplementedRuleIds.length,
    totalRuleCount: registry.implementedRuleIds.length + registry.unimplementedRuleIds.length,
    implementedRuleIds: Object.freeze([...registry.implementedRuleIds]),
    unimplementedRuleIds: Object.freeze([...registry.unimplementedRuleIds]),
    controls: SEMANTIC_CONTROLS,
  });
}