import { STANDARD_ID, STANDARD_VERSION, type WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import { validateWebinarStandardCatalog } from "../webinar-standard-catalog/validate";
import { snapshotData, isRecord } from "../webinar-standard-readiness/safe-data";
import { assertInstant, assertTimeZone } from "../webinar-standard-planning-time/time";
import {
  AUDIENCE_COMMUNICATION_KINDS, AudiencePlanningInputError,
  type AudienceParticipantInput, type WebinarAudienceInput,
} from "./types";

const EVENT_STATUSES = ["draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled"] as const;
const REGISTRATION_STATUSES = ["not_registered", "registered", "waitlisted", "cancelled"] as const;
const ATTENDANCE_STATES = ["attended", "absent", "unknown"] as const;
const AUDIENCE_CLASSES = ["customer", "internal", "test"] as const;
const TOUCH_IDENTITIES = ["recruitment_1", "recruitment_2", "recruitment_3", "final_recruitment"] as const;
const ROOT_FIELDS = ["calculationInstantEpochMs", "timeZone", "standardId", "standardVersion", "event", "recruitmentTouches", "participants"];
const EVENT_FIELDS = ["eventId", "operationalStatus", "startsAtEpochMs", "endsAtEpochMs", "actualEndsAtEpochMs", "observedAtEpochMs", "materialChangeTriggeredAtEpochMs", "cancellationTriggeredAtEpochMs"];
const PARTICIPANT_FIELDS = ["participantId", "eventId", "registrationStatus", "attendanceState", "audienceClass", "recruitmentEligible", "contactable", "optedOut", "invalidAddress", "governedExclusion", "registrationAtEpochMs", "attendanceAvailableAtEpochMs", "waitlistedAtEpochMs", "waitlistPromotionTriggeredAtEpochMs", "waitlistClosureTriggeredAtEpochMs", "participantCancellationTriggeredAtEpochMs", "neutralVariantApproved", "qaTestSendRequested", "followUpAssetId", "communicationIds"];

function fail(message: string): never {
  throw new AudiencePlanningInputError(message);
}
function exact(
  value: unknown,
  fields: readonly string[],
  path: string,
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be a plain object.`);
  const keys = Object.keys(value);
  const unknown = keys.find((key) => !fields.includes(key));
  if (unknown) fail(`${path}.${unknown} is not part of the schema.`);
  const missing = fields.find((key) => !optional.includes(key) && !(key in value));
  if (missing) fail(`${path}.${missing} is required.`);
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${path} must be a non-empty string.`);
  return value;
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(`${path} must be boolean.`);
  return value;
}
function nullableInstant(value: unknown, path: string): number | null {
  return value === null ? null : assertInstant(value, path);
}
function oneOf<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(`${path} is unsupported.`);
  return value as T;
}

