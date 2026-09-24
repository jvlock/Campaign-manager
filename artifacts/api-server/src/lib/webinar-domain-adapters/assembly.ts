import { STANDARD_ID, STANDARD_VERSION } from "../webinar-standard-catalog/types";
import type { EvaluationContext } from "../webinar-standard-evaluation/types";
import type { AssemblySource, AssemblyResult, Classification, InputGap, MappingIssue, Subcontexts } from "./types";
import { identifier, immutable, instant, issue, localScheduledInstant } from "./common";
import { adaptParticipant } from "./participant";
import { adaptPlannedCommunication } from "./communication";
import { adaptPersistedApplication } from "./persisted";

/** Baseline inventory: runtime gaps supplement rather than overwrite these source classifications. */
export const INPUT_CLASSIFICATIONS: AssemblyResult["classifications"] = Object.freeze([
  ["campaignIdentity", "directly-persisted"], ["journeyIdentity", "not-applicable"],
  ["activityIdentity", "directly-persisted"], ["webinarIdentity", "derived-deterministically"],
  ["occurrence", "directly-persisted"], ["standardVersion", "internal-service"],
  ["calculationInstant", "internal-service"], ["eventStatus", "missing-incomplete"],
  ["participantStatus", "customer-data-prohibited"], ["attendance", "customer-data-prohibited"],
  ["registrationInstant", "directly-persisted"], ["cancellation", "missing-incomplete"],
  ["waitlist", "missing-incomplete"], ["recruitmentTouches", "directly-persisted"],
  ["reminderObligations", "internal-service"], ["followUpVariants", "directly-persisted"],
  ["scheduledInstants", "derived-deterministically"], ["communicationsAndDeliverables", "directly-persisted"],
  ["assetsAndDestinations", "directly-persisted"], ["operationalObservations", "external-unavailable"],
  ["qaEvidence", "missing-incomplete"], ["foundationObservations", "external-unavailable"],
  ["exceptions", "directly-persisted"], ["priorReadiness", "internal-service"],
  ["completionInputs", "missing-incomplete"], ["measurementObligations", "missing-incomplete"],
].map(([field, classification]) => Object.freeze({ field: field!, classification: classification as Classification })));

