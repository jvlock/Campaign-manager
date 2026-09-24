import type { AssemblySource } from "./webinar-domain-adapters/types";
import { STANDARD_ID, STANDARD_VERSION } from "./webinar-standard-catalog/types";
import { PersistenceConflict, type WebinarTransactionClient } from "./webinar-persistence";

export type EvaluationClient = WebinarTransactionClient;
export interface PersistenceSourceRecord {
  id: string; revision: number; kind: string; actor_id: string; parent_id: string | null;
  payload: Record<string, unknown>; recorded_at: string; calculation_at: string;
}
export interface OccurrenceSources {
  campaign: { id: string; [key: string]: unknown };
  activity: { id: string; campaign_id: string; activity_type_id: string | null; type: string; [key: string]: unknown };
  occurrence: { id: string; campaign_id: string; activity_id: string; session_date: string; start_time: string; timezone: string; duration_minutes: number; platform: string; name: string; template_version: string; [key: string]: unknown };
  binding: { standard_id: string | null; standard_version: string | null; revision: number } | null;
  legacy: boolean; development: boolean;
  communications: { id: string; session_id: string; key: string; effective_scheduled_at: string | null; created_at: string; [key: string]: unknown }[];
  applicationCommunications: Record<string, unknown>[];
  details: Record<string, unknown>[];
  configurations: Record<string, unknown>[];
  schedules: Record<string, unknown>[];
  scheduleRules: Record<string, unknown>[];
  destinations: Record<string, unknown>[];
  ctas: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  communicationCtas: Record<string, unknown>[];
  communicationLandingPages: Record<string, unknown>[];
  landingPageAssets: Record<string, unknown>[];
  ownership: Record<string, unknown>[];
  records: PersistenceSourceRecord[];
  participants: Record<string, unknown>[];
  registrations: Record<string, unknown>[];
  attendances: Record<string, unknown>[];
  lifecycleEvents: Record<string, unknown>[];
  lifecycleObligations: Record<string, unknown>[];
  syntheticExecutions: Record<string, unknown>[];
  participantTotal: number;
  participantRemaining: number;
}

/** Single SQL statement = one MVCC source snapshot, not a series of inconsistent reads.
 * Only marker-verified synthetic fixtures for this occurrence are queried.
 */
