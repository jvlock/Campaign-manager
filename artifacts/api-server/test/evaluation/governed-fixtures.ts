import { catalog, makeContext, referenceTime as now } from "./fixtures";
import { planWebinarAudience, type WebinarAudienceInput } from "../../src/lib/webinar-standard-audience";
import type { GovernedObservation, GovernedRuleId, GovernedRequest, EvaluationContext } from "../../src/lib/webinar-standard-evaluation";
import type { ManualEvidence } from "../../src/lib/webinar-standard-evidence";
export { now };
export const touches = ["recruitment_1", "recruitment_2", "recruitment_3", "final_recruitment"].map((identity, i) =>
  ({ identity: identity as WebinarAudienceInput["recruitmentTouches"][number]["identity"], communicationId: `rec-${i}` }));
export function evidence(id: GovernedRuleId): ManualEvidence {
  return {
    evidenceId: `evidence-${id}`, ruleId: id, standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    evidenceStatus: "confirmed", evidenceDescription: "Fixture provenance, not a live Foundation connection.",
    suppliedBy: { nameOrPilotIdentifier: "fixture", identityVerified: false }, suppliedAtEpochMs: now,
    sourceReference: "ref:event:event-1:source-1", attachmentReference: null, validFromEpochMs: now - 1000,
    expiresAtEpochMs: null, notes: "Test only",
    scope: { eventId: "event-1", sessionIds: id === "WEB-REC-010" ? ["occurrence-1"] : [],
      participantIds: id === "WEB-REC-010" ? ["participant-1"] : [],
      communicationIds: id === "WEB-REC-010" ? touches.map(t => t.communicationId) : [], deliverableIds: [] },
    binding: { inputSnapshotVersion: "input-1", artifactVersion: null, reviewedAtEpochMs: now,
      snapshotCompleteness: "complete", observationFromEpochMs: now - 1000, observationThroughEpochMs: now },
  };
}
export function request(): GovernedRequest {
  return { eventId: "event-1", campaignId: "campaign-1", inputFingerprint: "immutable-input-1",
    inputVersion: "input-1", requestReference: "transaction-1",
    expectedSourceVersion: { version: "fixture-version", deprecated: false, effectiveFromEpochMs: now - 10000, effectiveThroughEpochMs: null } };
}
export function observation(id: GovernedRuleId): GovernedObservation {
  const capability = id === "WEB-SETUP-003" ? "objective_membership" : "campaign_exclusion";
  return { observationId: "receipt-1", ruleId: id, standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    source: "foundation", capability, sourceVersion: "fixture-version", eventId: "event-1", campaignId: "campaign-1",
    participantId: id === "WEB-REC-010" ? "participant-1" : null, objectiveId: id === "WEB-SETUP-003" ? "objective-1" : null,
    inputFingerprint: "immutable-input-1", inputVersion: "input-1", requestReference: "transaction-1",
    outputReference: "output-1", outputType: capability, status: "success", decision: true,
    generatedAtEpochMs: now - 1000, recordedAtEpochMs: now - 100, validFromEpochMs: now - 1000, expiresAtEpochMs: null,
    provenance: evidence(id), environment: "test", unavailableReason: null, notes: "Test fixture; no service invoked." };
}
export function fixture(id: GovernedRuleId): EvaluationContext {
  const base = makeContext();
  const input: WebinarAudienceInput = {
    calculationInstantEpochMs: now, timeZone: "UTC", standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    event: { ...base.event, startsAtEpochMs: now + 21 * 86400000, endsAtEpochMs: null, actualEndsAtEpochMs: null,
      observedAtEpochMs: now, materialChangeTriggeredAtEpochMs: null, cancellationTriggeredAtEpochMs: null },
    recruitmentTouches: touches,
    participants: [{ participantId: "participant-1", eventId: "event-1", registrationStatus: "not_registered",
      attendanceState: "unknown", audienceClass: "customer", recruitmentEligible: true, contactable: true,
      optedOut: false, invalidAddress: false, governedExclusion: true, registrationAtEpochMs: null,
      attendanceAvailableAtEpochMs: null, waitlistedAtEpochMs: null, waitlistPromotionTriggeredAtEpochMs: null,
      waitlistClosureTriggeredAtEpochMs: null, participantCancellationTriggeredAtEpochMs: null,
      neutralVariantApproved: false, qaTestSendRequested: false, followUpAssetId: null }],
  };
  return { ...base, participant: null, event: { ...base.event, startsAtEpochMs: input.event.startsAtEpochMs },
    setup: { eventId: "event-1", snapshotId: "input-1", complete: true, activityType: "Webinar" },
    governed: { environment: "test",
      objective: id === "WEB-SETUP-003" ? { request: request(), objectiveId: "objective-1", observations: [observation(id)] } : null,
      exclusion: id === "WEB-REC-010" ? { request: request(), occurrenceId: "occurrence-1", completePopulation: true,
        audienceInput: input, audiencePlan: planWebinarAudience(catalog, input), observations: [observation(id)],
        operational: [{ participantId: "participant-1", evidence: evidence(id),
          recipientObservations: touches.map(t => ({ communicationId: t.communicationId, scheduledAtEpochMs: now + 10000, included: false })) }] } : null,
    },
  };
}