import { createHash } from "node:crypto";
import { STANDARD_ID, STANDARD_VERSION } from "../webinar-standard-catalog/types";
import type { DeliverableArtifact, DeliverableCommunication, DeliverableEvaluationContext } from "../webinar-standard-evaluation/deliverable-types";
import type { ConfiguredRecruitmentTouch } from "../webinar-standard-evaluation/scheduling-types";
import type { AssemblySource, BaseFacts, InputGap, MappingIssue, SourceReference, Subcontexts } from "./types";
import { identifier, immutable, instant, issue } from "./common";

type Row = Readonly<Record<string, unknown>>;
/** Version is a deterministic content identity, NOT a claim of publication or review. */
const version = (row: Row) => {
  const normalize = (value: unknown): unknown => Array.isArray(value) ? (value.every(item => item && typeof item === "object" && typeof item.id === "string")
    ? [...value].sort((a, b) => a.id.localeCompare(b.id)) : value).map(normalize)
    : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : value;
  return createHash("sha256").update(JSON.stringify(normalize(row))).digest("hex");
};
const text = (value: unknown): string | null => typeof value === "string" ? value : null;

/**
 * Existing user-owned content and configuration, never operational evidence.
 * A drafted message/body, asset brief, or page requirements map as planned artifacts.
 * QA flags describe local checkboxes, not canonical reviewed/versioned evidence.
 */
