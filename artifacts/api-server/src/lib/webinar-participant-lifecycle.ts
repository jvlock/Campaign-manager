import { createHash } from "node:crypto";
import { z } from "zod";
import { loadWebinarStandardCatalog } from "./webinar-standard-catalog";
import { STANDARD_ID, STANDARD_VERSION } from "./webinar-standard-catalog/types";
import { resolveWebinarRepositoryRoot, captureWebinarRelease } from "./webinar-release-provenance";
import { localScheduledInstant } from "./webinar-domain-adapters/common";
import { AUDIENCE_COMMUNICATION_KINDS, planWebinarAudience, type AudienceParticipantInput, type AudienceObligation, type WebinarAudiencePlan } from "./webinar-standard-audience";
import { assertOccurrenceEligibility, loadOccurrenceSources, type OccurrenceSources } from "./webinar-evaluation-sources";
import { simulationFingerprint, simulateWebinarInTransaction } from "./webinar-evaluation-orchestration";
import { WebinarPersistence, PersistenceConflict } from "./webinar-persistence";
import { simulationSnapshotSchema } from "./webinar-simulation-snapshot";

const uuid = z.string().uuid();
// Closed simulator-generated markers: caller-supplied names, emails and CRM IDs are never accepted.
const fixtureKey = z.string().regex(/^fixture-[0-9]{1,8}$/);
const instant = z.string().datetime({ offset: true });
const recruitmentKinds = ["recruitment_1", "recruitment_2", "recruitment_3", "final_recruitment"] as const;
const scope = z.object({ campaignId: uuid, sessionId: uuid, actorId: uuid,
  expectedRevision: z.number().int().nonnegative(), idempotencyKey: uuid, calculationAt: instant,
  audienceBranchId: uuid.optional() }).strict();
const fixtureCommand = scope.extend({
  fixtureKey, audienceBranchId: uuid, audienceClass: z.enum(["customer", "internal", "test"]),
}).strict();
export type SyntheticFixtureCommand = z.infer<typeof fixtureCommand>;
const lifecycleCommand = scope.extend({
  action: z.enum(["register", "waitlist", "promote", "cancel-registration", "cancel-occurrence", "complete-occurrence",
    "reschedule", "record-attendance", "reconcile-attendance", "seed-executed-history"]),
  personId: uuid.optional(), sourceReference: uuid,
  historyKind: z.enum([...AUDIENCE_COMMUNICATION_KINDS, ...recruitmentKinds]).optional(),
  historyExecutedAt: instant.optional(), syntheticMessageReference: uuid.optional(),
  attendance: z.enum(["attended", "absent"]).optional(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).optional(),
  timezone: z.string().min(1).max(80).optional(),
  /** An actual synthetic end observation; never inferred from an aggregate or an email. */
  actualEndAt: instant.optional(),
}).strict();
export type ParticipantLifecycleCommand = z.infer<typeof lifecycleCommand>;
/** Seeds a pre-existing synthetic fixture history fact; never sends or calls a provider.
 * Not part of the operational or HTTP transition action vocabulary.
 */
export async function seedSyntheticExecutedHistory(raw: Omit<ParticipantLifecycleCommand, "action"> & {
  personId: string; historyKind: NonNullable<ParticipantLifecycleCommand["historyKind"]>;
  historyExecutedAt: string; syntheticMessageReference: string;
}) {
  return transitionParticipantLifecycle({ ...raw, action: "seed-executed-history" });
}
type Registration = "not_registered" | "registered" | "waitlisted" | "cancelled";
type Attendance = "unknown" | "attended" | "absent";
type EventStatus = "draft" | "open_for_registration" | "scheduled" | "in_progress" | "completed" | "cancelled";
type Person = { id: string; audience_class: "customer" | "internal" | "test"; campaign_id: string; audience_branch_id: string };

function status(sources: OccurrenceSources): EventStatus {
  const latest = sources.records.filter(r => r.kind === "plan").at(-1)?.payload.eventStatus;
  if (latest === "draft" || latest === "open_for_registration" || latest === "scheduled"
    || latest === "in_progress" || latest === "completed" || latest === "cancelled") return latest;
  throw new PersistenceConflict("Missing or invalid authoritative event lifecycle status");
}
function registration(value: unknown): Registration {
  if (value === undefined) return "not_registered";
  if (value === "not_registered" || value === "registered" || value === "waitlisted" || value === "cancelled") return value;
  throw new PersistenceConflict("Invalid registration projection; communication paths fail closed");
}
function attendance(value: unknown): Attendance {
  if (value === undefined) return "unknown";
  // Legacy application projection calls canonical absence "no_show".
  if (value === "no_show") return "absent";
  if (value === "unknown" || value === "attended" || value === "absent") return value;
  throw new PersistenceConflict("Invalid attendance projection; communication paths fail closed");
}
/** Existing projection's closed enum only has registered/not_registered.
 * Waitlist and cancellation are distinguishable through the immutable source event,
 * not an invented enum value on the legacy projection.
 */
