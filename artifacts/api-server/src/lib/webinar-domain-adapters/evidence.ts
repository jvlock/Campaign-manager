import type { EvidenceValidationContext, ManualEvidence } from "../webinar-standard-evidence/types";
import { validateManualEvidence } from "../webinar-standard-evidence";
import type { WebinarException } from "../webinar-standard-exceptions/types";
import { validateWebinarException } from "../webinar-standard-exceptions";
import type { WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import type { AdapterResult } from "./types";
import { immutable, issue } from "./common";

/** References remain references; no source document content or identity is manufactured. */
export function adaptEvidence(source: ManualEvidence, context: EvidenceValidationContext): AdapterResult<ManualEvidence> {
  const result = validateManualEvidence(source, context);
  return immutable(result.ok ? { value: result.evidence, mappingErrors: [] } : {
    value: null, mappingErrors: result.issues.map(error => issue(error.field, error.message, error.code)),
  });
}
/** Documentary, unverified simulated exception only. Resolution remains canonical engine work. */
export function adaptException(source: WebinarException, catalog: WebinarStandardCatalog, evaluationTimeEpochMs: number, targetRuleId: WebinarException["ruleId"]): AdapterResult<WebinarException> {
  const result = validateWebinarException(source, catalog, evaluationTimeEpochMs, targetRuleId);
  return immutable(result.ok ? { value: result.exception, mappingErrors: [] } : {
    value: null, mappingErrors: result.issues.map(error => issue(error.field, error.message, error.code)),
  });
}