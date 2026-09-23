import { READINESS_STAGES, type RuleId, type WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { validateManualEvidence, type ManualEvidence } from "../webinar-standard-evidence";
import { validateIncomingResults } from "../webinar-standard-readiness/result-validation";
import type { DeliverableArtifact, DeliverableEvaluationContext, DeliverableReview } from "./deliverable-types";
import type { EvaluationContext, RuleFinding } from "./types";

const finding = (status: RuleFinding["status"], reason: RuleFinding["reason"], detail: string): RuleFinding =>
  Object.freeze({ status, reason, evidence: Object.freeze([detail]) });
export const pass = (s = "Current scoped evidence confirms the canonical requirement.") => finding("pass", "satisfied", s);
export const fail = (s: string) => finding("fail", "violation", s);
export const missing = (s: string) => finding("evidence_unavailable", "missing_evidence", s);
export const invalid = (s: string) => finding("fail", "invalid_context", s);
export const na = () => finding("not_applicable", "condition_not_met", "The canonical trigger is explicitly not met.");
export const text = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;
export const instant = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 8_640_000_000_000_000;
const unique = (ids: readonly string[]) => ids.every(text) && new Set(ids).size === ids.length;
export function combine(results: readonly RuleFinding[]): RuleFinding {
  return results.find(r => r.reason === "invalid_context")
    ?? results.find(r => r.status === "evidence_unavailable")
    ?? results.find(r => r.status === "fail") ?? pass();
}
export function condition(value: boolean | null): RuleFinding | null {
  return value === null ? missing("Applicability is unknown.") : value ? null : na();
}
export function stage(d: DeliverableEvaluationContext, expected: string): RuleFinding | null {
  return d.evaluationStage === null ? missing("Evaluation stage is required.") : d.evaluationStage === expected ? null : na();
}

/** Structural validation does not interpret rule names, prefixes, or policy. */
export function common(catalog: WebinarStandardCatalog, c: EvaluationContext): RuleFinding | null {
  if (!instant(c.observedAtEpochMs) || !c.event || !text(c.event.eventId)
    || !["draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled"].includes(c.event.operationalStatus)
    || (c.event.startsAtEpochMs !== null && !instant(c.event.startsAtEpochMs))) return invalid("Malformed event or observation instant.");
  const d = c.deliverables;
  if (!d) return missing("Current deliverable snapshot is required.");
  if (d.standardId !== catalog.standardId || d.standardVersion !== catalog.standardVersion
    || d.eventId !== c.event.eventId || !text(d.occurrenceId) || !text(d.snapshotVersion)
    || !instant(d.snapshotCreatedAtEpochMs) || d.snapshotCreatedAtEpochMs > c.observedAtEpochMs
    || typeof d.complete !== "boolean" || !Array.isArray(d.artifacts) || !Array.isArray(d.communications)
    || !Array.isArray(d.prerequisites) || !d.facts
    || (d.evaluationStage !== null && !(READINESS_STAGES as readonly string[]).includes(d.evaluationStage))) return invalid("Malformed or wrong-scope deliverable snapshot.");
  if (d.activityType === null) return missing("Activity type is unknown.");
  if (!text(d.activityType)) return invalid("Malformed activity type.");
  if (d.activityType !== "Webinar") return na();
  const booleans = ["capacitySet", "capacityReachable", "objectiveCallsForHandraiser", "absentHandraiserAppropriate",
    "supportingChannelsUsed", "accessibilityRequired", "salesAdjacent", "waitlistInUse", "qaSendRequested", "captureInUse"] as const;
  if (booleans.some(k => d.facts[k] !== null && typeof d.facts[k] !== "boolean")
    || ![null, "available", "expected", "not_expected"].includes(d.facts.recordingAvailability)) return invalid("Malformed applicability facts.");
  if (!unique(d.communications.map(x => x?.communicationId)) || !unique(d.artifacts.map(x => x?.deliverableId))) return invalid("Duplicate or missing communication/deliverable identity.");
  for (const x of d.communications) {
    if (!x || x.eventId !== d.eventId || x.occurrenceId !== d.occurrenceId || !text(x.channel)
      || !["recruitment", "confirmation", "reminder", "change", "cancellation", "waitlist", "follow_up", "qa_test"].includes(x.kind)
      || ![null, "attended", "absent", "neutral", "test"].includes(x.variant)
      || !["attended", "absent", "unknown", "internal_test", "registrant", "non_registrant", "waitlisted"].includes(x.audienceState)
      || (x.kind === "follow_up" && !["attended", "absent", "neutral"].includes(x.variant!))
      || (x.variant === "attended" && x.audienceState !== "attended")
      || (x.variant === "absent" && x.audienceState !== "absent")
      || (x.variant === "neutral" && x.audienceState !== "unknown")
      || (x.kind === "qa_test" && (x.variant !== "test" || x.audienceState !== "internal_test"))) return invalid("Incorrect communication or audience-variant relationship.");
  }
  const ids: string[] = [];
  const roles = ["speaker", "recording_statement", "waitlist_procedure", "handraiser", "support_channel", "accessibility",
    "sales_handoff", "message", "plan", "registration_page", "brief", "supporting_content", "capture", "qa_checklist"];
  for (const a of d.artifacts) {
    if (!a || !roles.includes(a.role) || a.eventId !== d.eventId || a.occurrenceId !== d.occurrenceId
      || !text(a.contentVersion) || !instant(a.versionCreatedAtEpochMs) || a.versionCreatedAtEpochMs > d.snapshotCreatedAtEpochMs
      || !["planned", "produced"].includes(a.lifecycle) || typeof a.content !== "string"
      || (a.owner !== null && !text(a.owner)) || (a.dueAtEpochMs !== null && !instant(a.dueAtEpochMs))
      || (a.speakerConfirmed !== null && typeof a.speakerConfirmed !== "boolean")
      || (a.assetId !== null && !text(a.assetId)) || (a.destinationId !== null && !text(a.destinationId))
      || !Array.isArray(a.reviews)
      || (a.role === "message" && a.communicationId === null)
      || (a.communicationId !== null && !d.communications.some(x => x.communicationId === a.communicationId))) return invalid("Malformed artifact, version, or missing communication relationship.");
    for (const r of a.reviews) {
      if (!r || !["review", "test", "approval", "receipt", "observation"].includes(r.kind) || !r.evidence
        || r.ruleId !== r.evidence.ruleId) return invalid("Malformed or wrong-rule review record.");
      ids.push(r.evidence.evidenceId);
      const checked = evidence(catalog, c, r.ruleId, r.evidence, a);
      if (checked.reason === "invalid_context") return checked;
    }
  }
  // One current message per communication; shared assets/destinations remain permitted.
  const messages = d.artifacts.filter(a => a.role === "message");
  if (!unique(messages.map(a => a.communicationId!))) return invalid("Conflicting current message versions for one communication.");
  for (const p of d.prerequisites) {
    if (!p || !p.result || !p.evidence) return invalid("Malformed prerequisite wrapper.");
    ids.push(p.evidence.evidenceId);
    const checked = evidence(catalog, c, p.result.ruleId, p.evidence, null);
    if (checked.reason === "invalid_context") return checked;
  }
  if (d.supportingContentInventoryEvidence) {
    ids.push(d.supportingContentInventoryEvidence.evidenceId);
    const checked = evidence(catalog, c, "WEB-RDY-RUN-004", d.supportingContentInventoryEvidence, null);
    if (checked.reason === "invalid_context") return checked;
  }
  if (!unique(ids)) return invalid("Duplicate or missing evidence identity.");
  const validated = validateIncomingResults(d.prerequisites.map(p => p.result), catalog);
  if (validated.issues.length || validated.duplicateRuleIds.length
    || validated.results.some(r => r.participantId !== null || r.reason === "invalid_context")) return invalid("Malformed, duplicated, or invalid-context prerequisite.");
  if (c.participant && (c.participant.eventId !== c.event.eventId || !text(c.participant.participantId)
    || !["attended", "absent", "unknown"].includes(c.participant.attendanceState)
    || !["customer", "internal", "test"].includes(c.participant.audienceClass))) return invalid("Wrong participant webinar scope or state.");
  return null;
}

export function evidence(catalog: WebinarStandardCatalog, c: EvaluationContext, id: RuleId,
  e: ManualEvidence, a: DeliverableArtifact | null): RuleFinding {
  const d = c.deliverables!;
  const checked = validateManualEvidence(e, {
    catalog, nowEpochMs: c.observedAtEpochMs, expectedRuleId: id,
    expectedScope: { eventId: d.eventId, sessionIds: [d.occurrenceId], participantIds: [],
      communicationIds: a?.communicationId ? [a.communicationId] : [], deliverableIds: a ? [a.deliverableId] : [] },
    expectedInputSnapshotVersion: d.snapshotVersion, expectedArtifactVersion: a?.contentVersion ?? null, referenceRequired: true,
  });
  if (!checked.ok) return invalid(checked.issues.map(i => `${i.field}: ${i.code}`).join("; "));
  if (e.binding.reviewedAtEpochMs < (a?.versionCreatedAtEpochMs ?? d.snapshotCreatedAtEpochMs)
    || e.suppliedAtEpochMs < e.binding.reviewedAtEpochMs
    || e.validFromEpochMs > e.binding.reviewedAtEpochMs
    || (e.binding.observationFromEpochMs !== null && e.binding.observationFromEpochMs < (a?.versionCreatedAtEpochMs ?? d.snapshotCreatedAtEpochMs))) return invalid("Evidence chronology precedes its version or recording.");
  if (e.evidenceStatus === "unavailable" || e.evidenceStatus === "incomplete" || e.binding.snapshotCompleteness !== "complete") return missing("Review is unavailable or incomplete.");
  return e.evidenceStatus === "rejected" ? fail("Current authoritative review rejects the canonical requirement.") : pass();
}
export function review(catalog: WebinarStandardCatalog, c: EvaluationContext, id: RuleId,
  a: DeliverableArtifact, kind: DeliverableReview["kind"] = "review"): RuleFinding {
  const records = a.reviews.filter(r => r.evidence.ruleId === id);
  if (!records.length) return missing("Exact-rule, current-version review evidence is required.");
  const validations = records.map(r => evidence(catalog, c, id, r.evidence, a));
  const malformed = validations.find(r => r.reason === "invalid_context");
  if (malformed) return malformed;
  // A later observation cannot be ignored in favor of an older positive review.
  const performed = records.filter(r => r.kind === kind);
  if (!performed.length) return missing(`Actual ${kind} evidence is required; configuration is not verification.`);
  const latestAt = Math.max(...performed.map(r => r.evidence.binding.reviewedAtEpochMs));
  const latestObservations = records.filter(r => r.kind === "observation" && r.evidence.binding.reviewedAtEpochMs >= latestAt);
  const observationAt = Math.max(...latestObservations.map(r => r.evidence.binding.reviewedAtEpochMs));
  // A positive generic observation cannot replace an absent/failed actual test, approval, or receipt.
  return combine([...performed.filter(r => r.evidence.binding.reviewedAtEpochMs === latestAt),
    ...latestObservations.filter(r => r.evidence.binding.reviewedAtEpochMs === observationAt)]
    .map(r => evidence(catalog, c, id, r.evidence, a)));
}
export function artifact(catalog: WebinarStandardCatalog, c: EvaluationContext, id: RuleId,
  a: DeliverableArtifact | undefined, kind: DeliverableReview["kind"] = "review"): RuleFinding {
  if (!a) return c.deliverables!.complete ? fail("Required deliverable is absent from the complete inventory.") : missing("Required deliverable inventory is incomplete.");
  if (a.lifecycle !== "produced" || !text(a.content)) return fail("Required concrete deliverable has not been produced.");
  return review(catalog, c, id, a, kind);
}
export function prerequisite(catalog: WebinarStandardCatalog, c: EvaluationContext, id: RuleId,
  allowNotApplicable = false, before: number | null = null): RuleFinding {
  const p = c.deliverables!.prerequisites.find(p => p.result.ruleId === id);
  if (!p) return missing(`Required canonical prerequisite ${id} is unavailable.`);
  const provenance = evidence(catalog, c, id, p.evidence, null);
  if (provenance.status !== "pass") return provenance;
  if (before !== null && (p.evidence.binding.reviewedAtEpochMs >= before || p.evidence.suppliedAtEpochMs >= before)) return fail(`${id} was not confirmed before the event.`);
  if (p.result.status === "unimplemented" || p.result.status === "evidence_unavailable") return missing(`${id} is unavailable; a review cannot replace its evaluator or evidence.`);
  if (p.result.status === "fail") return fail(`${id} failed.`);
  if (p.result.status === "not_applicable" && !allowNotApplicable) return fail(`${id} must pass, not merely be inapplicable.`);
  return pass();
}