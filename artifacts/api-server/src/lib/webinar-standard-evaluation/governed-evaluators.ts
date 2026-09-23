import type { WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { snapshotData } from "../webinar-standard-readiness/safe-data";
import { validateWebinarAudiencePlanResult } from "../webinar-standard-audience/validate-result";
import type { EvidenceScope } from "../webinar-standard-evidence/types";
import type { EvaluationContext, RuleEvaluator, RuleFinding } from "./types";
import type { GovernedExclusionContext } from "./governed-types";
import { evidenceIssue, fail, instant, invalid, missing, na, pass, receipt, requestIssue, text } from "./governed-helpers";

export const GOVERNED_BATCH_RULE_IDS = Object.freeze(["WEB-SETUP-003", "WEB-REC-010"] as const);
function scope(eventId: string, sessionIds: readonly string[] = [], participantIds: readonly string[] = [],
  communicationIds: readonly string[] = []): EvidenceScope {
  return { eventId, sessionIds, participantIds, communicationIds, deliverableIds: [] };
}
function objective(catalog: WebinarStandardCatalog, c: EvaluationContext): RuleFinding {
  if (!c.setup) return missing("Current activity snapshot required.");
  if (c.setup.eventId !== c.event.eventId || !text(c.setup.snapshotId) || typeof c.setup.complete !== "boolean") return invalid("Invalid setup scope.");
  if (!c.setup.complete || c.setup.activityType === null) return missing("Complete current activity type required.");
  if (!text(c.setup.activityType)) return invalid("Invalid activity type.");
  if (c.setup.activityType !== "Webinar") return na("Activity is not Webinar.");
  const value = c.governed?.objective;
  if (!value) return missing("Governed objective receipt required; manual values do not establish membership.");
  const issue = requestIssue(value.request, c);
  if (issue) return invalid(issue);
  if (value.request.inputVersion !== c.setup.snapshotId) return invalid("Objective request does not bind current setup version.");
  if (!Array.isArray(value.observations)) return invalid("Invalid objective observation collection.");
  if (value.objectiveId === null && value.observations.length === 0) return fail("No business objective selected in the complete setup snapshot.");
  if (!text(value.objectiveId)) return invalid("Objective identity is malformed.");
  const result = receipt(catalog, c, value.request, "WEB-SETUP-003", value.observations,
    scope(c.event.eventId), null, value.objectiveId);
  if ("finding" in result) return result.finding;
  return result.observation.decision ? pass("Exact selected objective has current Foundation membership.")
    : fail("Foundation reports selected objective is not a governed member.");
}
function exclusion(catalog: WebinarStandardCatalog, c: EvaluationContext): RuleFinding {
  const value = c.governed?.exclusion;
  if (!value) return missing("Campaign/person governed exclusion observations required.");
  const issue = requestIssue(value.request, c);
  if (issue) return invalid(issue);
  if (!text(value.occurrenceId) || typeof value.completePopulation !== "boolean"
    || !Array.isArray(value.observations) || !Array.isArray(value.operational)) return invalid("Invalid exclusion snapshot.");
  if (value.audienceInput?.event.eventId !== c.event.eventId
    || value.audienceInput?.event.operationalStatus !== c.event.operationalStatus
    || value.audienceInput?.event.startsAtEpochMs !== c.event.startsAtEpochMs
    || value.audienceInput?.calculationInstantEpochMs !== c.observedAtEpochMs
    || validateWebinarAudiencePlanResult(value.audiencePlan, value.audienceInput, catalog)) return invalid("Invalid current audience input/plan.");
  if (!value.completePopulation) return missing("Complete campaign population required.");
  const people = value.audienceInput.participants.map(p => p.participantId);
  const communications = value.audienceInput.recruitmentTouches.map(t => t.communicationId);
  if (new Set(value.observations.map(o => o.observationId)).size !== value.observations.length
    || value.observations.some(o => !people.includes(o.participantId!))
    || new Set(value.operational.map(o => o.participantId)).size !== value.operational.length
    || new Set(value.operational.map(o => o.evidence.evidenceId)).size !== value.operational.length
    || value.operational.some(o => !people.includes(o.participantId))) return invalid("Duplicate or unrelated campaign/person observations.");
  const findings: RuleFinding[] = [];
  let applies = false;
  for (const person of value.audienceInput.participants) {
    const expectedScope = scope(c.event.eventId, [value.occurrenceId], [person.participantId], communications);
    const history = value.observations.filter(o => o.participantId === person.participantId);
    const result = receipt(catalog, c, value.request, "WEB-REC-010",
      history, expectedScope, person.participantId, null);
    if ("finding" in result) { findings.push(result.finding); continue; }
    if (!result.observation.decision) {
      if (person.governedExclusion) findings.push(invalid("Audience exclusion contradicts current Foundation decision."));
    } else {
      const planned = value.audiencePlan.participants.find(p => p.participantId === person.participantId)!;
      if (!person.governedExclusion || planned.recruitmentEligible || planned.recruitmentPlan !== null
        || !planned.suppressions.includes("governed_exclusion")) findings.push(fail("Foundation exclusion is absent from audience suppression."));
    }
    const exclusions = history.filter(o => o.status === "success" && o.decision);
    if (!exclusions.length) continue;
    applies = true;
    const operational: GovernedExclusionContext["operational"][number] | undefined = value.operational.find(o => o.participantId === person.participantId);
    if (!operational) { findings.push(missing("Planner suppression is not operational evidence.")); continue; }
    const evidence = evidenceIssue(catalog, c, value.request, "WEB-REC-010", expectedScope, operational.evidence);
    if (evidence) { findings.push(evidence); continue; }
    const binding = operational.evidence.binding;
    if (!instant(binding.observationFromEpochMs) || !instant(binding.observationThroughEpochMs)
      || binding.observationFromEpochMs! > Math.min(...exclusions.map(o => o.validFromEpochMs))
      || binding.observationThroughEpochMs! < c.observedAtEpochMs) {
      findings.push(missing("Operational evidence must cover the supplied exclusion history through the current observation."));
      continue;
    }
    if (!Array.isArray(operational.recipientObservations)
      || operational.recipientObservations.length !== communications.length
      || new Set(operational.recipientObservations.map(o => o.communicationId)).size !== communications.length
      || operational.recipientObservations.some(o => !communications.includes(o.communicationId)
        || !instant(o.scheduledAtEpochMs) || typeof o.included !== "boolean")) {
      findings.push(invalid("Operational recipient ledger must exactly cover recruitment scope.")); continue;
    }
    // Reaffirmation and clearance govern their own effective interval; neither
    // retroactively erases an inclusion during an earlier authoritative exclusion.
    for (const recipient of operational.recipientObservations.filter(o => o.included)) {
      const governing = [...history].filter(o => o.validFromEpochMs <= recipient.scheduledAtEpochMs)
        .sort((a, b) => b.generatedAtEpochMs - a.generatedAtEpochMs)[0];
      if (!governing) continue; // Before any supplied exclusion became effective.
      if (governing.status !== "success"
        || governing.expiresAtEpochMs !== null && recipient.scheduledAtEpochMs >= governing.expiresAtEpochMs) {
        findings.push(missing("Authoritative decision unavailable at the recipient observation instant."));
      } else if (governing.decision) findings.push(fail("Governed excluded person remains in recruitment recipients."));
    }
  }
  return findings.find(f => f.reason === "invalid_context") ?? findings.find(f => f.status === "fail")
    ?? findings.find(f => f.status === "evidence_unavailable")
    ?? (applies ? pass("Foundation exclusions and operational suppression agree for the complete campaign population.")
      : na("Complete Foundation observations establish no campaign exclusion applies."));
}
export function createGovernedEvaluators(catalog: WebinarStandardCatalog) {
  const protect = (evaluate: (catalog: WebinarStandardCatalog, c: EvaluationContext) => RuleFinding): RuleEvaluator => input => {
    // Detached plain data only; accessors, prototypes and cycles cannot supply authority.
    const copied = snapshotData(input);
    if (!copied.ok) return invalid("Governed evaluation requires immutable data-only context.");
    const c = copied.value as EvaluationContext;
    try {
      if (!instant(c.observedAtEpochMs) || !text(c.event?.eventId)) return invalid("Invalid event or observation time.");
      if (c.governed && !["production", "test"].includes(c.governed.environment)) return invalid("Explicit evidence environment required.");
      return evaluate(catalog, c);
    } catch { return invalid("Structurally invalid governed context."); }
  };
  return Object.freeze({
    "WEB-SETUP-003": protect(objective),
    "WEB-REC-010": protect(exclusion),
  });
}