import type { RuleId, WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { validateWebinarStandardCatalog } from "../webinar-standard-catalog/validate";
import type { ExceptionValidationIssue, ExceptionValidationResult, WebinarException } from "./types";

const FIELDS = [
  "exceptionId", "standardId", "standardVersion", "ruleId", "requirementOverridden",
  "businessJustification", "requestor", "reviewer", "reviewerVerificationStatus",
  "decision", "decisionAtEpochMs", "expiresAtEpochMs", "expirationRequired",
  "compensatingAction", "compensatingActionRequired", "createdAtEpochMs", "pilotAudit",
] as const;
const AUDIT_FIELDS = ["pilotReference", "auditReference"] as const;
const PLACEHOLDER = /\b(?:TBD|TODO|TBC|placeholder|lorem\s+ipsum)\b|^\s*(?:N\/?A|none|null|undefined|unknown|not\s+(?:specified|recorded|applicable))\s*$/i;
const own = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
// Epoch milliseconds are whole, nonnegative, representable JavaScript date values.
const timestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;

/**
 * Pure documentary validation, not identity verification or an authorization grant.
 * Catalog provenance remains the caller's responsibility (the loader is deliberately
 * absent from this dependency graph). No clock is read and no caller data is frozen.
 */
export function validateWebinarException(
  input: unknown,
  catalog: WebinarStandardCatalog,
  evaluationTimeEpochMs: number,
  targetRuleId: RuleId,
): ExceptionValidationResult {
  const issues: ExceptionValidationIssue[] = [];
  const issue = (code: string, field: string, message: string): void => {
    issues.push(Object.freeze({ code, field, message }));
  };
  const failure = (): ExceptionValidationResult =>
    Object.freeze({ ok: false as const, issues: Object.freeze(issues) });

  // Only two object levels are permitted. No recursive traversal of untrusted
  // values is needed, so cycles fail schema validation without recursion.
  function record(value: unknown, fields: readonly string[], path: string): Record<string, unknown> | undefined {
    let descriptors: PropertyDescriptorMap;
    try {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        issue("invalid_type", path || "$", "Expected a plain data object.");
        return undefined;
      }
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        issue("invalid_type", path || "$", "Exotic objects are not accepted.");
        return undefined;
      }
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      issue("invalid_type", path || "$", "Object properties cannot be safely inspected.");
      return undefined;
    }
    const at = (key: string): string => path ? `${path}.${key}` : key;
    // Sort unknown keys, but never reflect attacker-controlled key text in issues.
    for (const key of Object.keys(descriptors).sort()) {
      if (!fields.includes(key)) issue("unknown_field", at("[unknown]"), "Property is not part of the exception schema.");
    }
    for (const _key of Object.getOwnPropertySymbols(descriptors)) {
      issue("unknown_field", at("[symbol]"), "Symbol properties are not accepted.");
    }
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(descriptors, field)?.value as PropertyDescriptor | undefined;
      if (!descriptor) {
        issue("missing_field", at(field), "Required property is missing.");
      } else if (!own(descriptor, "value")) {
        issue("invalid_type", at(field), "Accessor properties are not accepted; getters are not executed.");
      } else {
        copy[field] = descriptor.value as unknown;
      }
    }
    return copy;
  }

  function text(value: unknown, field: string, minimum = 1): void {
    if (typeof value !== "string") {
      issue("invalid_type", field, "Expected nonblank text.");
    } else if (value.trim().length < minimum) {
      issue("invalid_value", field, minimum === 1 ? "Text must not be blank." : "Justification must contain at least twenty trimmed characters.");
    } else if (PLACEHOLDER.test(value)) {
      issue("placeholder", field, "Placeholder text is not accepted.");
    }
  }

  const checkedCatalog = validateWebinarStandardCatalog(catalog);
  if (!checkedCatalog.ok) issue("invalid_catalog", "catalog", "A structurally valid webinar standard catalog is required.");
  if (!timestamp(evaluationTimeEpochMs)) issue("invalid_time", "evaluationTimeEpochMs", "Evaluation time must be valid epoch milliseconds.");
  const rule = checkedCatalog.ok
    ? checkedCatalog.catalog.rules.find((entry) => entry.ruleId === targetRuleId)
    : undefined;
  if (checkedCatalog.ok && !rule) issue("unknown_rule", "targetRuleId", "Target rule must exist in the supplied catalog.");
  if (targetRuleId === "WEB-EXC-001") {
    issue("self_exception", "targetRuleId", "The exception governance rule cannot exempt itself.");
  } else if (rule && !rule.exceptionEligible) {
    issue("not_exception_eligible", "targetRuleId", "The target rule does not permit exceptions.");
  }

  const root = record(input, FIELDS, "");
  if (!root) return failure();
  for (const field of ["exceptionId", "requirementOverridden", "requestor", "reviewer"] as const) {
    if (own(root, field)) text(root[field], field);
  }
  if (own(root, "businessJustification")) text(root.businessJustification, "businessJustification", 20);
  if (checkedCatalog.ok) {
    for (const field of ["standardId", "standardVersion"] as const) {
      if (own(root, field) && root[field] !== checkedCatalog.catalog[field]) {
        issue("standard_mismatch", field, "Exception must match the supplied catalog identity exactly.");
      }
    }
  }
  if (own(root, "ruleId") && root.ruleId !== targetRuleId) issue("rule_mismatch", "ruleId", "Exception must reference the target rule exactly.");
  if (root.ruleId === "WEB-EXC-001" && targetRuleId !== "WEB-EXC-001") {
    issue("self_exception", "ruleId", "The exception governance rule cannot exempt itself.");
  }
  if (rule && own(root, "requirementOverridden") && root.requirementOverridden !== rule.expectedBehavior) {
    issue("requirement_mismatch", "requirementOverridden", "The overridden requirement must equal the target rule's canonical expected behavior.");
  }
  if (own(root, "reviewerVerificationStatus") && root.reviewerVerificationStatus !== "unverified") {
    issue("reviewer_unverified_required", "reviewerVerificationStatus", "Reviewer verification status must explicitly be unverified; this record does not verify identity.");
  }
  if (own(root, "decision") && root.decision !== "approved") {
    issue("not_approved", "decision", "Only an approved decision can be currently effective.");
  }
  for (const field of ["expirationRequired", "compensatingActionRequired"] as const) {
    if (own(root, field) && typeof root[field] !== "boolean") issue("invalid_type", field, "Expected a boolean without coercion.");
  }
  for (const field of ["createdAtEpochMs", "decisionAtEpochMs", "expiresAtEpochMs"] as const) {
    if (own(root, field) && !(field === "expiresAtEpochMs" && root[field] === null) && !timestamp(root[field])) {
      issue("invalid_time", field, "Expected valid whole nonnegative epoch milliseconds.");
    }
  }
  const created = root.createdAtEpochMs;
  const decision = root.decisionAtEpochMs;
  const expiry = root.expiresAtEpochMs;
  if (timestamp(created) && timestamp(decision) && created > decision) issue("invalid_lifecycle", "createdAtEpochMs", "Creation must not follow the decision.");
  if (timestamp(decision) && timestamp(evaluationTimeEpochMs) && decision > evaluationTimeEpochMs) issue("not_effective", "decisionAtEpochMs", "The decision must not be in the future.");
  if (timestamp(expiry) && timestamp(decision) && expiry <= decision) issue("invalid_lifecycle", "expiresAtEpochMs", "Expiration must be strictly after the decision.");
  if (timestamp(expiry) && timestamp(evaluationTimeEpochMs) && evaluationTimeEpochMs >= expiry) issue("expired", "expiresAtEpochMs", "The exception has reached its expiration boundary.");
  if (root.expirationRequired === true && (expiry === null || !own(root, "expiresAtEpochMs"))) issue("expiration_required", "expiresAtEpochMs", "An expiration is required for this exception.");
  if (own(root, "compensatingAction") && root.compensatingAction !== null) text(root.compensatingAction, "compensatingAction");
  if (root.compensatingActionRequired === true && (root.compensatingAction === null || !own(root, "compensatingAction"))) issue("compensating_action_required", "compensatingAction", "A compensating action is required for this exception.");
  const audit = own(root, "pilotAudit") ? record(root.pilotAudit, AUDIT_FIELDS, "pilotAudit") : undefined;
  if (audit) {
    for (const field of AUDIT_FIELDS) if (own(audit, field)) text(audit[field], `pilotAudit.${field}`);
  }
  if (issues.length > 0) return failure();
  // The only remaining nested values are validated text, copied into a fresh object.
  const exception = Object.freeze({
    ...root,
    pilotAudit: Object.freeze({ ...audit }),
  }) as unknown as WebinarException;
  return Object.freeze({ ok: true as const, exception });
}