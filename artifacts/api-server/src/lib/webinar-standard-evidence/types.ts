import type { RuleId, StandardId, StandardVersion, WebinarStandardCatalog } from "../webinar-standard-catalog/types";

/** Exact sets, not wildcards. The caller supplies authoritative ownership/inventory. */
export interface EvidenceScope {
  readonly eventId: string;
  readonly sessionIds: readonly string[];
  readonly participantIds: readonly string[];
  readonly communicationIds: readonly string[];
  readonly deliverableIds: readonly string[];
}

export interface EvidenceBinding {
  readonly inputSnapshotVersion: string;
  readonly artifactVersion: string | null;
  readonly reviewedAtEpochMs: number;
  readonly snapshotCompleteness: "complete" | "partial" | "unknown";
  readonly observationFromEpochMs: number | null;
  readonly observationThroughEpochMs: number | null;
}

export interface ManualEvidence {
  readonly evidenceId: string;
  readonly ruleId: RuleId;
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly evidenceStatus: "confirmed" | "rejected" | "incomplete" | "unavailable";
  readonly evidenceDescription: string;
  readonly suppliedBy: Readonly<{ nameOrPilotIdentifier: string; identityVerified: false }>;
  readonly suppliedAtEpochMs: number;
  /** Only https/http URIs without credentials, or ref:<kind>:<scoped-id>:<reference-id>. */
  readonly sourceReference: string | null;
  readonly attachmentReference: string | null;
  readonly validFromEpochMs: number;
  readonly expiresAtEpochMs: number | null;
  readonly notes: string;
  readonly scope: EvidenceScope;
  readonly binding: EvidenceBinding;
}

export interface EvidenceValidationContext {
  readonly catalog: WebinarStandardCatalog;
  readonly nowEpochMs: number;
  readonly expectedRuleId: RuleId;
  readonly expectedScope: EvidenceScope;
  readonly expectedInputSnapshotVersion: string;
  readonly expectedArtifactVersion: string | null;
  /** Rule-specific reference requirements; no generic inference of sufficiency. */
  readonly referenceRequired: boolean;
}
export interface EvidenceValidationIssue {
  readonly code: string;
  readonly field: string;
  readonly message: string;
  readonly index: number | null;
}
export type EvidenceValidationResult =
  | { readonly ok: true; readonly evidence: ManualEvidence }
  | { readonly ok: false; readonly issues: readonly EvidenceValidationIssue[] };
export type EvidenceCollectionValidationResult =
  | { readonly ok: true; readonly evidence: readonly ManualEvidence[] }
  | { readonly ok: false; readonly issues: readonly EvidenceValidationIssue[] };