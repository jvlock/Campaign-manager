import { loadWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/loader";
import { createWebinarEvaluatorRegistry } from "../../src/lib/webinar-standard-evaluation/registry";
import type {
  CommunicationContext, EvaluationContext, ParticipantContext,
} from "../../src/lib/webinar-standard-evaluation/types";

// 2030-01-01T12:00:00Z: all tests use this observation, never wall-clock time.
export const referenceTime = 1_893_499_200_000;
export const catalog = await loadWebinarStandardCatalog();
export const registry = createWebinarEvaluatorRegistry(catalog);

export function makeParticipant(overrides: Partial<ParticipantContext> = {}): ParticipantContext {
  return {
    participantId: "participant-1",
    eventId: "event-1",
    registrationStatus: "registered",
    attendanceState: "unknown",
    audienceClass: "customer",
    includedInAttendance: false,
    includedInReporting: false,
    ...overrides,
  };
}

export function makeCommunication(overrides: Partial<CommunicationContext> = {}): CommunicationContext {
  return {
    communicationId: "communication-1",
    eventId: "event-1",
    recipientIds: ["participant-1"],
    kind: "recruitment",
    variant: null,
    state: "planned",
    createdAtEpochMs: referenceTime,
    scheduledAtEpochMs: referenceTime + 60_000,
    recordedAtEpochMs: null,
    utmRequired: true,
    utm: { value: "utm_campaign=webinar", source: "foundation", verified: true },
    ...overrides,
  };
}

export function makeContext(): EvaluationContext {
  return {
    observedAtEpochMs: referenceTime,
    event: { eventId: "event-1", operationalStatus: "scheduled", startsAtEpochMs: referenceTime + 3_600_000 },
    participant: makeParticipant(),
    communications: [],
    registrationFlowTest: { confirmed: true, evidence: "End-to-end registration checked by reviewer." },
    joinLinkOrVenueTest: { confirmed: true, evidence: "Join link checked by reviewer." },
    consent: {
      required: true,
      languageAttached: true,
      confirmation: { confirmed: true, evidence: "Required audience consent reviewed." },
    },
    governance: {
      internalName: { value: "WEB-2030-01", source: "foundation", verified: true },
      campaignCode: { value: "WEB203001", source: "foundation", verified: true },
      taxonomyValues: [{ value: "webinar", source: "foundation", verified: true }],
    },
    followUp: {
      attended: { variantId: "attended-1", messageContent: "Thank you for attending.", destinationId: "shared-recording" },
      absent: { variantId: "absent-1", messageContent: "Sorry we missed you.", destinationId: "shared-recording" },
      distinctContentConfirmation: { confirmed: true, evidence: "Reviewer confirmed distinct attended and absent messages." },
    },
  };
}