export async function loadOccurrenceSources(client: EvaluationClient, campaignId: string, sessionId: string,
  page?: { limit: number; offset: number; after?: string; audienceBranchId?: string }): Promise<OccurrenceSources> {
  const { rows } = await client.query(`WITH occurrence AS (
    SELECT s.* FROM webinar_sessions s WHERE s.id=$2 AND s.campaign_id=$1
  ), comm AS (
    SELECT c.* FROM communications c JOIN occurrence s ON c.activity_id=s.activity_id AND c.campaign_id=s.campaign_id
    WHERE EXISTS(SELECT 1 FROM webinar_standard_communications w WHERE w.communication_id=c.id
      AND w.session_id=s.id AND w.campaign_id=s.campaign_id AND w.activity_id=s.activity_id)
  ), rules AS (
    SELECT r.* FROM schedule_rules r JOIN occurrence s ON r.campaign_id=s.campaign_id
    WHERE r.communication_id IN (SELECT id FROM comm)
      OR r.id IN (SELECT w.schedule_rule_id FROM webinar_standard_communications w
        WHERE w.session_id=s.id AND w.campaign_id=s.campaign_id AND w.activity_id=s.activity_id)
   ), participant_population AS (
     SELECT p.id,p.audience_branch_id FROM webinar_people p
     JOIN webinar_synthetic_fixtures f ON f.person_id=p.id AND f.campaign_id=p.campaign_id
     JOIN occurrence s ON s.campaign_id=p.campaign_id
     WHERE p.is_synthetic=true AND p.name=('Synthetic participant ' || f.fixture_key)
       AND ($6::uuid IS NULL OR p.audience_branch_id=$6)
       AND (EXISTS(SELECT 1 FROM webinar_registration_results r WHERE r.person_id=p.id AND r.session_id=s.id)
         OR EXISTS(SELECT 1 FROM webinar_lifecycle_events e WHERE e.person_id=p.id AND e.session_id=s.id))
   ), participant_page AS (
     SELECT id FROM participant_population WHERE ($5::uuid IS NULL OR id>$5)
     ORDER BY id LIMIT $4::int OFFSET COALESCE($3::int,0)
   ), lp AS (
    SELECT p.* FROM landing_pages p WHERE p.campaign_id=$1 AND p.id IN
      (SELECT l.landing_page_id FROM communication_landing_pages l JOIN comm c ON c.id=l.communication_id AND c.campaign_id=l.campaign_id
       UNION SELECT t.landing_page_id FROM ctas t JOIN communication_ctas ct ON ct.cta_id=t.id AND ct.campaign_id=t.campaign_id JOIN comm c ON c.id=ct.communication_id AND c.campaign_id=ct.campaign_id)
  )
  SELECT to_jsonb(c) AS campaign,to_jsonb(a) AS activity,to_jsonb(s) AS occurrence,
    (SELECT to_jsonb(b) FROM webinar_persistence_bindings b WHERE b.session_id=s.id AND b.campaign_id=c.id) AS binding,
    EXISTS(SELECT 1 FROM legacy_activities l WHERE l.activity_id=a.id) OR EXISTS(SELECT 1 FROM legacy_campaigns l WHERE l.campaign_id=c.id) AS legacy,
    EXISTS(SELECT 1 FROM development_record_registry r WHERE r.entity_type='campaign' AND r.entity_id=c.id)
      AND EXISTS(SELECT 1 FROM development_record_registry r WHERE r.entity_type='activity' AND r.entity_id=a.id) AS development,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.id) FROM webinar_standard_communications x WHERE x.session_id=s.id AND x.campaign_id=c.id AND x.activity_id=a.id),'[]') AS communications,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.id) FROM comm x),'[]') AS "applicationCommunications",
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.id) FROM communication_details x JOIN comm q ON q.id=x.communication_id AND q.campaign_id=x.campaign_id),'[]') AS details,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.id) FROM webinar_standard_configs x WHERE x.session_id=s.id AND x.campaign_id=c.id),'[]') AS configurations,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.id) FROM scheduled_instances x WHERE x.campaign_id=c.id AND (x.communication_id IN (SELECT id FROM comm) OR x.rule_id IN (SELECT id FROM rules))),'[]') AS schedules,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.id) FROM rules x),'[]') AS "scheduleRules",
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.id) FROM lp x),'[]') AS destinations,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.id) FROM ctas x WHERE x.campaign_id=c.id AND x.id IN (SELECT ct.cta_id FROM communication_ctas ct JOIN comm q ON q.id=ct.communication_id AND q.campaign_id=ct.campaign_id)),'[]') AS ctas,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.id) FROM assets x WHERE x.campaign_id=c.id AND x.id IN (SELECT la.content_asset_id FROM landing_page_content_assets la JOIN lp p ON p.id=la.landing_page_id AND p.campaign_id=la.campaign_id)),'[]') AS assets,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.communication_id,x.cta_id) FROM communication_ctas x JOIN comm q ON q.id=x.communication_id AND q.campaign_id=x.campaign_id),'[]') AS "communicationCtas",
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.communication_id,x.landing_page_id) FROM communication_landing_pages x JOIN comm q ON q.id=x.communication_id AND q.campaign_id=x.campaign_id),'[]') AS "communicationLandingPages",
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.landing_page_id,x.content_asset_id) FROM landing_page_content_assets x JOIN lp p ON p.id=x.landing_page_id AND p.campaign_id=x.campaign_id),'[]') AS "landingPageAssets",
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.activity_id) FROM activity_ownership x WHERE x.activity_id=a.id AND x.campaign_id=c.id),'[]') AS ownership,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.revision) FROM webinar_persistence_records x WHERE x.session_id=s.id AND x.campaign_id=c.id AND x.kind NOT IN ('readiness','completion','release')),'[]') AS records,
    (SELECT count(*)::int FROM participant_population) AS "participantTotal",
    (SELECT count(*)::int FROM participant_population WHERE ($5::uuid IS NULL OR id>$5)) AS "participantRemaining",
    COALESCE((SELECT jsonb_agg(to_jsonb(p.*) || jsonb_build_object('fixture_key',f.fixture_key,'provenance',f.provenance,'audience_class',f.audience_class) ORDER BY p.id)
      FROM webinar_people p JOIN webinar_synthetic_fixtures f ON f.person_id=p.id AND f.campaign_id=p.campaign_id
       WHERE p.id IN (SELECT id FROM participant_page)),'[]') AS participants,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.person_id) FROM webinar_registration_results x
      WHERE x.session_id=s.id AND x.campaign_id=c.id AND ($4::int IS NULL OR x.person_id IN (SELECT id FROM participant_page))),'[]') AS registrations,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.person_id) FROM webinar_attendance_results x
      WHERE x.session_id=s.id AND x.campaign_id=c.id AND ($4::int IS NULL OR x.person_id IN (SELECT id FROM participant_page))),'[]') AS attendances,
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.reconciled_at,x.id) FROM webinar_lifecycle_events x
      WHERE x.session_id=s.id AND x.campaign_id=c.id
        AND ($4::int IS NULL OR x.person_id IS NULL OR x.person_id IN (SELECT id FROM participant_page))),'[]') AS "lifecycleEvents",
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.recorded_at,x.id) FROM webinar_lifecycle_obligations x
      WHERE x.session_id=s.id AND x.campaign_id=c.id
        AND ($4::int IS NULL OR x.person_id IN (SELECT id FROM participant_page))),'[]') AS "lifecycleObligations",
    COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.executed_at,x.id) FROM webinar_synthetic_executions x
      WHERE x.session_id=s.id AND x.campaign_id=c.id
        AND ($4::int IS NULL OR x.person_id IN (SELECT id FROM participant_page))),'[]') AS "syntheticExecutions"
  FROM occurrence s JOIN campaigns c ON c.id=s.campaign_id JOIN activities a ON a.id=s.activity_id AND a.campaign_id=c.id`,
  [campaignId, sessionId, page?.offset ?? null, page?.limit ?? null, page?.after ?? null, page?.audienceBranchId ?? null]);
  if (!rows[0]) throw Object.assign(new Error("Occurrence not found in the requested campaign"), { status: 404 });
  return rows[0] as OccurrenceSources;
}

