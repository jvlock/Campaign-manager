import type { AdapterResult, ParticipantContext, ParticipantSource } from "./types";
import { identifier, immutable, issue } from "./common";

export function adaptParticipant(source: ParticipantSource, eventId: string): AdapterResult<ParticipantContext> {
  const errors = [];
  if (source.isSynthetic !== true) errors.push(issue("participant.isSynthetic", "Only explicit synthetic fixtures are permitted", "CUSTOMER_DATA_PROHIBITED"));
  if (!identifier(source.participantId) || source.eventId !== eventId) errors.push(issue("participant", "Stable participant identity and matching occurrence required", "SCOPE_MISMATCH"));
  if (!["registered", "not_registered", "waitlisted", "cancelled"].includes(source.registrationStatus)) errors.push(issue("participant.registrationStatus", "Unknown registration status"));
  if (source.attendanceState != null && !["unknown", "attended", "absent"].includes(source.attendanceState)) errors.push(issue("participant.attendanceState", "Unknown attendance value"));
  if (!["customer", "internal", "test"].includes(source.audienceClass)) errors.push(issue("participant.audienceClass", "Explicit audience class required"));
  for (const field of ["includedInAttendance", "includedInReporting"] as const) {
    if (source[field] !== null && typeof source[field] !== "boolean") errors.push(issue(`participant.${field}`, "Expected boolean or explicit null"));
  }
  if (source.registrationStatus === "cancelled" && source.attendanceState === "absent") errors.push(issue("participant.attendanceState", "Cancellation cannot establish absence", "AMBIGUOUS_MAPPING"));
  const excluded = source.audienceClass !== "customer" || source.suppressed === true;
  if (errors.length) return { value: null, mappingErrors: errors };
  return immutable({ value: {
    participantId: source.participantId, eventId,
    registrationStatus: source.registrationStatus,
    attendanceState: source.attendanceState ?? "unknown",
    audienceClass: source.audienceClass,
    includedInAttendance: excluded ? false : source.includedInAttendance,
    includedInReporting: excluded ? false : source.includedInReporting,
  }, mappingErrors: [] });
}