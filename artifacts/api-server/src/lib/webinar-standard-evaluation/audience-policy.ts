import type { AudienceMaterialChange } from "./audience-types";

const ALWAYS = new Set(["cancellation", "event_date", "start_time", "end_time", "time_zone",
  "format", "venue", "location", "platform", "join_link", "access_instructions"]);
const PUBLISHED = new Set(["title", "topic", "speakers", "agenda", "access_requirements"]);
const INTERNAL = new Set(["internal_owner", "internal_notes", "measurement_configuration", "internal_administration"]);
export function validMaterialChange(change: AudienceMaterialChange): boolean {
  return !!change && (ALWAYS.has(change.field) || PUBLISHED.has(change.field) || INTERNAL.has(change.field))
    && typeof change.participantFacingPublished === "boolean" && Number.isSafeInteger(change.changedAtEpochMs);
}
/** D2 only: obligation creation in the audience planner is not the operational SLA. */
export function materialNoticeRequired(change: AudienceMaterialChange): boolean {
  return ALWAYS.has(change.field) || (PUBLISHED.has(change.field) && change.participantFacingPublished);
}
export function materialNoticeDeadline(changeAt: number, eventStartsAt: number): number {
  return Math.min(changeAt + 3_600_000, eventStartsAt);
}