export function validateAudiencePlanningInput(
  catalogInput: WebinarStandardCatalog,
  input: unknown,
): WebinarAudienceInput {
  const catalogResult = validateWebinarStandardCatalog(catalogInput);
  if (!catalogResult.ok) fail("catalog is not a valid webinar standard catalog.");
  const snapshot = snapshotData(input);
  if (!snapshot.ok) fail("input must be finite, acyclic plain data without accessors.");
  const root = exact(snapshot.value, ROOT_FIELDS, "input");
  const calculationInstantEpochMs = assertInstant(root.calculationInstantEpochMs, "calculationInstantEpochMs");
  const timeZone = assertTimeZone(root.timeZone);
  if (root.standardId !== STANDARD_ID || root.standardId !== catalogResult.catalog.standardId) fail("standardId does not match the catalog.");
  if (root.standardVersion !== STANDARD_VERSION || root.standardVersion !== catalogResult.catalog.standardVersion) fail("standardVersion does not match the catalog.");

  const eventValue = exact(root.event, EVENT_FIELDS, "event");
  const event = {
    eventId: text(eventValue.eventId, "event.eventId"),
    operationalStatus: oneOf(eventValue.operationalStatus, EVENT_STATUSES, "event.operationalStatus"),
    startsAtEpochMs: assertInstant(eventValue.startsAtEpochMs, "event.startsAtEpochMs"),
    endsAtEpochMs: nullableInstant(eventValue.endsAtEpochMs, "event.endsAtEpochMs"),
    actualEndsAtEpochMs: nullableInstant(eventValue.actualEndsAtEpochMs, "event.actualEndsAtEpochMs"),
    observedAtEpochMs: assertInstant(eventValue.observedAtEpochMs, "event.observedAtEpochMs"),
    materialChangeTriggeredAtEpochMs: nullableInstant(eventValue.materialChangeTriggeredAtEpochMs, "event.materialChangeTriggeredAtEpochMs"),
    cancellationTriggeredAtEpochMs: nullableInstant(eventValue.cancellationTriggeredAtEpochMs, "event.cancellationTriggeredAtEpochMs"),
  };
  if (event.endsAtEpochMs !== null && event.endsAtEpochMs <= event.startsAtEpochMs) fail("event.endsAtEpochMs must be after event.startsAtEpochMs.");
  if (event.observedAtEpochMs !== calculationInstantEpochMs) fail("event.observedAtEpochMs must equal calculationInstantEpochMs.");
  if (event.operationalStatus === "completed") {
    if (event.actualEndsAtEpochMs === null) fail("completed events require event.actualEndsAtEpochMs.");
    if (event.actualEndsAtEpochMs <= event.startsAtEpochMs || event.actualEndsAtEpochMs > event.observedAtEpochMs) {
      fail("completed event actual end must be after start and no later than observation.");
    }
  } else if (event.actualEndsAtEpochMs !== null) {
    fail("event.actualEndsAtEpochMs is only valid for completed events.");
  }
  if (event.operationalStatus === "cancelled" && event.cancellationTriggeredAtEpochMs === null) {
    fail("cancelled events require event.cancellationTriggeredAtEpochMs.");
  }
  if (event.operationalStatus !== "cancelled" && event.cancellationTriggeredAtEpochMs !== null) {
    fail("event.cancellationTriggeredAtEpochMs is valid only for cancelled events.");
  }
  for (const [name, instant] of [["materialChangeTriggeredAtEpochMs", event.materialChangeTriggeredAtEpochMs], ["cancellationTriggeredAtEpochMs", event.cancellationTriggeredAtEpochMs]] as const) {
    if (instant !== null && instant > event.observedAtEpochMs) fail(`event.${name} cannot be after observation.`);
  }

  if (!Array.isArray(root.recruitmentTouches) || root.recruitmentTouches.length !== 4) fail("recruitmentTouches must contain all four canonical touches.");
  const touchIdentities = new Set<string>();
  const suppliedCommunicationIds = new Set<string>();
  const recruitmentTouches = root.recruitmentTouches.map((value, index) => {
    const touch = exact(value, ["identity", "communicationId"], `recruitmentTouches[${index}]`);
    const identity = oneOf(touch.identity, TOUCH_IDENTITIES, `recruitmentTouches[${index}].identity`);
    const communicationId = text(touch.communicationId, `recruitmentTouches[${index}].communicationId`);
    if (touchIdentities.has(identity)) fail(`duplicate recruitment touch identity: ${identity}.`);
    if (suppliedCommunicationIds.has(communicationId)) fail(`duplicate communication identity: ${communicationId}.`);
    touchIdentities.add(identity);
    suppliedCommunicationIds.add(communicationId);
    return { identity, communicationId };
  });
  if (TOUCH_IDENTITIES.some((identity) => !touchIdentities.has(identity))) fail("recruitmentTouches must contain each canonical identity.");

  if (!Array.isArray(root.participants)) fail("participants must be an array.");
  const participantIds = new Set<string>();
  const participants: AudienceParticipantInput[] = root.participants.map((value, index) => {
    const path = `participants[${index}]`;
    const item = exact(value, PARTICIPANT_FIELDS, path, ["communicationIds"]);
    const participantId = text(item.participantId, `${path}.participantId`);
    if (participantIds.has(participantId)) fail(`duplicate participant identity: ${participantId}.`);
    participantIds.add(participantId);
    if (item.eventId !== event.eventId) fail(`${path}.eventId must match event.eventId.`);
    const registrationStatus = oneOf(item.registrationStatus, REGISTRATION_STATUSES, `${path}.registrationStatus`);
    const attendanceState = oneOf(item.attendanceState, ATTENDANCE_STATES, `${path}.attendanceState`);
    const audienceClass = oneOf(item.audienceClass, AUDIENCE_CLASSES, `${path}.audienceClass`);
    const communicationIdsValue = item.communicationIds;
    let communicationIds: Partial<Record<(typeof AUDIENCE_COMMUNICATION_KINDS)[number], string>> | undefined;
    if (communicationIdsValue !== undefined) {
      if (!isRecord(communicationIdsValue)) fail(`${path}.communicationIds must be an object.`);
      communicationIds = {};
      for (const [kind, rawId] of Object.entries(communicationIdsValue)) {
        if (!(AUDIENCE_COMMUNICATION_KINDS as readonly string[]).includes(kind)) fail(`${path}.communicationIds.${kind} is unknown.`);
        const id = text(rawId, `${path}.communicationIds.${kind}`);
        if (suppliedCommunicationIds.has(id)) fail(`duplicate communication identity: ${id}.`);
        suppliedCommunicationIds.add(id);
        communicationIds[kind as (typeof AUDIENCE_COMMUNICATION_KINDS)[number]] = id;
      }
    }
    const participant: AudienceParticipantInput = {
      participantId, eventId: event.eventId, registrationStatus, attendanceState, audienceClass,
      recruitmentEligible: bool(item.recruitmentEligible, `${path}.recruitmentEligible`),
      contactable: bool(item.contactable, `${path}.contactable`),
      optedOut: bool(item.optedOut, `${path}.optedOut`),
      invalidAddress: bool(item.invalidAddress, `${path}.invalidAddress`),
      governedExclusion: bool(item.governedExclusion, `${path}.governedExclusion`),
      registrationAtEpochMs: nullableInstant(item.registrationAtEpochMs, `${path}.registrationAtEpochMs`),
      attendanceAvailableAtEpochMs: nullableInstant(item.attendanceAvailableAtEpochMs, `${path}.attendanceAvailableAtEpochMs`),
      waitlistedAtEpochMs: nullableInstant(item.waitlistedAtEpochMs, `${path}.waitlistedAtEpochMs`),
      waitlistPromotionTriggeredAtEpochMs: nullableInstant(item.waitlistPromotionTriggeredAtEpochMs, `${path}.waitlistPromotionTriggeredAtEpochMs`),
      waitlistClosureTriggeredAtEpochMs: nullableInstant(item.waitlistClosureTriggeredAtEpochMs, `${path}.waitlistClosureTriggeredAtEpochMs`),
      participantCancellationTriggeredAtEpochMs: nullableInstant(item.participantCancellationTriggeredAtEpochMs, `${path}.participantCancellationTriggeredAtEpochMs`),
      neutralVariantApproved: bool(item.neutralVariantApproved, `${path}.neutralVariantApproved`),
      qaTestSendRequested: bool(item.qaTestSendRequested, `${path}.qaTestSendRequested`),
      followUpAssetId: item.followUpAssetId === null ? null : text(item.followUpAssetId, `${path}.followUpAssetId`),
      ...(communicationIds === undefined ? {} : { communicationIds }),
    };
    validateParticipantCoherence(participant, event, path);
    return participant;
  });
  const allCommunicationIds = new Set<string>(recruitmentTouches.map((touch) => touch.communicationId));
  for (const participant of participants) {
    for (const kind of AUDIENCE_COMMUNICATION_KINDS) {
      const id = participant.communicationIds?.[kind] ?? JSON.stringify(["audience", participant.participantId, kind]);
      if (allCommunicationIds.has(id)) fail(`duplicate communication identity: ${id}.`);
      allCommunicationIds.add(id);
    }
  }
  return {
    calculationInstantEpochMs, timeZone, standardId: STANDARD_ID, standardVersion: STANDARD_VERSION,
    event, recruitmentTouches, participants,
  };
}