function projectedRegistration(sources: OccurrenceSources, personId: string): Registration {
  const row = sources.registrations.find(r => r.person_id === personId);
  const last = sources.lifecycleEvents.filter(e => e.person_id === personId
    && ["register", "waitlist", "promote", "cancel-registration"].includes(String(e.action))).at(-1);
  if (!last) return registration(row?.result);
  if (!row || row.result !== (["register", "promote"].includes(String(last.action)) ? "registered" : "not_registered"))
    throw new PersistenceConflict("Registration source history and current application projection disagree");
  switch (last.action) {
    case "register": case "promote": return "registered";
    case "waitlist": return "waitlisted";
    case "cancel-registration": return "cancelled";
    default: throw new PersistenceConflict("Invalid latest registration transition");
  }
}
function syntheticId(campaignId: string, fixture: string): string {
  const bytes = Buffer.from(createHash("sha256").update(`synthetic-participant-fixture:${campaignId}:${fixture}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function syntheticEmail(fixture: string): string {
  return `${fixture}@participants.test`;
}
function assertPerson(sources: OccurrenceSources, personId: string): Person {
  const person = sources.participants.find(p => p.id === personId);
  // A fixture not yet in this occurrence is verified directly in the transaction below.
  if (!person) throw new PersistenceConflict("Participant is not enrolled in this occurrence");
  if (person.is_synthetic !== true || person.provenance !== "synthetic-participant-simulator"
    || person.campaign_id !== sources.campaign.id || !["customer", "internal", "test"].includes(String(person.audience_class)))
    throw new PersistenceConflict("Only explicitly labelled synthetic fixtures are accepted");
  return person as Person;
}
function eventInstant(sources: OccurrenceSources): number {
  return localScheduledInstant(sources.occurrence.session_date, sources.occurrence.start_time, sources.occurrence.timezone);
}
function currentObligations(sources: OccurrenceSources, personId: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of sources.lifecycleObligations.filter(o => o.person_id === personId)) out[String(row.communication_id)] = row;
  return out;
}

/** Reuse the canonical audience planner; no second set of follow-up/recruitment eligibility rules. */
export async function planSyntheticPopulation(sources: OccurrenceSources, calculationAt: string): Promise<WebinarAudiencePlan> {
  const catalog = await loadWebinarStandardCatalog({ repositoryRoot: resolveWebinarRepositoryRoot() });
  const at = Date.parse(calculationAt), begins = eventInstant(sources), eventStatus = status(sources);
  const cancel = sources.lifecycleEvents.filter(e => e.action === "cancel-occurrence").at(-1);
  const change = sources.lifecycleEvents.filter(e => e.action === "reschedule").at(-1);
  const end = sources.lifecycleEvents.filter(e => e.payload && typeof e.payload === "object"
    && (e.payload as Record<string, unknown>).actualEndAt).at(-1);
  const actualEnd = end ? Date.parse(String((end.payload as Record<string, unknown>).actualEndAt)) : null;
  if (eventStatus === "completed" && actualEnd === null && sources.participants.length) {
    throw new PersistenceConflict("Completed occurrence lacks a synthetic actual-end source fact; follow-up cannot be classified");
  }
  const participants: AudienceParticipantInput[] = sources.participants.map(p => {
    const r = sources.registrations.find(row => row.person_id === p.id);
    const a = sources.attendances.find(row => row.person_id === p.id);
    const history = sources.lifecycleEvents.filter(e => e.person_id === p.id);
    const last = (action: string) => history.filter(e => e.action === action).at(-1);
    const regStatus = projectedRegistration(sources, String(p.id)), att = attendance(a?.result);
    if (a && !sources.lifecycleEvents.some(e => e.person_id === p.id
      && ["record-attendance", "reconcile-attendance"].includes(String(e.action))))
      throw new PersistenceConflict("Attendance projection lacks a synthetic source observation");
    const registeredAt = r?.first_registered_at ? Date.parse(String(r.first_registered_at)) : null;
    const lastWaitlist = last("waitlist"), lastCancellation = last("cancel-registration");
    const lastAttendance = [...history].reverse().find(e =>
      e.action === "record-attendance" || e.action === "reconcile-attendance");
    return {
      participantId: String(p.id), eventId: sources.occurrence.id, registrationStatus: regStatus,
      attendanceState: att, audienceClass: p.audience_class as AudienceParticipantInput["audienceClass"],
      recruitmentEligible: true, contactable: true, optedOut: false, invalidAddress: false,
      // No Foundation exclusion observation is available: unknown is NOT equivalent to false
      // for handoff, but is reported by the orchestration snapshot as unavailable.
      governedExclusion: false, registrationAtEpochMs: registeredAt,
      attendanceAvailableAtEpochMs: lastAttendance && att !== "unknown"
        ? Date.parse(String(lastAttendance.observed_at)) : null,
      waitlistedAtEpochMs: lastWaitlist ? Date.parse(String(lastWaitlist.observed_at)) : null,
      waitlistPromotionTriggeredAtEpochMs: null, waitlistClosureTriggeredAtEpochMs: null,
      participantCancellationTriggeredAtEpochMs: regStatus === "cancelled" && lastCancellation
        ? Date.parse(String(lastCancellation.observed_at)) : null,
      neutralVariantApproved: false, qaTestSendRequested: false, followUpAssetId: null,
      communicationIds: Object.fromEntries(sources.communications
        .filter(c => (AUDIENCE_COMMUNICATION_KINDS as readonly string[]).includes(c.key))
        .map(c => [c.key, c.id])),
    };
  });
  const touches = recruitmentKinds.map(identity => ({
    identity, communicationId: sources.communications.find(c => c.key === identity)?.id
      ?? `unconfigured-canonical-touch:${sources.occurrence.id}:${identity}`,
  }));
  return planWebinarAudience(catalog, {
    calculationInstantEpochMs: at, timeZone: sources.occurrence.timezone,
    standardId: STANDARD_ID, standardVersion: STANDARD_VERSION,
    event: { eventId: sources.occurrence.id, operationalStatus: eventStatus,
      startsAtEpochMs: begins, endsAtEpochMs: begins + sources.occurrence.duration_minutes * 60_000,
      actualEndsAtEpochMs: actualEnd, observedAtEpochMs: at,
      materialChangeTriggeredAtEpochMs: change ? Date.parse(String(change.observed_at)) : null,
      cancellationTriggeredAtEpochMs: cancel ? Date.parse(String(cancel.observed_at)) : null },
    recruitmentTouches: touches, participants,
  });
}

export interface SuppressionDecision {
  allowed: false; reasonCode: string; explanation: string; participantId: string;
  occurrenceId: string; communicationId: string | null; evaluatedAt: string;
  sourceReferences: readonly string[]; releaseFingerprint: string; operationalStatus: "simulation-only";
}
/** No available governed exclusion receipt or recipient proof means no customer handoff. */
export function decideSyntheticSuppression(plan: WebinarAudiencePlan, personId: string,
  communicationId: string | null, evaluatedAt: string, releaseFingerprint: string,
  history: readonly Record<string, unknown>[] = [], communicationKind?: string): SuppressionDecision {
  const person = plan.participants.find(p => p.participantId === personId);
  const obligation = person?.obligations.find(o => o.communicationId === communicationId);
  const recruitment = (communicationKind !== undefined && (recruitmentKinds as readonly string[]).includes(communicationKind))
    || (communicationId?.startsWith(`recruitment:${plan.eventId}:${personId}:`) ?? false);
  const reasonCode = communicationId && history.some(h => h.communication_id === communicationId
    && (h.disposition === "executed" || h.provenance === "synthetic-fixture-history"))
    ? "previously_executed" : !person ? "occurrence_mismatch"
    : person.state === "internal_or_test" ? "excluded_from_customer_communications"
    : recruitment && !person.recruitmentEligible
      ? person.suppressions.includes("registration_suppresses_recruitment") ? "registration_suppresses_recruitment"
        : person.suppressions.includes("waitlist_suppresses_recruitment") ? "waitlist_suppresses_recruitment"
        : person.suppressions[0] ?? "participant_state_suppresses_recruitment"
    : !communicationId ? "communication_identity_unavailable"
    : !obligation ? "communication_not_in_canonical_plan"
    : obligation.disposition === "omitted" ? "canonical_obligation_omitted"
    : obligation.variant && !obligation.assetId ? "approved_follow_up_asset_unavailable"
    : "governed_exclusion_observation_unavailable";
  return { allowed: false, reasonCode,
    explanation: reasonCode === "governed_exclusion_observation_unavailable"
      ? "A missing governed exclusion observation cannot authorize customer handoff."
      : `Communication prohibited: ${reasonCode}.`,
    participantId: personId, occurrenceId: plan.eventId, communicationId,
    evaluatedAt, sourceReferences: [plan.eventId, personId], releaseFingerprint,
    operationalStatus: "simulation-only" };
}

/** Fixture labels are closed, non-PII identifiers; never accepts an email/name/import. */
export async function createSyntheticParticipant(raw: SyntheticFixtureCommand) {
  const input = fixtureCommand.parse(raw);
  return new WebinarPersistence().withEvaluationTransaction(input, async client => {
    const sources = await loadOccurrenceSources(client, input.campaignId, input.sessionId);
    assertOccurrenceEligibility(sources);
    const existing = await client.query(`SELECT f.person_id,f.audience_class,p.audience_branch_id
      FROM webinar_synthetic_fixtures f JOIN webinar_people p ON p.id=f.person_id
      WHERE f.campaign_id=$1 AND f.fixture_key=$2`, [input.campaignId, input.fixtureKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].audience_class !== input.audienceClass || existing.rows[0].audience_branch_id !== input.audienceBranchId)
        throw new PersistenceConflict("Fixture key reused with different audience configuration");
      return { personId: existing.rows[0].person_id as string, fixtureKey: input.fixtureKey,
        syntheticEmail: syntheticEmail(input.fixtureKey), replayed: true as const };
    }
    if (sources.binding!.revision !== input.expectedRevision) throw new PersistenceConflict("Occurrence revision changed");
    const branch = await client.query(`SELECT 1 FROM audiences WHERE id=$1 AND campaign_id=$2`,
      [input.audienceBranchId, input.campaignId]);
    if (!branch.rowCount) throw new PersistenceConflict("Audience branch is outside the synthetic campaign");
    const personId = syntheticId(input.campaignId, input.fixtureKey);
    await client.query(`INSERT INTO webinar_people(id,campaign_id,audience_branch_id,name,is_synthetic)
      VALUES($1,$2,$3,$4,true)`, [personId, input.campaignId, input.audienceBranchId, `Synthetic participant ${input.fixtureKey}`]);
    await client.query(`INSERT INTO webinar_synthetic_fixtures(person_id,campaign_id,fixture_key,audience_class)
      VALUES($1,$2,$3,$4)`, [personId, input.campaignId, input.fixtureKey, input.audienceClass]);
    return { personId, fixtureKey: input.fixtureKey, syntheticEmail: syntheticEmail(input.fixtureKey),
      replayed: false as const };
  });
}

export function checkSyntheticTransition(action: ParticipantLifecycleCommand["action"], eventStatus: EventStatus,
  current: Registration, attended: Attendance): Registration | null {
  if (eventStatus === "cancelled" && action !== "cancel-occurrence")
    throw new PersistenceConflict("Cancelled occurrence cannot accept participant or schedule transitions");
  switch (action) {
    case "register":
      if (!["not_registered", "cancelled"].includes(current) || !["open_for_registration", "scheduled"].includes(eventStatus))
        throw new PersistenceConflict("Registration requires an open occurrence and an explicit new or cancelled registration");
      return "registered";
    case "waitlist":
      if (current !== "not_registered" || !["open_for_registration", "scheduled"].includes(eventStatus))
        throw new PersistenceConflict("Waitlist requires an unregistered participant and an open occurrence");
      return "waitlisted";
    case "promote":
      if (current !== "waitlisted" || !["open_for_registration", "scheduled"].includes(eventStatus))
        throw new PersistenceConflict("Only an explicitly waitlisted participant can be promoted on an open occurrence");
      return "registered";
    case "cancel-registration":
      if (current !== "registered" || attended !== "unknown"
        || !["open_for_registration", "scheduled"].includes(eventStatus))
        throw new PersistenceConflict("Only a registered participant in an upcoming occurrence with no attendance classification may cancel registration");
      return "cancelled";
    case "seed-executed-history":
      if (current !== "registered")
        throw new PersistenceConflict("Historical execution fixtures require confirmed synthetic registration");
      return null;
    case "record-attendance": case "reconcile-attendance":
      if (eventStatus !== "completed" || current !== "registered")
        throw new PersistenceConflict("Attendance requires a completed occurrence and confirmed registration");
      return null;
    case "complete-occurrence":
      if (eventStatus !== "in_progress" && eventStatus !== "scheduled")
        throw new PersistenceConflict("Only a scheduled or in-progress occurrence can complete");
      return null;
    case "cancel-occurrence":
      if (eventStatus === "cancelled" || eventStatus === "completed")
        throw new PersistenceConflict("Completed or cancelled occurrences cannot be cancelled again");
      return null;
    case "reschedule":
      if (!["draft", "open_for_registration", "scheduled"].includes(eventStatus))
        throw new PersistenceConflict("Only an upcoming occurrence can be rescheduled");
      return null;
    default: { const exhaustive: never = action; throw new PersistenceConflict(`Unknown lifecycle action: ${exhaustive}`); }
  }
}

function storedObligations(plan: WebinarAudiencePlan, personId: string, prior: Record<string, Record<string, unknown>>,
  cancelled: boolean, rescheduled: boolean, configured: readonly { key: string; id: string }[]) {
  const current = plan.participants.find(p => p.participantId === personId);
  if (!current) throw new PersistenceConflict("Missing participant in canonical audience plan");
  const entries = new Map<string, { communicationId: string; kind: string; disposition: string; dueAt: string | null; reason: string }>();
  for (const value of current.obligations) {
    const future = value.dueAtEpochMs === null || value.dueAtEpochMs >= plan.calculationInstantEpochMs;
    if (!future) continue;
    const old = prior[value.communicationId];
    const moved = rescheduled && old?.due_at && value.dueAtEpochMs !== null
      && Date.parse(String(old.due_at)) !== value.dueAtEpochMs;
    entries.set(value.communicationId, {
      communicationId: value.communicationId, kind: value.kind,
      disposition: cancelled && !["event_cancellation_notice", "waitlist_closure"].includes(value.kind)
        ? "suppressed" : moved ? "rescheduled" : value.disposition,
      dueAt: value.dueAtEpochMs === null ? null : new Date(value.dueAtEpochMs).toISOString(),
      reason: moved ? `Schedule changed; ${value.reason}` : value.reason,
    });
  }
  // Keep the stable IDs of former future obligations; never erase the original schedule.
  for (const previous of Object.values(prior)) {
    const id = String(previous.communication_id);
    if (!entries.has(id) && previous.disposition !== "executed"
      && (!previous.due_at || Date.parse(String(previous.due_at)) >= plan.calculationInstantEpochMs)) {
      entries.set(id, { communicationId: id, kind: String(previous.kind),
        disposition: cancelled ? "suppressed" : "obsolete", dueAt: previous.due_at ? String(previous.due_at) : null,
        reason: cancelled ? "Occurrence cancelled; future communication prohibited" : "No longer applicable in canonical audience plan" });
    }
  }
  for (const touch of recruitmentKinds) {
    const id = configured.find(c => c.key === touch)?.id;
    if (!id) continue; // No synthetic placeholder can masquerade as a persisted communication.
    if (!current.recruitmentEligible || cancelled) entries.set(id, { communicationId: id, kind: touch,
      disposition: "suppressed", dueAt: null, reason: current.suppressions.join(", ") || "Registration excludes future recruitment" });
  }
  return [...entries.values()];
}

export async function transitionParticipantLifecycle(raw: ParticipantLifecycleCommand) {
  const input = lifecycleCommand.parse(raw);
  if (["register", "waitlist", "promote", "cancel-registration", "record-attendance", "reconcile-attendance",
    "seed-executed-history"].includes(input.action)
    && !input.personId) throw new PersistenceConflict("Participant identifier required");
  if (input.action === "seed-executed-history"
    !== !!(input.historyKind && input.historyExecutedAt && input.syntheticMessageReference))
    throw new PersistenceConflict("History seed requires an exact kind, past execution time, and synthetic message UUID");
  if (input.action !== "seed-executed-history"
    && (input.historyKind || input.historyExecutedAt || input.syntheticMessageReference))
    throw new PersistenceConflict("Historical execution fields are valid only for synthetic fixture seeding");
  if (["cancel-occurrence", "complete-occurrence", "reschedule"].includes(input.action) && input.personId)
    throw new PersistenceConflict("Occurrence transitions cannot be scoped to one participant");
  if (["record-attendance", "reconcile-attendance"].includes(input.action) !== !!input.attendance)
    throw new PersistenceConflict("Only synthetic attendance observations may carry an attended/absent classification");
  if (input.action === "reschedule" !== !!(input.sessionDate && input.startTime && input.timezone))
    throw new PersistenceConflict("Rescheduling requires a complete local date, time and IANA zone");
  if (input.action !== "reschedule" && (input.sessionDate || input.startTime || input.timezone))
    throw new PersistenceConflict("Schedule fields are valid only for rescheduling");
  if (input.action !== "complete-occurrence" && input.actualEndAt)
    throw new PersistenceConflict("Only occurrence completion can record an actual event end");
  const at = new Date(input.calculationAt).toISOString();
  const requestHash = simulationFingerprint(input);
  return new WebinarPersistence().withEvaluationTransaction(input, async (client, transaction) => {
    const original = await loadOccurrenceSources(client, input.campaignId, input.sessionId);
    assertOccurrenceEligibility(original);
    const priorEvent = await client.query(`SELECT e.*,s.snapshot_id FROM webinar_lifecycle_events e
      LEFT JOIN webinar_lifecycle_snapshots s ON s.event_id=e.id
      LEFT JOIN webinar_persistence_records r ON r.id=s.snapshot_id
      WHERE e.session_id=$1 AND (e.event_key=$2 OR (e.source_system='synthetic-simulator' AND e.source_reference=$3))
      ORDER BY r.revision DESC NULLS LAST LIMIT 1`,
      [input.sessionId, input.idempotencyKey, input.sourceReference]);
    if (priorEvent.rows[0]) {
      if (priorEvent.rows[0].request_fingerprint !== requestHash || !priorEvent.rows[0].snapshot_id)
        throw new PersistenceConflict("Source reference or idempotency key reused for different input");
      const saved = await client.query(`SELECT * FROM webinar_persistence_records WHERE id=$1 AND session_id=$2`,
        [priorEvent.rows[0].snapshot_id, input.sessionId]);
      const simulation = simulationSnapshotSchema.parse(saved.rows[0].payload.simulation);
      const snapshotIds = (await client.query(`SELECT s.snapshot_id FROM webinar_lifecycle_snapshots s
        JOIN webinar_persistence_records r ON r.id=s.snapshot_id WHERE s.event_id=$1
        ORDER BY r.revision`, [priorEvent.rows[0].id])).rows.map(row => String(row.snapshot_id));
      return { eventId: priorEvent.rows[0].id as string, replayed: true, snapshotIds, snapshot: {
        ...simulation, snapshotId: saved.rows[0].id, revision: saved.rows[0].revision,
        diagnostics: { invokedRuleIds: [], evaluatorErrors: [], sourceRecordCount: simulation.sourceReferences.length, replayed: true },
      }, before: [] as AudienceObligation[], after: [] as AudienceObligation[],
      suppression: [] as SuppressionDecision[] };
    }
    if (original.binding!.revision !== input.expectedRevision)
      throw new PersistenceConflict("Occurrence revision changed; reload unsaved draft and retry");
    const latestObserved = original.lifecycleEvents.reduce((latest, event) =>
      Math.max(latest, Date.parse(String(event.observed_at))), Number.NEGATIVE_INFINITY);
    if (Date.parse(at) < latestObserved)
      throw new PersistenceConflict("Synthetic source observation is older than the last occurrence transition");
    if (input.personId && !original.participants.some(p => p.id === input.personId)) {
      const { rows: [fixture] } = await client.query(`SELECT p.*,f.fixture_key,f.provenance,f.audience_class
        FROM webinar_people p JOIN webinar_synthetic_fixtures f ON f.person_id=p.id AND f.campaign_id=p.campaign_id
        WHERE p.id=$1 AND p.campaign_id=$2 AND p.is_synthetic=true
          AND ($3::uuid IS NULL OR p.audience_branch_id=$3)
          AND p.name=('Synthetic participant ' || f.fixture_key)`,
        [input.personId, input.campaignId, input.audienceBranchId ?? null]);
      if (!fixture) throw new PersistenceConflict("Participant is not an explicitly labelled synthetic fixture in this campaign");
      original.participants.push(fixture);
    }
    const before = await planSyntheticPopulation(original, at);
    const eventStatus = status(original);
    const person = input.personId ? assertPerson(original, input.personId) : null;
    if (person && input.audienceBranchId && person.audience_branch_id !== input.audienceBranchId)
      throw new PersistenceConflict("Synthetic participant is outside the requested audience branch");
    if (!person && input.audienceBranchId)
      throw new PersistenceConflict("Occurrence transitions must cover all audience branches");
    const current = input.personId ? projectedRegistration(original, input.personId) : "not_registered";
    const att = attendance(original.attendances.find(a => a.person_id === input.personId)?.result);
    const next = checkSyntheticTransition(input.action, eventStatus, current, att);
    let executedCommunicationId: string | undefined;
    if (input.action === "seed-executed-history") {
      if (Date.parse(input.historyExecutedAt!) > Date.parse(at))
        throw new PersistenceConflict("Fixture execution history cannot be dated in the future");
      executedCommunicationId = (recruitmentKinds as readonly string[]).includes(input.historyKind!)
        ? original.communications.find(c => c.key === input.historyKind)?.id
        : before.participants.find(p => p.participantId === input.personId)
          ?.obligations.find(o => o.kind === input.historyKind)?.communicationId;
      if (!executedCommunicationId) throw new PersistenceConflict("Historical execution needs an exact canonical configured communication");
      if (original.syntheticExecutions.some(e => e.person_id === input.personId
        && (e.communication_id === executedCommunicationId
          || e.synthetic_message_reference === input.syntheticMessageReference)))
        throw new PersistenceConflict("Synthetic execution source fact is already recorded");
    }
    if (input.action === "reconcile-attendance" && !original.lifecycleEvents.some(e =>
      e.person_id === input.personId && e.action === "record-attendance"))
      throw new PersistenceConflict("Attendance reconciliation requires an existing source observation");
    const attendanceConflict = input.action === "record-attendance"
      && att !== "unknown" && att !== input.attendance;
    if (input.action === "complete-occurrence" && (!input.actualEndAt
      || Date.parse(input.actualEndAt) <= eventInstant(original)))
      throw new PersistenceConflict("Completion requires an observed synthetic actual end after event start");
    if (input.actualEndAt && Date.parse(input.actualEndAt) > Date.parse(at))
      throw new PersistenceConflict("Actual end must be an observed synthetic attendance source fact");
    const previousSchedule = { date: original.occurrence.session_date, time: original.occurrence.start_time,
      timezone: original.occurrence.timezone };
    if (input.action === "reschedule") {
      localScheduledInstant(input.sessionDate!, input.startTime!, input.timezone!);
      if (simulationFingerprint(previousSchedule) === simulationFingerprint({
        date: input.sessionDate, time: input.startTime, timezone: input.timezone }))
        throw new PersistenceConflict("Rescheduling requires a changed date, time or zone");
    }
    const eventPayload = { before: { eventStatus, registration: current, attendance: att, schedule: previousSchedule },
      after: { registration: next, attendance: attendanceConflict ? "unknown" : input.attendance ?? att,
        eventStatus: input.action === "cancel-occurrence" ? "cancelled"
          : input.action === "complete-occurrence" ? "completed" : eventStatus },
      ...(attendanceConflict ? { reconciliationRequired: true } : {}),
      ...(input.actualEndAt ? { actualEndAt: input.actualEndAt } : {}),
      ...(executedCommunicationId ? { historicalExecution: { communicationId: executedCommunicationId,
        kind: input.historyKind, executedAt: input.historyExecutedAt,
        syntheticMessageReference: input.syntheticMessageReference } } : {}),
      ...(input.action === "reschedule" ? { schedule: { date: input.sessionDate, time: input.startTime, timezone: input.timezone } } : {}) };
    const { rows: [event] } = await client.query(`INSERT INTO webinar_lifecycle_events
      (campaign_id,session_id,person_id,actor_id,event_key,action,source_reference,observed_at,payload,request_fingerprint)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [input.campaignId, input.sessionId, person?.id ?? null, input.actorId, input.idempotencyKey,
        input.action, input.sourceReference, at, JSON.stringify(eventPayload), requestHash]);
    if (executedCommunicationId && person) {
      await client.query(`INSERT INTO webinar_synthetic_executions
        (campaign_id,session_id,person_id,communication_id,kind,executed_at,synthetic_message_reference,source_event_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [input.campaignId, input.sessionId, person.id, executedCommunicationId,
          input.historyKind, input.historyExecutedAt, input.syntheticMessageReference, event.id]);
      await client.query(`INSERT INTO webinar_lifecycle_obligations
        (campaign_id,session_id,person_id,communication_id,kind,disposition,due_at,reason,source_event_id)
        VALUES($1,$2,$3,$4,$5,'executed',$6,'Immutable pre-existing synthetic fixture history', $7)`,
        [input.campaignId, input.sessionId, person.id, executedCommunicationId, input.historyKind,
          input.historyExecutedAt, event.id]);
    }
    if (next && person) {
      await client.query(`INSERT INTO webinar_registration_results(campaign_id,session_id,person_id,result,recorded_at,first_registered_at)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(session_id,person_id) DO UPDATE SET result=EXCLUDED.result,
          recorded_at=EXCLUDED.recorded_at,updated_at=now(),
          first_registered_at=COALESCE(webinar_registration_results.first_registered_at,EXCLUDED.first_registered_at)`,
        [input.campaignId, input.sessionId, person.id, next === "registered" ? "registered" : "not_registered", at,
          next === "registered" ? at : null]);
    }
    if (attendanceConflict && person) {
      // The projection becomes unknown, never an invented absence. Both source
      // observations remain immutable until explicit reconciliation.
      await client.query(`DELETE FROM webinar_attendance_results
        WHERE session_id=$1 AND campaign_id=$2 AND person_id=$3`,
        [input.sessionId, input.campaignId, person.id]);
    } else if (input.attendance && person) {
      await client.query(`INSERT INTO webinar_attendance_results(campaign_id,session_id,person_id,result,recorded_at)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,person_id) DO UPDATE
        SET result=EXCLUDED.result,recorded_at=EXCLUDED.recorded_at,updated_at=now()`,
        [input.campaignId, input.sessionId, person.id, input.attendance === "absent" ? "no_show" : "attended", at]);
    }
    if (input.action === "reschedule") await client.query(`UPDATE webinar_sessions SET
      session_date=$3,start_time=$4,timezone=$5,updated_at=now() WHERE id=$1 AND campaign_id=$2`,
      [input.sessionId, input.campaignId, input.sessionDate, input.startTime, input.timezone]);
    let revision = input.expectedRevision;
    if (input.action === "cancel-occurrence" || input.action === "complete-occurrence") {
      await transaction.append({ campaignId: input.campaignId, sessionId: input.sessionId, actorId: input.actorId,
        expectedRevision: revision++, standard: { id: STANDARD_ID, version: STANDARD_VERSION },
        calculationAt: at, inputFingerprint: simulationFingerprint(eventPayload), operational: false,
        idempotencyKey: `${input.idempotencyKey}:plan`, payload: {
          kind: "plan", state: "superseded", eventStatus: input.action === "cancel-occurrence" ? "cancelled" : "completed",
          planFingerprint: simulationFingerprint(eventPayload),
        } });
    }
    const changed = await loadOccurrenceSources(client, input.campaignId, input.sessionId);
    const after = await planSyntheticPopulation(changed, at);
    const changedPeople = input.personId ? [input.personId] : changed.participants.map(p => String(p.id));
    for (const id of changedPeople) {
      const prior = currentObligations(original, id);
      for (const obligation of storedObligations(after, id, prior,
        input.action === "cancel-occurrence", input.action === "reschedule", changed.communications)) {
        const old = prior[obligation.communicationId];
        if (changed.syntheticExecutions.some(e => e.person_id === id
          && e.communication_id === obligation.communicationId)) continue;
        if (old?.disposition === "executed") continue;
        if (old?.disposition === obligation.disposition && (old?.due_at ?? null) === obligation.dueAt) continue;
        await client.query(`INSERT INTO webinar_lifecycle_obligations
          (campaign_id,session_id,person_id,communication_id,kind,disposition,due_at,reason,source_event_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [input.campaignId, input.sessionId, id, obligation.communicationId, obligation.kind,
            obligation.disposition, obligation.dueAt, obligation.reason, event.id]);
      }
    }
    const snapshotIds: string[] = [];
    let snapshot: Awaited<ReturnType<typeof simulateWebinarInTransaction>> | undefined;
    for (const id of changedPeople.length ? changedPeople : [undefined]) {
      snapshot = await simulateWebinarInTransaction({
        campaignId: input.campaignId, sessionId: input.sessionId, actorId: input.actorId,
        expectedRevision: revision, calculationAt: at,
        idempotencyKey: `${input.idempotencyKey}:simulation:${id ?? "occurrence"}`,
      }, client, transaction, id);
      revision = snapshot.revision;
      snapshotIds.push(snapshot.snapshotId);
      await client.query(`INSERT INTO webinar_lifecycle_snapshots(event_id,snapshot_id,person_id) VALUES($1,$2,$3)`,
        [event.id, snapshot.snapshotId, id ?? null]);
    }
    const release = await captureWebinarRelease(Date.parse(at));
    return { eventId: event.id as string, replayed: false, snapshot: snapshot!, snapshotIds,
      before: input.personId ? before.participants.find(p => p.participantId === input.personId)?.obligations ?? [] : before.participants,
      after: input.personId ? after.participants.find(p => p.participantId === input.personId)?.obligations ?? [] : after.participants,
      suppression: changedPeople.map(id => decideSyntheticSuppression(after, id,
        changed.communications.find(c => c.key === "recruitment_1")?.id ?? null,
        at, release.digest, changed.syntheticExecutions, "recruitment_1")) };
  });
}