/** Short finalization lock: blocks modifications/phantom inserts until commit.
 * Both different-occurrence simulations can hold SHARE locks concurrently.
 * The initial read does not hold these locks: changes during evaluation are detected.
 */
export async function lockEvaluationSources(client: EvaluationClient) {
  await client.query(`LOCK TABLE campaigns,activities,webinar_sessions,legacy_activities,legacy_campaigns,
    development_record_registry,webinar_standard_communications,communications,communication_details,
    webinar_standard_configs,scheduled_instances,schedule_rules,landing_pages,ctas,assets,
    communication_ctas,communication_landing_pages,landing_page_content_assets,activity_ownership,
    webinar_people,webinar_synthetic_fixtures,webinar_registration_results,webinar_attendance_results,
    webinar_lifecycle_events,webinar_lifecycle_obligations,webinar_synthetic_executions IN SHARE MODE`);
}

export function assertOccurrenceEligibility(sources: OccurrenceSources): void {
  const explicitNewSynthetic = sources.records.some(r => r.kind === "plan"
    && r.payload.simulationEligibility === "new-synthetic-occurrence");
  if (sources.legacy || !sources.development || !explicitNewSynthetic) {
    throw new PersistenceConflict("Occurrence lacks explicit new-synthetic development eligibility; historical templates are not upgraded");
  }
  if (sources.binding?.standard_id !== STANDARD_ID || sources.binding.standard_version !== STANDARD_VERSION) {
    throw new PersistenceConflict("An explicit exact canonical standard binding is required");
  }
}

export function occurrenceAssemblySource(sources: OccurrenceSources, calculationAt: string, personId?: string): AssemblySource {
  const s = sources.occurrence;
  const latestPlan = sources.records.filter(r => r.kind === "plan").at(-1);
  const status = latestPlan?.payload.eventStatus;
  const known = ["draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled"];
  const person = sources.participants.find(p => p.id === personId);
  const registration = sources.registrations.find(r => r.person_id === personId);
  const attendance = sources.attendances.find(r => r.person_id === personId);
  const lastRegistration = sources.lifecycleEvents.filter(e => e.person_id === personId
    && ["register", "waitlist", "promote", "cancel-registration"].includes(String(e.action))).at(-1);
  const registrationStatus = lastRegistration?.action === "waitlist" ? "waitlisted"
    : lastRegistration?.action === "cancel-registration" ? "cancelled"
    : lastRegistration?.action === "register" || lastRegistration?.action === "promote" ? "registered"
    : registration?.result ?? "not_registered";
  return {
    campaign: { id: sources.campaign.id },
    activity: { id: sources.activity.id, campaignId: sources.activity.campaign_id, activityType: sources.activity.activity_type_id ?? sources.activity.type },
    occurrence: { id: s.id, campaignId: s.campaign_id, activityId: s.activity_id, sessionDate: s.session_date, startTime: s.start_time, timezone: s.timezone, durationMinutes: s.duration_minutes, platform: s.platform, name: s.name },
    binding: { standardId: sources.binding!.standard_id!, standardVersion: sources.binding!.standard_version! },
    calculationInstant: calculationAt,
    // Explicit simulation plan fact, never activity.status or a template-derived default.
    eventStatus: typeof status === "string" && known.includes(status) ? status as AssemblySource["eventStatus"] : null,
    ...(person ? { participant: {
      participantId: String(person.id), eventId: s.id, isSynthetic: true,
      registrationStatus,
      attendanceState: attendance?.result === "no_show" ? "absent" : attendance?.result ?? "unknown",
      audienceClass: person.audience_class as "customer" | "internal" | "test", includedInAttendance: null, includedInReporting: null,
      registrationAtEpochMs: registration?.first_registered_at ? Date.parse(String(registration.first_registered_at)) : null,
      suppressed: registrationStatus === "registered" || registrationStatus === "waitlisted" || registrationStatus === "cancelled",
    } as AssemblySource["participant"] } : {}),
    communications: sources.communications.map(c => ({
      id: c.id, sessionId: c.session_id, key: c.key, createdAt: c.created_at, scheduledAt: c.effective_scheduled_at,
    })),
    persisted: {
      activity: sources.activity, communications: sources.communications,
      applicationCommunications: sources.applicationCommunications, details: sources.details,
      destinations: sources.destinations, assets: sources.assets, ctas: sources.ctas,
      communicationCtas: sources.communicationCtas, communicationLandingPages: sources.communicationLandingPages,
      landingPageAssets: sources.landingPageAssets,
    },
  };
}