export function adaptPersistedApplication(source: AssemblySource): {
  subcontexts: Subcontexts; baseFacts: Partial<BaseFacts>;
  missingInputs: InputGap[]; mappingErrors: MappingIssue[]; sourceReferences: SourceReference[];
} {
  const output = { subcontexts: {} as Subcontexts, baseFacts: {} as Partial<BaseFacts>, missingInputs: [] as InputGap[], mappingErrors: [] as MappingIssue[], sourceReferences: [] as SourceReference[] };
  const p = source.persisted;
  if (!p) return immutable(output);
  const eventId = source.occurrence.id;
  const ref = (kind: string, row: Row): SourceReference => ({ sourceType: kind, sourceId: typeof row.id === "string" ? row.id : eventId });
  const gap = (field: string, reason: string, reference: SourceReference) => output.missingInputs.push({ field, reason, sourceReference: reference });
  const error = (field: string, message: string, reference: SourceReference) => output.mappingErrors.push({ ...issue(field, message), sourceReference: reference });
  for (const [kind, rows] of Object.entries(p)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Row[]) {
      if (row.campaign_id !== source.campaign.id) error(kind, "Persisted record campaign mismatch", ref(kind, row));
      if (row.session_id !== undefined && row.session_id !== eventId) error(kind, "Persisted record occurrence mismatch", ref(kind, row));
      if (row.activity_id !== undefined && row.activity_id !== source.activity.id) error(kind, "Persisted record activity mismatch", ref(kind, row));
      if (identifier(row.id)) output.sourceReferences.push(ref(kind, row));
    }
  }
  if (p.activity.id !== source.activity.id || p.activity.campaign_id !== source.campaign.id) error("activity", "Persisted activity scope mismatch", ref("activity", p.activity));
  for (const [kind, rows, field, parent] of [
    ["details", p.details, "communication_id", p.applicationCommunications],
    ["communicationCtas", p.communicationCtas, "communication_id", p.applicationCommunications],
    ["communicationCtas", p.communicationCtas, "cta_id", p.ctas],
    ["communicationLandingPages", p.communicationLandingPages, "communication_id", p.applicationCommunications],
    ["communicationLandingPages", p.communicationLandingPages, "landing_page_id", p.destinations],
    ["landingPageAssets", p.landingPageAssets, "landing_page_id", p.destinations],
    ["landingPageAssets", p.landingPageAssets, "content_asset_id", p.assets],
  ] as const) {
    for (const row of rows) if (!parent.some(candidate => candidate.id === row[field])) error(kind, `Dangling ${field} reference`, ref(kind, row));
  }
  const setup = {
    eventId, snapshotId: version({ occurrence: source.occurrence, activity: p.activity }),
    complete: false, activityType: "Webinar",
    title: source.occurrence.name, eventLocalDate: source.occurrence.sessionDate,
    localStartTime: source.occurrence.startTime, durationMinutes: source.occurrence.durationMinutes,
    timeZone: source.occurrence.timezone, platform: source.occurrence.platform,
    intendedAudience: text(p.activity.audience), owner: text(p.activity.owner),
  };
  output.subcontexts = { setup };
  const artifacts: DeliverableArtifact[] = [];
  const communications: DeliverableCommunication[] = [];
  const touches: ConfiguredRecruitmentTouch[] = [];
  const dates: number[] = [];
  const artifact = (row: Row, role: DeliverableArtifact["role"], content: string, communicationId: string | null, assetId: string | null, destinationId: string | null, id = row.id) => {
    if (!identifier(id)) { error(role, "Stable deliverable identity required", ref(role, row)); return; }
    if (typeof row.updated_at !== "string") { gap(`${role}.${id}.version`, "Persisted modification instant missing; cannot bind artifact version", ref(role, row)); return; }
    let modified: number;
    try { modified = instant(row.updated_at); } catch { error(`${role}.${id}.updated_at`, "Invalid persisted modification instant", ref(role, row)); return; }
    dates.push(modified);
    artifacts.push({
      deliverableId: id, role, eventId, occurrenceId: eventId,
      contentVersion: version(row), versionCreatedAtEpochMs: modified,
      lifecycle: "planned", communicationId, assetId, destinationId, content,
      owner: text(row.owner), dueAtEpochMs: null, speakerConfirmed: null, reviews: [],
    });
  };
  const followUp: BaseFacts["followUp"] = { attended: null, absent: null, distinctContentConfirmation: null };
  for (const row of [...p.communications].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (!identifier(row.id) || typeof row.key !== "string") { error("communications", "Stable ID and key required", ref("communications", row)); continue; }
    const app = p.applicationCommunications.find(c => c.id === row.communication_id);
    const detail = p.details.find(d => d.communication_id === row.communication_id);
    const variant = row.key === "attendee_followup" ? "attended" : row.key === "no_show_followup" ? "absent" : row.key === "neutral_followup" ? "neutral" : null;
    const recruitment = ["recruitment_1", "recruitment_2", "recruitment_3", "final_recruitment"].includes(row.key);
    const kind = variant ? "follow_up" : recruitment ? "recruitment" : row.key === "registration_confirmation" ? "confirmation" : ["registered_reminder", "final_reminder"].includes(row.key) ? "reminder" : null;
    if (kind && typeof detail?.channel === "string" && detail.channel.length) {
      communications.push({ communicationId: row.id, eventId, occurrenceId: eventId, kind, channel: detail.channel, variant, audienceState: variant === "attended" ? "attended" : variant === "absent" ? "absent" : variant === "neutral" ? "unknown" : recruitment ? "non_registrant" : "registrant" });
    } else gap(`communications.${row.id}.channel`, "Canonical channel is not supplied by delivery details; communication.type is not assumed to be a channel", ref("communication-details", detail ?? row));
    if (detail) {
      for (const field of ["qa_audience_confirmed", "qa_content_approved", "qa_links_verified", "qa_timing_verified", "qa_owner_confirmed"]) {
        if (typeof detail[field] !== "boolean") error(`details.${field}`, "QA checkbox must be boolean", ref("communication-details", detail));
      }
      gap(`details.${detail.id}.qaEvidence`, "Persisted QA flags retained in source fingerprint but lack canonical reviewer/version/scope metadata; no test or approval evidence inferred", ref("communication-details", detail));
    }
    const variants = row.variants;
    if (Array.isArray(variants)) {
      for (const entry of variants) {
        if (!entry || typeof entry !== "object" || !Number.isInteger(entry.slot) || !entry.content || typeof entry.content.body !== "string") { error(`communications.${row.id}.variants`, "Explicit slot and body required", ref("webinar-standard-communication", row)); continue; }
        if (variants.length === 1 && communications.some(communication => communication.communicationId === row.id)) {
          artifact({ ...row, owner: app?.owner ?? null }, "message", entry.content.body, row.id, null, null, `${row.id}:slot:${entry.slot}`);
        }
      }
      if (variants.length > 1) gap(`communications.${row.id}.artifact`, "Canonical deliverable snapshot requires one current message per communication; multiple audience slots cannot be collapsed", ref("webinar-standard-communication", row));
      if (variants.length && !communications.some(communication => communication.communicationId === row.id)) gap(`communications.${row.id}.artifact`, "Content is persisted but canonical message relationship lacks channel information", ref("webinar-standard-communication", row));
      if (variant === "attended" || variant === "absent") {
        if (variants.length === 1 && typeof variants[0]?.content?.body === "string" && Number.isInteger(variants[0]?.slot)) {
          const links = p.communicationLandingPages.filter(link => link.communication_id === row.communication_id);
          const ctas = p.communicationCtas.filter(link => link.communication_id === row.communication_id)
            .map(link => p.ctas.find(cta => cta.id === link.cta_id)).filter((cta): cta is Row => !!cta);
          const destinations = [...new Set([...links.map(link => link.landing_page_id), ...ctas.map(cta => cta.landing_page_id)].filter(identifier))];
          const destinationId = destinations.length === 1 ? destinations[0]! : null;
          // Only a single slot is unambiguous; never silently choose between configured variants.
          Object.assign(followUp, { [variant]: { variantId: `${row.id}:slot:${variants[0].slot}`, messageContent: variants[0].content.body, destinationId } });
          if (destinations.length > 1) gap(`followUp.${variant}.destination`, "Multiple linked landing pages; no authoritative primary destination", ref("webinar-standard-communication", row));
          if (destinations.length === 0) gap(`followUp.${variant}.destination`, "No linked stable destination ID; URL text is not destination identity", ref("webinar-standard-communication", row));
        } else gap(`followUp.${variant}`, "No unambiguous single configured content slot", ref("webinar-standard-communication", row));
      }
    } else gap(`communications.${row.id}.content`, "Configured content slots unavailable", ref("webinar-standard-communication", row));
    if (recruitment) {
      if (!["scheduled", "adjusted", "skipped"].includes(String(row.schedule_status))) {
        gap(`scheduling.${row.id}`, "Persisted state has no unambiguous canonical recruitment disposition", ref("webinar-standard-communication", row));
      } else {
        try {
          touches.push({ identity: row.key as ConfiguredRecruitmentTouch["identity"], communicationId: row.id, disposition: row.schedule_status === "skipped" ? "omitted" : row.schedule_status === "adjusted" ? "adjusted" : "scheduled", scheduledAtEpochMs: row.effective_scheduled_at == null ? null : instant(row.effective_scheduled_at as string) });
        } catch { error(`scheduling.${row.id}`, "Invalid persisted schedule instant", ref("webinar-standard-communication", row)); }
      }
    }
  }
  for (const row of p.assets) {
    if (typeof row.brief === "string") artifact(row, "brief", row.brief, null, text(row.id), null);
    else gap(`assets.${row.id}.brief`, "Asset brief not supplied", ref("asset", row));
  }
  for (const row of p.destinations) {
    // Existing page copy requirements are not proof that a live registration page exists.
    if (typeof row.supporting_copy_needs === "string") artifact(row, "plan", row.supporting_copy_needs, null, null, text(row.id));
    else gap(`destinations.${row.id}.content`, "Page requirements not supplied", ref("landing-page", row));
  }
  const snapshotVersion = version({ communications: p.communications, details: p.details, assets: p.assets, destinations: p.destinations });
  let snapshotCreatedAtEpochMs = dates.length ? Math.max(...dates) : 0;
  if (!dates.length) {
    try { snapshotCreatedAtEpochMs = instant(source.calculationInstant); }
    catch { error("calculationInstant", "Invalid calculation instant for empty planning snapshot", { sourceType: "webinar-session", sourceId: eventId }); }
  }
  const deliverables: DeliverableEvaluationContext = {
    standardId: STANDARD_ID, standardVersion: STANDARD_VERSION, eventId, occurrenceId: eventId,
    snapshotVersion, snapshotCreatedAtEpochMs,
    complete: false, activityType: "Webinar", evaluationStage: null,
    communications, artifacts: artifacts.sort((a, b) => a.deliverableId.localeCompare(b.deliverableId)),
    prerequisites: [], supportingContentInventoryEvidence: null,
    facts: { capacitySet: null, capacityReachable: null, objectiveCallsForHandraiser: null, absentHandraiserAppropriate: null, supportingChannelsUsed: null, accessibilityRequired: null, salesAdjacent: null, waitlistInUse: null, qaSendRequested: null, recordingAvailability: null, captureInUse: null },
  };
  output.subcontexts = { ...output.subcontexts, deliverables,
    scheduling: { occurrenceId: eventId, timeZone: source.occurrence.timezone, recruitmentPlan: null,
      configuredPlan: { snapshotId: version({ communications: p.communications }), eventId, occurrenceId: eventId, standardId: STANDARD_ID, standardVersion: STANDARD_VERSION, complete: false, touches, surfacedWarnings: [] },
      creationSnapshot: null, suppression: null, omissionDisplay: null },
  };
  output.baseFacts = { followUp };
  gap("deliverables.evidence", "Planning inventory present; produced artifacts, scoped reviews and complete inventory evidence unavailable", { sourceType: "activity", sourceId: source.activity.id });
  gap("scheduling.recruitmentPlan", "Persisted configuration present; canonical planner result, original creation basis and suppression observations unavailable", { sourceType: "webinar-session", sourceId: eventId });
  if (!followUp.attended) gap("followUp.attended", "Attended variant content not established", { sourceType: "webinar-session", sourceId: eventId });
  if (!followUp.absent) gap("followUp.absent", "Absent variant content not established", { sourceType: "webinar-session", sourceId: eventId });
  gap("followUp.distinctContentConfirmation", "Configured content is not human review evidence", { sourceType: "webinar-session", sourceId: eventId });
  return immutable(output);
}