export async function listParticipantSimulation(raw: { campaignId: string; sessionId: string; limit: number;
  offset: number; after?: string; audienceBranchId?: string }) {
  const input = z.object({ campaignId: uuid, sessionId: uuid, limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative(), after: uuid.optional(), audienceBranchId: uuid.optional() }).strict().parse(raw);
  return new WebinarPersistence().withEvaluationTransaction(input, async client => {
    const sources = await loadOccurrenceSources(client, input.campaignId, input.sessionId, input);
    assertOccurrenceEligibility(sources);
    const plan = await planSyntheticPopulation(sources, new Date().toISOString());
    const returned = plan.participants.length;
    const hasMore = input.offset + returned < sources.participantRemaining;
    const nextCursor = hasMore ? plan.participants.at(-1)?.participantId ?? null : null;
    return { total: sources.participantTotal, limit: input.limit, offset: input.offset,
      returned, nextOffset: hasMore ? input.offset + returned : null,
      nextCursor, participants: plan.participants,
      operationalStatus: "simulation-only" as const };
  });
}

/** Campaign fixtures may exist before their first occurrence registration. */
export async function listSyntheticFixtures(raw: { campaignId: string; sessionId: string; limit: number;
  offset: number; after?: string; audienceBranchId?: string }) {
  const input = z.object({ campaignId: uuid, sessionId: uuid, limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative(), after: fixtureKey.optional(), audienceBranchId: uuid.optional() }).strict().parse(raw);
  return new WebinarPersistence().withEvaluationTransaction(input, async client => {
    const sources = await loadOccurrenceSources(client, input.campaignId, input.sessionId);
    assertOccurrenceEligibility(sources);
    const { rows: [{ total, remaining }] } = await client.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE $3::text IS NULL OR f.fixture_key>$3)::int AS remaining
      FROM webinar_synthetic_fixtures f JOIN webinar_people p ON p.id=f.person_id AND p.campaign_id=f.campaign_id
      WHERE f.campaign_id=$1 AND ($2::uuid IS NULL OR p.audience_branch_id=$2)
        AND p.is_synthetic=true AND p.name=('Synthetic participant ' || f.fixture_key)`,
      [input.campaignId, input.audienceBranchId ?? null, input.after ?? null]);
    const { rows } = await client.query(`SELECT f.person_id AS "personId",f.fixture_key AS "fixtureKey",
      f.audience_class AS "audienceClass" FROM webinar_synthetic_fixtures f
      JOIN webinar_people p ON p.id=f.person_id AND p.campaign_id=f.campaign_id
      WHERE f.campaign_id=$1 AND ($4::uuid IS NULL OR p.audience_branch_id=$4)
        AND ($5::text IS NULL OR f.fixture_key>$5)
        AND p.is_synthetic=true AND p.name=('Synthetic participant ' || f.fixture_key)
      ORDER BY f.fixture_key,f.person_id LIMIT $2 OFFSET $3`,
      [input.campaignId, input.limit, input.offset, input.audienceBranchId ?? null, input.after ?? null]);
    const hasMore = input.offset + rows.length < remaining;
    return { total: total as number, limit: input.limit, offset: input.offset,
      returned: rows.length, nextOffset: hasMore ? input.offset + rows.length : null,
      nextCursor: hasMore ? String(rows.at(-1).fixtureKey) : null,
      fixtures: rows.map(row => ({
        ...row, syntheticEmail: syntheticEmail(String(row.fixtureKey)),
        registrationStatus: projectedRegistration(sources, String(row.personId)),
        attendanceStatus: attendance(sources.attendances.find(a => a.person_id === row.personId)?.result),
      })), operationalStatus: "simulation-only" as const };
  });
}

export async function getSyntheticLifecycleContext(raw: { campaignId: string; sessionId: string }) {
  const input = z.object({ campaignId: uuid, sessionId: uuid }).strict().parse(raw);
  return new WebinarPersistence().withEvaluationTransaction(input, async client => {
    const sources = await loadOccurrenceSources(client, input.campaignId, input.sessionId);
    assertOccurrenceEligibility(sources);
    return { campaignId: input.campaignId, sessionId: input.sessionId, activityId: sources.activity.id,
      revision: sources.binding!.revision, eventStatus: status(sources),
      sessionDate: sources.occurrence.session_date, startTime: sources.occurrence.start_time,
      timezone: sources.occurrence.timezone, participantCount: sources.participants.length,
      operationalStatus: "simulation-only" as const };
  });
}

export async function inspectParticipantSuppression(raw: {
  campaignId: string; sessionId: string; personId: string;
  kind: (typeof AUDIENCE_COMMUNICATION_KINDS)[number] | (typeof recruitmentKinds)[number];
  calculationAt: string; audienceBranchId?: string;
}) {
  const input = z.object({ campaignId: uuid, sessionId: uuid, personId: uuid,
    kind: z.enum([...AUDIENCE_COMMUNICATION_KINDS, ...recruitmentKinds]),
    calculationAt: instant, audienceBranchId: uuid.optional() }).strict().parse(raw);
  return new WebinarPersistence().withEvaluationTransaction(input, async client => {
    const sources = await loadOccurrenceSources(client, input.campaignId, input.sessionId);
    assertOccurrenceEligibility(sources);
    if (input.audienceBranchId && sources.participants.find(p => p.id === input.personId)?.audience_branch_id !== input.audienceBranchId)
      throw new PersistenceConflict("Synthetic participant is outside the requested audience branch");
    const at = new Date(input.calculationAt).toISOString();
    const plan = await planSyntheticPopulation(sources, at);
    const release = await captureWebinarRelease(Date.parse(at));
    const obligation = plan.participants.find(p => p.participantId === input.personId)
      ?.obligations.find(o => o.kind === input.kind);
    const communicationId = (recruitmentKinds as readonly string[]).includes(input.kind)
      ? sources.communications.find(c => c.key === input.kind)?.id ?? null
      : obligation?.communicationId ?? null;
    return decideSyntheticSuppression(plan, input.personId, communicationId, at,
      release.digest, sources.syntheticExecutions, input.kind);
  });
}