function validateParticipantCoherence(
  participant: AudienceParticipantInput,
  event: {
    readonly operationalStatus: string;
    readonly actualEndsAtEpochMs: number | null;
    readonly observedAtEpochMs: number;
    readonly cancellationTriggeredAtEpochMs: number | null;
  },
  path: string,
): void {
  const instantFields = [
    participant.registrationAtEpochMs, participant.attendanceAvailableAtEpochMs,
    participant.waitlistedAtEpochMs, participant.waitlistPromotionTriggeredAtEpochMs,
    participant.waitlistClosureTriggeredAtEpochMs, participant.participantCancellationTriggeredAtEpochMs,
  ];
  if (instantFields.some((value) => value !== null && value > event.observedAtEpochMs)) fail(`${path} contains a trigger after observation.`);
  if (participant.registrationStatus === "registered" && participant.registrationAtEpochMs === null) fail(`${path} registered state requires registrationAtEpochMs.`);
  if (participant.registrationStatus === "not_registered" && participant.registrationAtEpochMs !== null) fail(`${path} not_registered state cannot have registrationAtEpochMs.`);
  if (participant.registrationStatus === "waitlisted" && participant.waitlistedAtEpochMs === null) fail(`${path} waitlisted state requires waitlistedAtEpochMs.`);
  if (participant.registrationStatus === "cancelled") {
    if (participant.registrationAtEpochMs === null) fail(`${path} cancelled state requires registrationAtEpochMs.`);
    if (participant.participantCancellationTriggeredAtEpochMs === null) fail(`${path} cancelled state requires participantCancellationTriggeredAtEpochMs.`);
    if (participant.participantCancellationTriggeredAtEpochMs < participant.registrationAtEpochMs) {
      fail(`${path} cancellation trigger cannot precede registration.`);
    }
  }
  if (participant.attendanceState !== "unknown") {
    if (participant.registrationStatus !== "registered") fail(`${path} attended/absent state requires registered status.`);
    if (event.operationalStatus !== "completed") fail(`${path} attended/absent state is valid only for a completed event.`);
    if (participant.attendanceAvailableAtEpochMs === null) fail(`${path} attended/absent state requires attendanceAvailableAtEpochMs.`);
    if (event.actualEndsAtEpochMs !== null && participant.attendanceAvailableAtEpochMs < event.actualEndsAtEpochMs) {
      fail(`${path} attendance availability cannot precede the completed event end.`);
    }
  }
  if (participant.registrationAtEpochMs !== null && event.actualEndsAtEpochMs !== null
    && participant.registrationAtEpochMs > event.actualEndsAtEpochMs) {
    fail(`${path} registration cannot occur after the completed event end.`);
  }
  if (participant.registrationAtEpochMs !== null && participant.attendanceAvailableAtEpochMs !== null
    && participant.attendanceAvailableAtEpochMs < participant.registrationAtEpochMs) {
    fail(`${path} attendance availability cannot precede registration.`);
  }
  if (event.cancellationTriggeredAtEpochMs !== null) {
    if (participant.registrationAtEpochMs !== null
      && participant.registrationAtEpochMs > event.cancellationTriggeredAtEpochMs) {
      fail(`${path} registration cannot occur after event cancellation.`);
    }
    if (participant.waitlistedAtEpochMs !== null
      && participant.waitlistedAtEpochMs > event.cancellationTriggeredAtEpochMs) {
      fail(`${path} waitlisting cannot occur after event cancellation.`);
    }
    if (participant.waitlistPromotionTriggeredAtEpochMs !== null) {
      fail(`${path} waitlist promotion is invalid for a cancelled event.`);
    }
  }
  if (participant.waitlistPromotionTriggeredAtEpochMs !== null && participant.waitlistClosureTriggeredAtEpochMs !== null) {
    fail(`${path} waitlist promotion and closure triggers are mutually exclusive.`);
  }
  if (participant.registrationStatus !== "waitlisted"
    && (participant.waitlistPromotionTriggeredAtEpochMs !== null || participant.waitlistClosureTriggeredAtEpochMs !== null)) {
    fail(`${path} waitlist triggers require waitlisted status.`);
  }
  if (participant.waitlistedAtEpochMs !== null) {
    if (participant.waitlistPromotionTriggeredAtEpochMs !== null
      && participant.waitlistPromotionTriggeredAtEpochMs < participant.waitlistedAtEpochMs) {
      fail(`${path} waitlist promotion trigger cannot precede waitlisting.`);
    }
    if (participant.waitlistClosureTriggeredAtEpochMs !== null
      && participant.waitlistClosureTriggeredAtEpochMs < participant.waitlistedAtEpochMs) {
      fail(`${path} waitlist closure trigger cannot precede waitlisting.`);
    }
  }
  if (participant.neutralVariantApproved && participant.attendanceState !== "unknown") fail(`${path} neutral approval requires unknown attendance.`);
  if (participant.audienceClass === "customer" && participant.qaTestSendRequested) fail(`${path} QA test-send planning is only valid for internal/test audiences.`);
}