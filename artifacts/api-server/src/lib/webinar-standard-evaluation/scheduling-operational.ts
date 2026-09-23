import type { RuleId, WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { STANDARD_ID, STANDARD_VERSION } from "../webinar-standard-catalog/types";
import { validateManualEvidence } from "../webinar-standard-evidence/validate";
import { assertInstant } from "../webinar-standard-planning-time/time";
import { validateIncomingResults } from "../webinar-standard-readiness/result-validation";
import type { RecruitmentPlan } from "../webinar-standard-scheduling/types";
import type {
  OmissionDisplayEvidence, RecruitmentConfigurationSnapshot,
  RecruitmentSuppressionSnapshot, SuppressionControlObservation, SuppressionObservation,
} from "./scheduling-types";
import type { EvaluationContext, RuleFinding } from "./types";

export const REQUIRED_SUPPRESSION_RULES = Object.freeze([
  "WEB-REC-005", "WEB-REC-006", "WEB-REC-007", "WEB-REC-008", "WEB-REC-009", "WEB-REC-010",
] as const satisfies readonly RuleId[]);
export type EvaluatedSuppressionRule = "WEB-REC-006" | "WEB-REC-007" | "WEB-REC-009";

const REASONS: Readonly<Record<EvaluatedSuppressionRule, readonly string[]>> = Object.freeze({
  "WEB-REC-006": ["opted_out", "not_recruitment_eligible", "not_contactable"],
  "WEB-REC-007": ["participant_state_suppresses_recruitment"],
  "WEB-REC-009": ["invalid_address"],
});
const EVENT_STATUSES = new Set([
  "draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled",
]);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const finding = (status: RuleFinding["status"], reason: RuleFinding["reason"], detail: string): RuleFinding =>
  Object.freeze({ status, reason, evidence: Object.freeze([detail]) });
const pass = (detail: string) => finding("pass", "satisfied", detail);
const fail = (detail: string) => finding("fail", "violation", detail);
const invalid = (detail: string) => finding("fail", "invalid_context", detail);
const missing = (detail: string) => finding("evidence_unavailable", "missing_evidence", detail);
const na = (detail: string) => finding("not_applicable", "condition_not_met", detail);

export function validateSchedulingCommonContext(context: EvaluationContext): string | null {
  try {
    assertInstant(context?.observedAtEpochMs, "observedAtEpochMs");
    assertInstant(context?.event?.startsAtEpochMs, "event.startsAtEpochMs");
  } catch { return "Invalid observation or event-start instant."; }
  if (!context.event || !text(context.event.eventId) || !EVENT_STATUSES.has(context.event.operationalStatus)) {
    return "Invalid event identity or operational status.";
  }
  if (context.scheduling === undefined || context.scheduling === null) return null;
  if (!text(context.scheduling.occurrenceId) || !text(context.scheduling.timeZone)) {
    return "Invalid scheduling occurrence identity or time zone.";
  }
  return null;
}

function exactCommunicationIds(
  snapshot: RecruitmentSuppressionSnapshot,
  plan: RecruitmentPlan,
  configured: RecruitmentConfigurationSnapshot,
): boolean {
  const expected = [...plan.touches.map(t => t.communicationId)].sort();
  return snapshot.recruitmentCommunicationIds.length === 4
    && new Set(snapshot.recruitmentCommunicationIds).size === 4
    && [...snapshot.recruitmentCommunicationIds].sort().every((id, index) => id === expected[index])
    && configured.touches.length === 4
    && [...configured.touches.map(t => t.communicationId)].sort().every((id, index) => id === expected[index]);
}

export function validateSuppressionSnapshot(
  context: EvaluationContext,
  value: RecruitmentSuppressionSnapshot,
  plan: RecruitmentPlan,
  configured: RecruitmentConfigurationSnapshot,
): string | null {
  if (!value || !text(value.snapshotId) || !text(value.occurrenceId)
    || value.occurrenceId !== context.scheduling?.occurrenceId
    || configured.occurrenceId !== value.occurrenceId
    || value.eventId !== context.event.eventId || value.standardId !== STANDARD_ID
    || value.standardVersion !== STANDARD_VERSION || value.observedAtEpochMs !== context.observedAtEpochMs
    || typeof value.completePopulation !== "boolean" || !Array.isArray(value.recruitmentCommunicationIds)
    || !Array.isArray(value.observations) || !Array.isArray(value.controls)
    || !Array.isArray(value.prerequisiteResults) || !exactCommunicationIds(value, plan, configured)) {
    return "Suppression snapshot is malformed, mis-scoped, or not bound to the verified plan/configuration.";
  }
  const audience = value.audiencePlan;
  if (!audience || audience.mode !== "planning_only" || audience.sendAuthorized !== false
    || audience.standardId !== STANDARD_ID || audience.standardVersion !== STANDARD_VERSION
    || audience.eventId !== context.event.eventId || audience.calculationInstantEpochMs !== context.observedAtEpochMs
    || audience.authority?.readinessOverride !== false || audience.authority?.exceptionOverride !== false
    || audience.authority?.sendingAuthority !== false || !Array.isArray(audience.participants)) {
    return "Audience plan violates its structural contract.";
  }
  const ids = new Set<string>();
  for (const participant of audience.participants) {
    if (!participant || !text(participant.participantId) || ids.has(participant.participantId)
      || typeof participant.recruitmentEligible !== "boolean"
      || typeof participant.customerReportingIncluded !== "boolean"
      || !Array.isArray(participant.suppressions) || !participant.suppressions.every(text)
      || new Set(participant.suppressions).size !== participant.suppressions.length
      || !Array.isArray(participant.warnings) || !participant.warnings.every(text)
      || !Array.isArray(participant.obligations)
      || !(participant.recruitmentPlan === null || typeof participant.recruitmentPlan === "object")) {
      return "Audience plan contains malformed or duplicate participant structures.";
    }
    ids.add(participant.participantId);
  }
  return null;
}

function evidenceFinding(
  catalog: WebinarStandardCatalog,
  context: EvaluationContext,
  snapshot: RecruitmentSuppressionSnapshot,
  ruleId: RuleId,
  participantIds: readonly string[],
  evidence: unknown,
): RuleFinding | null {
  const checked = validateManualEvidence(evidence, {
    catalog, nowEpochMs: context.observedAtEpochMs, expectedRuleId: ruleId,
    expectedScope: {
      eventId: context.event.eventId, sessionIds: [snapshot.occurrenceId],
      participantIds: [...participantIds], communicationIds: snapshot.recruitmentCommunicationIds,
      deliverableIds: [],
    },
    expectedInputSnapshotVersion: snapshot.snapshotId, expectedArtifactVersion: null,
    referenceRequired: true,
  });
  if (!checked.ok) return invalid("Operational evidence failed immutable evidence validation.");
  if (checked.evidence.binding.snapshotCompleteness !== "complete"
    || checked.evidence.evidenceStatus === "incomplete"
    || checked.evidence.evidenceStatus === "unavailable") {
    return missing("Operational evidence is unavailable or incomplete.");
  }
  if (checked.evidence.evidenceStatus === "rejected") {
    return fail("Operational evidence confirms the required control or suppression was rejected.");
  }
  return null;
}

function observationShape(
  observation: SuppressionObservation,
  ruleId: EvaluatedSuppressionRule,
  communicationIds: ReadonlySet<string>,
  observedAtEpochMs: number,
): string | null {
  if (!observation || observation.ruleId !== ruleId || !text(observation.participantId)
    || typeof observation.conditionApplies !== "boolean"
    || !Array.isArray(observation.recipientObservations)) return "Malformed suppression observation.";
  if (ruleId === "WEB-REC-007") {
    if (observation.conditionApplies) {
      try { assertInstant(observation.cancellationAtEpochMs, "cancellationAtEpochMs"); }
      catch { return "Cancelled-state evidence requires a valid cancellation instant."; }
      if (observation.cancellationAtEpochMs! > observedAtEpochMs) {
        return "Cancellation instant cannot be later than the observation instant.";
      }
    } else if (observation.cancellationAtEpochMs !== null) return "Non-cancelled evidence cannot supply a cancellation instant.";
  } else if (observation.cancellationAtEpochMs !== null) return "Cancellation instant is unrelated to this suppression rule.";
  const seen = new Set<string>();
  for (const recipient of observation.recipientObservations) {
    try { assertInstant(recipient?.scheduledAtEpochMs, "scheduledAtEpochMs"); }
    catch { return "Malformed recipient observation instant."; }
    if (!recipient || !communicationIds.has(recipient.communicationId) || seen.has(recipient.communicationId)
      || typeof recipient.included !== "boolean") return "Malformed, duplicate, or unrelated recipient observation.";
    seen.add(recipient.communicationId);
  }
  return seen.size === communicationIds.size ? null : "Recipient observations must cover every verified recruitment communication.";
}

export function evaluateSuppression(
  catalog: WebinarStandardCatalog,
  context: EvaluationContext,
  ruleId: EvaluatedSuppressionRule,
  plan: RecruitmentPlan,
  configured: RecruitmentConfigurationSnapshot,
): RuleFinding {
  const snapshot = context.scheduling?.suppression;
  if (snapshot === null || snapshot === undefined) return missing("Complete scoped operational suppression evidence is required.");
  const issue = validateSuppressionSnapshot(context, snapshot, plan, configured);
  if (issue) return invalid(issue);
  if (!snapshot.completePopulation) return missing("The operational population snapshot is incomplete.");
  if (snapshot.observations.some(observation => !observation || observation.ruleId !== ruleId)) {
    return invalid("Suppression snapshot contains an extra or unrelated rule observation.");
  }
  const audienceIds = snapshot.audiencePlan.participants.map(participant => participant.participantId);
  if (snapshot.observations.length !== audienceIds.length
    || new Set(snapshot.observations.map(observation => observation?.participantId)).size !== audienceIds.length
    || new Set(snapshot.observations.map(observation => observation?.evidence?.evidenceId)).size !== audienceIds.length
    || audienceIds.some(id => !snapshot.observations.some(observation => observation?.participantId === id))) {
    return invalid("Complete population requires exactly one scoped observation per audience participant.");
  }
  const communicationIds = new Set(snapshot.recruitmentCommunicationIds);
  const outcomes: RuleFinding[] = [];
  for (const observation of snapshot.observations) {
    const shapeIssue = observationShape(observation, ruleId, communicationIds, context.observedAtEpochMs);
    if (shapeIssue) return invalid(shapeIssue);
    const evidenceIssue = evidenceFinding(catalog, context, snapshot, ruleId, [observation.participantId], observation.evidence);
    if (evidenceIssue) {
      outcomes.push(evidenceIssue);
      continue;
    }
    const participant = snapshot.audiencePlan.participants.find(item => item.participantId === observation.participantId)!;
    const reasonPresent = REASONS[ruleId].some(reason => participant.suppressions.includes(reason));
    if (!observation.conditionApplies) {
      if (reasonPresent) return invalid("Condition-applicability evidence contradicts the verified audience suppression state.");
      continue;
    }
    if (ruleId === "WEB-REC-007" && participant.state !== "cancelled") {
      outcomes.push(fail("Cancellation suppression requires an actually cancelled audience participant."));
    }
    if (!reasonPresent || participant.recruitmentEligible || participant.recruitmentPlan !== null) {
      outcomes.push(fail("The audience plan does not contain the required suppression."));
    }
    const prohibited = observation.recipientObservations.some(recipient =>
      recipient.included && (ruleId !== "WEB-REC-007"
        || recipient.scheduledAtEpochMs >= observation.cancellationAtEpochMs!));
    if (prohibited) outcomes.push(fail("A suppressed participant remains in a prohibited recruitment recipient scope."));
  }
  if (outcomes.some(outcome => outcome.reason === "invalid_context")) return outcomes.find(outcome => outcome.reason === "invalid_context")!;
  if (outcomes.some(outcome => outcome.status === "fail")) return outcomes.find(outcome => outcome.status === "fail")!;
  if (outcomes.some(outcome => outcome.status === "evidence_unavailable")) return outcomes.find(outcome => outcome.status === "evidence_unavailable")!;
  return snapshot.observations.some(observation => observation.conditionApplies)
    ? pass("Complete operational evidence and audience output confirm suppression.")
    : na("Complete population evidence confirms the suppression trigger is false.");
}

function validateControlEvidence(
  catalog: WebinarStandardCatalog,
  context: EvaluationContext,
  snapshot: RecruitmentSuppressionSnapshot,
  control: SuppressionControlObservation,
): RuleFinding | null {
  if (!control || !(REQUIRED_SUPPRESSION_RULES as readonly RuleId[]).includes(control.ruleId)
    || typeof control.active !== "boolean") return invalid("Malformed or unrelated suppression-control evidence.");
  return evidenceFinding(
    catalog, context, snapshot, control.ruleId,
    snapshot.audiencePlan.participants.map(participant => participant.participantId), control.evidence,
  );
}

export function evaluateSuppressionReadiness(
  catalog: WebinarStandardCatalog,
  context: EvaluationContext,
  plan: RecruitmentPlan,
  configured: RecruitmentConfigurationSnapshot,
): RuleFinding {
  const snapshot = context.scheduling?.suppression;
  if (snapshot === null || snapshot === undefined) return missing("Complete scoped suppression-control evidence is required.");
  const issue = validateSuppressionSnapshot(context, snapshot, plan, configured);
  if (issue) return invalid(issue);
  if (!snapshot.completePopulation) return missing("Complete population evidence is required for suppression readiness.");
  if (new Set(snapshot.controls.map(control => control?.ruleId)).size !== snapshot.controls.length
    || new Set(snapshot.controls.map(control => control?.evidence?.evidenceId)).size !== snapshot.controls.length
    || snapshot.controls.some(control => !control
      || !(REQUIRED_SUPPRESSION_RULES as readonly RuleId[]).includes(control.ruleId))) {
    return invalid("Suppression readiness contains duplicate or unrelated control observations.");
  }
  const missingControl = REQUIRED_SUPPRESSION_RULES.some(id =>
    !snapshot.controls.some(control => control?.ruleId === id));
  const outcomes = snapshot.controls.map(control => validateControlEvidence(catalog, context, snapshot, control))
    .filter((item): item is RuleFinding => item !== null);
  const validated = validateIncomingResults(snapshot.prerequisiteResults, catalog);
  if (validated.issues.length || validated.duplicateRuleIds.length) return invalid("Suppression prerequisite findings are malformed or duplicated.");
  if (validated.results.some(result => result.participantId !== null
    || !(REQUIRED_SUPPRESSION_RULES as readonly RuleId[]).includes(result.ruleId))) {
    return invalid("Suppression readiness contains an unrelated or participant-scoped canonical finding.");
  }
  const missingFinding = REQUIRED_SUPPRESSION_RULES.some(id =>
    !validated.results.some(result => result.ruleId === id));
  if (outcomes.some(outcome => outcome.reason === "invalid_context")) return outcomes.find(outcome => outcome.reason === "invalid_context")!;
  if (validated.results.some(result => result.reason === "invalid_context")) {
    return invalid("A Section C canonical prerequisite finding has invalid context.");
  }
  const failed = validated.results.find(result => result.status === "fail")
    ?? (snapshot.controls.some(control => !control.active) ? validated.results[0] : undefined);
  if (failed) return fail("A Section C suppression control or canonical prerequisite finding failed.");
  if (outcomes.some(outcome => outcome.status === "fail")) return outcomes.find(outcome => outcome.status === "fail")!;
  const unavailable = validated.results.some(result =>
    result.status === "unimplemented" || result.status === "evidence_unavailable")
    || outcomes.some(outcome => outcome.status === "evidence_unavailable")
    || missingControl || missingFinding;
  return unavailable
    ? missing("Complete implemented prerequisite coverage and operational control evidence are required.")
    : pass("All Section C canonical findings and operational controls are active.");
}

export function evaluateOmissionDisplay(
  catalog: WebinarStandardCatalog,
  context: EvaluationContext,
  plan: RecruitmentPlan,
  configured: RecruitmentConfigurationSnapshot,
): RuleFinding {
  const omitted = plan.touches.filter(touch => touch.disposition === "omitted");
  if (!omitted.length) return na("The verified scheduler did not omit a standard communication.");
  const display: OmissionDisplayEvidence | null | undefined = context.scheduling?.omissionDisplay;
  if (display === null || display === undefined) return missing("Actual rendered omission evidence is required.");
  if (!display || !text(display.renderVersion) || display.occurrenceId !== context.scheduling?.occurrenceId
    || display.configuredSnapshotId !== configured.snapshotId || !Array.isArray(display.entries)) {
    return invalid("Rendered omission evidence is malformed or not bound to the current occurrence/configuration.");
  }
  const evidence = validateManualEvidence(display.evidence, {
    catalog, nowEpochMs: context.observedAtEpochMs, expectedRuleId: "WEB-WIN-007",
    expectedScope: {
      eventId: context.event.eventId, sessionIds: [context.scheduling.occurrenceId],
      participantIds: [], communicationIds: plan.touches.map(touch => touch.communicationId), deliverableIds: [],
    },
    expectedInputSnapshotVersion: configured.snapshotId, expectedArtifactVersion: display.renderVersion,
    referenceRequired: true,
  });
  if (!evidence.ok) return invalid("Rendered omission evidence failed immutable evidence validation.");
  if (evidence.evidence.binding.snapshotCompleteness !== "complete"
    || ["incomplete", "unavailable"].includes(evidence.evidence.evidenceStatus)) {
    return missing("Rendered omission evidence is unavailable or incomplete.");
  }
  if (evidence.evidence.evidenceStatus === "rejected") {
    return fail("Operational evidence confirms that the rendered omission display was rejected.");
  }
  const identities = display.entries.map(entry => entry?.identity);
  const ids = display.entries.map(entry => entry?.communicationId);
  if (new Set(identities).size !== identities.length || new Set(ids).size !== ids.length
    || display.entries.some(entry => !entry || entry.label !== "omitted-because-past-due")) {
    return invalid("Rendered omission evidence contains duplicate or malformed entries.");
  }
  const matches = omitted.every(touch => display.entries.some(entry => entry.identity === touch.identity
    && entry.communicationId === touch.communicationId && entry.reason === touch.reason));
  return matches && display.entries.length === omitted.length
    ? pass("Actual rendered evidence lists every scheduler omission.")
    : fail("The rendered omission list is incomplete or inconsistent with the scheduler result.");
}