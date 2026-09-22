import type { RuleId, StandardId, StandardVersion } from "../webinar-standard-catalog/types";

/** Documentary exception data only; reviewer names do not establish authorization. */
export interface WebinarException {
  readonly exceptionId: string;
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly ruleId: RuleId;
  readonly requirementOverridden: string;
  readonly businessJustification: string;
  readonly requestor: string;
  readonly reviewer: string;
  readonly reviewerVerificationStatus: "unverified" | "not_recorded";
  readonly decision: "approved" | "pending" | "rejected" | "returned" | "expired" | "revoked";
  readonly decisionAtEpochMs: number;
  readonly expiresAtEpochMs: number | null;
  readonly expirationRequired: boolean;
  readonly compensatingAction: string | null;
  readonly compensatingActionRequired: boolean;
  readonly createdAtEpochMs: number;
  readonly pilotAudit: {
    readonly pilotReference: string;
    readonly auditReference: string;
  };
}

export interface ExceptionValidationIssue {
  readonly code: string;
  readonly field: string;
  readonly message: string;
}

export type ExceptionValidationResult =
  | { readonly ok: true; readonly exception: WebinarException }
  | { readonly ok: false; readonly issues: readonly ExceptionValidationIssue[] };