/** Structural scope checks only; rule-specific evidence sufficiency stays in the engine. */
function checkSubcontexts(source: Subcontexts, eventId: string, campaignId: string): MappingIssue[] {
  const errors: MappingIssue[] = [];
  function visit(value: unknown, path: string): void {
    if (value == null) return;
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const field = `${path}.${key}`;
      if (["eventId", "occurrenceId"].includes(key) && child !== eventId) errors.push(issue(field, "Cross-occurrence observation rejected", "SCOPE_MISMATCH"));
      if (key === "campaignId" && child !== campaignId) errors.push(issue(field, "Cross-campaign observation rejected", "SCOPE_MISMATCH"));
      if (key === "standardId" && child !== STANDARD_ID || key === "standardVersion" && child !== STANDARD_VERSION) errors.push(issue(field, "Exact standard binding required", "STANDARD_MISMATCH"));
      if (key.endsWith("EpochMs") && child !== null && (typeof child !== "number" || !Number.isSafeInteger(child))) errors.push(issue(field, "Invalid epoch milliseconds"));
      if (key === "complete" && typeof child !== "boolean") errors.push(issue(field, "Completeness must be explicit boolean"));
      if (key === "identityVerified" && child !== false) errors.push(issue(field, "Development attribution cannot verify identity"));
      visit(child, field);
    }
  }
  const required: Record<keyof Subcontexts, readonly string[]> = {
    setup: ["eventId", "snapshotId", "complete", "activityType"],
    measurementPlan: ["eventId", "snapshotId", "complete"],
    findingEvidence: ["eventId", "snapshotId", "complete", "standardId", "standardVersion", "observedAtEpochMs"],
    scheduling: ["occurrenceId", "timeZone", "recruitmentPlan", "configuredPlan", "creationSnapshot", "suppression", "omissionDisplay"],
    audience: ["occurrenceId", "input", "plan"],
    deliverables: ["eventId", "occurrenceId", "standardId", "standardVersion", "snapshotVersion", "snapshotCreatedAtEpochMs", "complete", "communications", "artifacts", "prerequisites", "facts"],
    governed: ["environment", "objective", "exclusion"],
    completionFollowUp: ["eventId", "occurrenceId", "standardId", "standardVersion", "snapshotId", "observedAtEpochMs", "timeZone", "actualEventEndAtEpochMs", "participantId", "attendanceState", "sends"],
    completionStage: ["eventId", "occurrenceId"],
    completionSnapshot: ["eventId", "occurrenceId", "standardId", "standardVersion", "calculatedAtEpochMs", "registryFingerprint", "exceptionSnapshotId", "canonicalRuleIds", "results", "exceptions", "exceptionClaims", "evidenceSnapshot", "operationalObligations"],
  };
  for (const key of Object.keys(required) as (keyof Subcontexts)[]) {
    const value = source[key];
    if (value == null) continue;
    if (typeof value !== "object" || Array.isArray(value)) { errors.push(issue(key, "Expected context record")); continue; }
    for (const field of required[key]) if (!(field in value)) errors.push(issue(`${key}.${field}`, "Required structural field absent"));
  }
  visit(source, "subcontexts");
  if (source.governed && source.governed.environment !== "test") errors.push(issue("governed.environment", "Only synthetic test observations permitted"));
  for (const context of [source.governed?.objective, source.governed?.exclusion]) {
    if (context && !Array.isArray(context.observations)) { errors.push(issue("governed.observations", "Explicit observation array required")); continue; }
    for (const observation of context?.observations ?? []) {
      if (!observation || typeof observation !== "object") { errors.push(issue("governed.observations", "Observation record required")); continue; }
      if (observation.source !== "foundation" || observation.environment !== "test") errors.push(issue("governed.observations", "Manual values and production observations cannot substitute for Foundation output"));
    }
  }
  return errors;
}

