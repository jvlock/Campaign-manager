import type { AdapterResult, CommunicationContext, PlannedCommunicationSource } from "./types";
import { identifier, immutable, instant, issue } from "./common";

const recruitment = ["recruitment_1", "recruitment_2", "recruitment_3", "final_recruitment"];
const registrant = ["registration_confirmation", "registered_reminder", "final_reminder"];
export function adaptPlannedCommunication(source: PlannedCommunicationSource, eventId: string): AdapterResult<CommunicationContext> {
  if (!identifier(source.id) || source.sessionId !== eventId) return { value: null, mappingErrors: [issue("communications", "Identity or occurrence mismatch", "SCOPE_MISMATCH")] };
  const variant = source.key === "attendee_followup" ? "attended" : source.key === "no_show_followup" ? "absent" : source.key === "neutral_followup" ? "neutral" : null;
  const kind = variant ? "follow_up" : recruitment.includes(source.key) ? "recruitment" : registrant.includes(source.key) ? "registrant" : null;
  if (!kind) return { value: null, mappingErrors: [issue("communications.key", "Unknown key; no inferred meaning", "AMBIGUOUS_MAPPING")] };
  try {
    if (source.recipientIds && (!Array.isArray(source.recipientIds) || source.recipientIds.some(id => !identifier(id)))) throw new Error("Invalid recipient IDs");
    if (source.utmRequired != null && typeof source.utmRequired !== "boolean") throw new Error("Invalid UTM requirement");
    return immutable({ value: {
      communicationId: source.id, eventId, kind, variant, state: "planned",
      recipientIds: [...(source.recipientIds ?? [])].sort(),
      createdAtEpochMs: source.createdAt == null ? null : instant(source.createdAt),
      scheduledAtEpochMs: source.scheduledAt == null ? null : instant(source.scheduledAt),
      // A persisted plan is NEVER an execution receipt, even if its UI status says complete.
      recordedAtEpochMs: null, utmRequired: source.utmRequired ?? null, utm: null,
    }, mappingErrors: [] });
  } catch (error) {
    return { value: null, mappingErrors: [issue("communications", String(error))] };
  }
}