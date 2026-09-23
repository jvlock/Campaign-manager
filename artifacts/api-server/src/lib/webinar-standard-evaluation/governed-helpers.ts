import type { WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import type { EvidenceScope, ManualEvidence } from "../webinar-standard-evidence/types";
import { validateManualEvidence } from "../webinar-standard-evidence/validate";
import { assertInstant } from "../webinar-standard-planning-time/time";
import type { EvaluationContext, RuleFinding } from "./types";
import type { GovernedObservation, GovernedRequest, GovernedRuleId } from "./governed-types";

export const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export const outcome = (status: RuleFinding["status"], reason: RuleFinding["reason"], message: string): RuleFinding =>
  Object.freeze({ status, reason, evidence: Object.freeze([message]) });
export const invalid = (message: string) => outcome("fail", "invalid_context", message);
export const missing = (message: string) => outcome("evidence_unavailable", "missing_evidence", message);
export const fail = (message: string) => outcome("fail", "violation", message);
export const pass = (message: string) => outcome("pass", "satisfied", message);
export const na = (message: string) => outcome("not_applicable", "condition_not_met", message);
export function instant(value: unknown): boolean {
  try { assertInstant(value as number, "governed instant"); return true; } catch { return false; }
}
export function requestIssue(request: GovernedRequest, context: EvaluationContext): string | null {
  if (!request || request.eventId !== context.event.eventId
    || ![request.campaignId, request.inputFingerprint, request.inputVersion, request.requestReference].every(text)) {
    return "Missing or mis-scoped current governed request.";
  }
  const version = request.expectedSourceVersion;
  const now = context.observedAtEpochMs;
  if (!version || !text(version.version) || version.deprecated !== false
    || !instant(version.effectiveFromEpochMs) || version.effectiveFromEpochMs > now
    || !(version.effectiveThroughEpochMs === null || instant(version.effectiveThroughEpochMs)
      && version.effectiveThroughEpochMs > now && version.effectiveThroughEpochMs > version.effectiveFromEpochMs)) {
    return "Explicit current effective, non-deprecated Foundation version required.";
  }
  return null;
}
export function evidenceIssue(
  catalog: WebinarStandardCatalog, context: EvaluationContext, request: GovernedRequest,
  ruleId: GovernedRuleId, scope: EvidenceScope, evidence: ManualEvidence,
): RuleFinding | null {
  const validated = validateManualEvidence(evidence, {
    catalog, nowEpochMs: context.observedAtEpochMs, expectedRuleId: ruleId, expectedScope: scope,
    expectedInputSnapshotVersion: request.inputVersion, expectedArtifactVersion: null, referenceRequired: true,
  });
  if (!validated.ok) return invalid("Governed provenance/operational evidence is structurally invalid.");
  if (validated.evidence.binding.snapshotCompleteness !== "complete"
    || ["incomplete", "unavailable"].includes(validated.evidence.evidenceStatus)) return missing("Incomplete provenance/operational evidence.");
  if (validated.evidence.evidenceStatus === "rejected") return fail("Operational/provenance evidence rejected.");
  return null;
}
export function receipt(
  catalog: WebinarStandardCatalog, context: EvaluationContext, request: GovernedRequest,
  ruleId: GovernedRuleId, observations: readonly GovernedObservation[], scope: EvidenceScope,
  participantId: string | null, objectiveId: string | null,
): { observation: GovernedObservation } | { finding: RuleFinding } {
  const capability = ruleId === "WEB-SETUP-003" ? "objective_membership" : "campaign_exclusion";
  const ids = new Set<string>();
  const times = new Set<number>();
  for (const item of observations) {
    if (!item || !text(item.observationId) || ids.has(item.observationId)
      || item.ruleId !== ruleId || item.standardId !== catalog.standardId || item.standardVersion !== catalog.standardVersion
      || item.source !== "foundation" || item.capability !== capability || item.outputType !== capability
      || item.sourceVersion !== request.expectedSourceVersion.version
      || item.eventId !== request.eventId || item.campaignId !== request.campaignId
      || item.participantId !== participantId || item.objectiveId !== objectiveId
      || item.inputFingerprint !== request.inputFingerprint || item.inputVersion !== request.inputVersion
      || item.requestReference !== request.requestReference || item.environment !== context.governed!.environment
      || !["success", "unavailable", "error"].includes(item.status) || typeof item.notes !== "string"
      || ![item.generatedAtEpochMs, item.recordedAtEpochMs, item.validFromEpochMs].every(instant)
      || item.generatedAtEpochMs > item.recordedAtEpochMs || item.recordedAtEpochMs > context.observedAtEpochMs
      || item.generatedAtEpochMs < request.expectedSourceVersion.effectiveFromEpochMs
      || item.validFromEpochMs < item.generatedAtEpochMs || item.validFromEpochMs > context.observedAtEpochMs
      || !(item.expiresAtEpochMs === null || instant(item.expiresAtEpochMs)
        && item.expiresAtEpochMs > context.observedAtEpochMs && item.expiresAtEpochMs > item.validFromEpochMs)
      || times.has(item.generatedAtEpochMs)
      || (item.status === "success" ? typeof item.decision !== "boolean" || !text(item.outputReference) || item.unavailableReason !== null
        : item.decision !== null || item.outputReference !== null || !text(item.unavailableReason))) {
      return { finding: invalid("Malformed, duplicate, simultaneous, stale or non-authoritative governed observation.") };
    }
    ids.add(item.observationId); times.add(item.generatedAtEpochMs);
    const issue = evidenceIssue(catalog, context, request, ruleId, scope, item.provenance);
    if (issue) return { finding: issue.reason === "violation"
      ? invalid("Rejected governed provenance cannot establish a Foundation business decision.") : issue };
    if (item.provenance.suppliedAtEpochMs < item.recordedAtEpochMs
      || item.provenance.binding.reviewedAtEpochMs < item.recordedAtEpochMs) {
      return { finding: invalid("Provenance predates the governed observation.") };
    }
  }
  const latest = [...observations].sort((a, b) => b.generatedAtEpochMs - a.generatedAtEpochMs)[0];
  if (!latest || latest.status !== "success") return { finding: missing("Current authoritative Foundation result unavailable; no service invocation claimed.") };
  return { observation: latest };
}