export function assembleEvaluationInput(source: AssemblySource): AssemblyResult {
  const mappingErrors: MappingIssue[] = [];
  const missingInputs: InputGap[] = [];
  const unavailableInputs: InputGap[] = [];
  const sourceReferences = [
    { sourceType: "campaign", sourceId: source.campaign.id },
    { sourceType: "activity", sourceId: source.activity.id },
    { sourceType: "webinar-session", sourceId: source.occurrence.id },
  ];
  const gap = (field: string, reason: string): InputGap => ({ field, reason, sourceReference: sourceReferences[2]! });
  for (const [field, value] of [["campaign.id", source.campaign.id], ["activity.id", source.activity.id], ["occurrence.id", source.occurrence.id]]) {
    if (!identifier(value)) mappingErrors.push(issue(field!, "Stable source identifier required"));
  }
  if (source.activity.campaignId !== source.campaign.id || source.occurrence.campaignId !== source.campaign.id || source.occurrence.activityId !== source.activity.id) mappingErrors.push(issue("hierarchy", "Campaign, Activity and occurrence must share explicit scope", "SCOPE_MISMATCH"));
  if (!["webinar", "Webinar"].includes(source.activity.activityType)) mappingErrors.push(issue("activity.activityType", "Webinar must be an Activity of type webinar"));
  if (source.binding.standardId !== STANDARD_ID || source.binding.standardVersion !== STANDARD_VERSION) mappingErrors.push(issue("binding", "Exact canonical binding required; templateVersion is not standardVersion", "STANDARD_MISMATCH"));
  let observedAtEpochMs = 0;
  let startsAtEpochMs: number | null = null;
  try { observedAtEpochMs = instant(source.calculationInstant); } catch (error) { mappingErrors.push(issue("calculationInstant", String(error))); }
  try { startsAtEpochMs = localScheduledInstant(source.occurrence.sessionDate, source.occurrence.startTime, source.occurrence.timezone); } catch (error) { mappingErrors.push(issue("occurrence.schedule", String(error), "AMBIGUOUS_OR_INVALID_LOCAL_TIME")); }
  if (!Number.isFinite(source.occurrence.durationMinutes) || source.occurrence.durationMinutes <= 0) mappingErrors.push(issue("occurrence.durationMinutes", "Positive duration required"));
  if (source.eventStatus == null) missingInputs.push(gap("eventStatus", "Planning status is not event lifecycle authority"));
  else if (!["draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled"].includes(source.eventStatus)) mappingErrors.push(issue("eventStatus", "Unknown event lifecycle"));
  const participant = source.participant ? adaptParticipant(source.participant, source.occurrence.id) : null;
  mappingErrors.push(...(participant?.mappingErrors ?? []));
  if (source.participant) sourceReferences.push({ sourceType: "synthetic-participant", sourceId: source.participant.participantId });
  else missingInputs.push(gap("participant", "No synthetic per-registrant fixture supplied; customer data prohibited"));
  if (source.participant && source.participant.registrationAtEpochMs == null) missingInputs.push(gap("participant.registrationInstant", "Registration instant unavailable; creation time is not a substitute"));
  if (source.participant?.attendanceState == null) missingInputs.push(gap("participant.attendance", "No per-registrant attendance observation; remains unknown"));
  const communications = [];
  const ids = new Set<string>();
  for (const record of source.communications ?? []) {
    sourceReferences.push({ sourceType: "webinar-standard-communication", sourceId: record.id });
    if (ids.has(record.id)) mappingErrors.push(issue("communications.id", "Duplicate stable identifier", "AMBIGUOUS_MAPPING"));
    ids.add(record.id);
    const adapted = adaptPlannedCommunication(record, source.occurrence.id);
    mappingErrors.push(...adapted.mappingErrors);
    if (adapted.value) communications.push(adapted.value);
    if (record.recipientIds == null) missingInputs.push(gap(`communications.${record.id}.recipientIds`, "No executed or planned recipient population supplied"));
  }
  if (source.communications == null) missingInputs.push(gap("communications", "Planning communication records not supplied"));
  const persisted = adaptPersistedApplication(source);
  mappingErrors.push(...persisted.mappingErrors);
  missingInputs.push(...persisted.missingInputs);
  sourceReferences.push(...persisted.sourceReferences);
  const subcontexts = { ...persisted.subcontexts, ...source.subcontexts };
  mappingErrors.push(...checkSubcontexts(subcontexts, source.occurrence.id, source.campaign.id));
  for (const [field, value] of Object.entries(subcontexts)) {
    if (value && typeof value === "object") {
      const record = value as unknown as Record<string, unknown>;
      for (const key of ["snapshotId", "snapshotVersion", "registryFingerprint"]) {
        if (identifier(record[key])) sourceReferences.push({ sourceType: field, sourceId: record[key] });
      }
    }
  }
  for (const key of ["measurementPlan", "findingEvidence", "scheduling", "audience", "deliverables", "completionFollowUp", "completionStage", "completionSnapshot"] as const) {
    if (subcontexts[key] == null) missingInputs.push(gap(key, "Canonical source snapshot not supplied"));
  }
  if (!subcontexts.governed?.objective) unavailableInputs.push(gap("governed.objective", "Foundation objective observations unavailable (WEB-SETUP-003); connector not connected"));
  if (!subcontexts.governed?.exclusion) unavailableInputs.push(gap("governed.exclusion", "Foundation exclusion observations unavailable (WEB-REC-010); connector not connected"));
  for (const [name, governed] of [["objective", subcontexts.governed?.objective], ["exclusion", subcontexts.governed?.exclusion]] as const) {
    if (governed && (!Array.isArray(governed.observations) || governed.observations.length === 0 || governed.observations.every(observation => observation?.status !== "success"))) {
      unavailableInputs.push(gap(`governed.${name}.observations`, "No successful supplied Foundation output; connector not connected"));
    }
  }
  const facts = { ...persisted.baseFacts, ...source.baseFacts };
  for (const key of ["registrationFlowTest", "joinLinkOrVenueTest"] as const) {
    const confirmation = facts[key];
    if (confirmation != null && (typeof confirmation.confirmed !== "boolean" || typeof confirmation.evidence !== "string")) mappingErrors.push(issue(key, "Explicit confirmation boolean and evidence string required"));
  }
  if (facts.consent) {
    for (const key of ["required", "languageAttached"] as const) {
      if (facts.consent[key] !== null && typeof facts.consent[key] !== "boolean") mappingErrors.push(issue(`consent.${key}`, "Expected boolean or explicit null"));
    }
  }
  // Simple string values cannot substantiate versioned Foundation provenance.
  if (facts.governance && (facts.governance.internalName || facts.governance.campaignCode || facts.governance.taxonomyValues?.length)) {
    mappingErrors.push(issue("governance", "Unversioned values cannot substitute for governed observations; supply canonical governed subcontext", "PROVENANCE_REQUIRED"));
  }
  for (const key of ["registrationFlowTest", "joinLinkOrVenueTest", "consent", "followUp", "governance"] as const) {
    if (facts[key] == null) missingInputs.push(gap(key, "Explicit canonical facts not supplied"));
  }
  if (!facts.governance) unavailableInputs.push(gap("governance", "Foundation naming, campaign-code and taxonomy evidence unavailable"));
  const context: EvaluationContext | null = mappingErrors.length || source.eventStatus == null ? null : {
    ...subcontexts,
    setup: subcontexts.setup ?? {
      eventId: source.occurrence.id,
      snapshotId: source.occurrence.id,
      complete: false,
      // Persisted activity-type key is lowercase; canonical contexts use the display discriminator.
      activityType: "Webinar",
      title: source.occurrence.name,
      eventLocalDate: source.occurrence.sessionDate,
      localStartTime: source.occurrence.startTime,
      durationMinutes: source.occurrence.durationMinutes,
      timeZone: source.occurrence.timezone,
      platform: source.occurrence.platform,
    },
    observedAtEpochMs,
    event: { eventId: source.occurrence.id, operationalStatus: source.eventStatus, startsAtEpochMs },
    participant: participant?.value ?? null,
    communications: communications.sort((a, b) => a.communicationId.localeCompare(b.communicationId)),
    registrationFlowTest: facts.registrationFlowTest ?? null,
    joinLinkOrVenueTest: facts.joinLinkOrVenueTest ?? null,
    consent: facts.consent ?? { required: null, languageAttached: null, confirmation: null },
    governance: facts.governance ?? { internalName: null, campaignCode: null, taxonomyValues: null },
    followUp: facts.followUp ?? { attended: null, absent: null, distinctContentConfirmation: null },
  };
  return immutable({
    context, sourceReferences: sourceReferences.sort((a, b) => `${a.sourceType}:${a.sourceId}`.localeCompare(`${b.sourceType}:${b.sourceId}`)),
    missingInputs: missingInputs.sort((a, b) => a.field.localeCompare(b.field)),
    unavailableInputs: unavailableInputs.sort((a, b) => a.field.localeCompare(b.field)),
    mappingErrors: mappingErrors.map(error => ({ ...error, sourceReference: error.sourceReference ?? sourceReferences.find(ref => ref.sourceType === "webinar-session")! }))
      .sort((a, b) => `${a.field}:${a.code}:${a.message}`.localeCompare(`${b.field}:${b.code}:${b.message}`)),
    classifications: source.participant ? INPUT_CLASSIFICATIONS.map(entry =>
      entry.field === "participantStatus"
        ? { ...entry, classification: "directly-persisted" as const }
        : entry.field === "attendance" ? { ...entry,
          classification: source.participant?.attendanceState && source.participant.attendanceState !== "unknown"
            ? "directly-persisted" as const : "missing-incomplete" as const }
          : entry)
      : INPUT_CLASSIFICATIONS,
  });
}