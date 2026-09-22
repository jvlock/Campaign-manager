import type { RuleId } from "./rule-ids";

export { RULE_IDS } from "./rule-ids";
export type { RuleId } from "./rule-ids";

export const STANDARD_ID = "WEB-STANDARD-001" as const;
export const STANDARD_VERSION = "1.0-pilot-rc1" as const;
export const RULE_COUNT = 106 as const;

export const REQUIRED_RULE_FIELDS = Object.freeze([
  "ruleId", "ruleName", "hierarchyLevel", "trigger", "expectedBehavior",
  "primaryRuleType", "evidenceBasis", "readinessStage", "validationMethod",
  "exceptionEligible", "failureMessage", "resolutionGuidance",
] as const);
export const HIERARCHY_LEVELS = Object.freeze([
  "Activity", "Communication", "Activity/Communication",
] as const);
export const PRIMARY_RULE_TYPES = Object.freeze([
  "Mandatory blocker", "Conditional blocker", "Optional", "Warning", "Recommended default",
] as const);
export const EVIDENCE_BASES = Object.freeze([
  "Product-owner direction", "Recommendation",
] as const);
export const READINESS_STAGES = Object.freeze([
  "Ready to recruit", "Ready to run", "Ready to follow up", "Complete",
] as const);
export const VALIDATION_METHODS = Object.freeze([
  "Automated", "Human confirmation",
] as const);

export type StandardId = typeof STANDARD_ID;
export type StandardVersion = typeof STANDARD_VERSION;
export type RequiredRuleField = (typeof REQUIRED_RULE_FIELDS)[number];
export type HierarchyLevel = (typeof HIERARCHY_LEVELS)[number];
export type PrimaryRuleType = (typeof PRIMARY_RULE_TYPES)[number];
export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];
export type ReadinessStage = (typeof READINESS_STAGES)[number];
export type ValidationMethod = (typeof VALIDATION_METHODS)[number];

// These are literal catalog prose, not expressions, inferred policy, or enums.
// The runtime validator requires non-empty, non-placeholder text.
export type RuleName = string;
export type Trigger = string;
export type ExpectedBehavior = string;
export type FailureMessage = string;
export type ResolutionGuidance = string;
export type ExceptionEligible = boolean;
export type ExceptionEligibleNote = string | null;
export type CatalogGeneratedAt = string;
export type CatalogNote = string;

export interface CatalogIdentity {
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
}

export interface WebinarStandardRule {
  readonly ruleId: RuleId;
  readonly ruleName: RuleName;
  readonly hierarchyLevel: HierarchyLevel;
  readonly trigger: Trigger;
  readonly expectedBehavior: ExpectedBehavior;
  readonly primaryRuleType: PrimaryRuleType;
  readonly evidenceBasis: EvidenceBasis;
  readonly readinessStage: ReadinessStage;
  readonly validationMethod: ValidationMethod;
  readonly exceptionEligible: ExceptionEligible;
  readonly exceptionEligibleNote: ExceptionEligibleNote;
  readonly failureMessage: FailureMessage;
  readonly resolutionGuidance: ResolutionGuidance;
}

export interface WebinarStandardCatalog extends CatalogIdentity {
  readonly generatedAt: CatalogGeneratedAt;
  readonly ruleCount: typeof RULE_COUNT;
  readonly requiredFields: readonly RequiredRuleField[];
  readonly note: CatalogNote;
  readonly rules: readonly WebinarStandardRule[];
}

export type CatalogIssueCode =
  | "invalid_type" | "missing_field" | "unknown_field" | "invalid_value"
  | "invalid_enum" | "invalid_rule_id" | "duplicate_rule_id"
  | "invalid_rule_count" | "placeholder" | "manifest_mismatch"
  | "hash_mismatch" | "read_error" | "invalid_json";

export interface CatalogValidationIssue {
  readonly code: CatalogIssueCode;
  readonly field: string;
  readonly message: string;
  readonly valueSummary: string;
  readonly location: readonly (string | number)[];
  readonly ruleId?: string;
  readonly ruleIndex?: number;
}

export type CatalogValidationResult =
  | { readonly ok: true; readonly catalog: WebinarStandardCatalog }
  | { readonly ok: false; readonly issues: readonly CatalogValidationIssue[] };