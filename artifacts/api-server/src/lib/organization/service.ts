import { pool } from "@workspace/db";
import { pagination } from "../pagination";
import {
  deny, isAuthorized, OrganizationAccessError,
  type OrganizationAction, type OrganizationRole, type PolicyGrant, type VerifiedPrincipal,
} from "./policy";

export type { VerifiedPrincipal } from "./policy";
export type OrganizationResource = { type: "campaign" | "activity"; id: string };
const connect = () => pool.connect();
type Client = Awaited<ReturnType<typeof connect>>;
type GrantAction = "calendar_view" | "record_view" | "record_edit" | "evidence_submit" | "financial_view";
export interface GrantInput {
  membershipId?: string; recipientGroupId?: string;
  unitId?: string; campaignId?: string; activityId?: string;
  role?: OrganizationRole; action?: GrantAction; expiresAt?: Date;
}
export interface OwnershipInput {
  resource: OrganizationResource; groupId: string; accountableOwnerId: string;
  calendarVisibility?: "private" | "summary";
}
export interface CalendarSummary {
  activityId: string; title: string; owningGroup: { id: string; name: string };
  accountableOwner: { id: string; name: string }; activityType: string;
  planningStatus: string;
  dates: { occurrenceId: string; date: string; time: string; timezone: string; durationMinutes: number }[];
}

/**
 * All organizational mutations and protected work share this transaction lock.
 * No cached authorization result is accepted; queued work invokes withAuthorized anew.
 * Direct database writers are restricted to trusted migration/bootstrap operators.
 */
async function transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(220022)");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function identity(client: Client, principal: VerifiedPrincipal | null): Promise<VerifiedPrincipal> {
  if (!principal?.issuer || !principal.subject || !principal.userId) deny();
  const development = await client.query("SELECT to_regclass('public.development_planning_environment') AS present");
  if (development.rows[0].present) {
    const marker = await client.query("SELECT 1 FROM development_planning_environment LIMIT 1");
    if (marker.rowCount) deny();
  }
  // The verifier binds issuer/subject to this existing staff user; email/role text is never authority.
  const result = await client.query("SELECT id FROM users WHERE id=$1", [principal.userId]);
  if (!result.rowCount) deny();
  return principal;
}

async function memberships(client: Client, userId: string) {
  return (await client.query(
    `SELECT m.*,u.status AS unit_status FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id
     WHERE m.user_id=$1 AND m.status='active' AND m.verified_by IS NOT NULL`, [userId],
  )).rows;
}

async function check(client: Client, principal: VerifiedPrincipal | null, action: OrganizationAction,
  resource: OrganizationResource, requesterUserId?: string): Promise<void> {
  const actor = await identity(client, principal);
  const registry = await client.query("SELECT to_regclass('public.development_record_registry') AS present");
  if (registry.rows[0].present) {
    const record = await client.query("SELECT 1 FROM development_record_registry WHERE entity_type=$1 AND entity_id=$2", [resource.type, resource.id]);
    if (record.rowCount) deny();
  }
  if (action === "execute") deny();
  const table = resource.type === "campaign" ? "campaign_ownership" : "activity_ownership";
  const key = resource.type === "campaign" ? "campaign_id" : "activity_id";
  const ownership = (await client.query(
    `SELECT o.*,u.status AS group_status,
     EXISTS(SELECT 1 FROM organization_memberships gm WHERE gm.unit_id=u.id
       AND gm.user_id=u.accountable_owner_id AND gm.status='active') AS staffed FROM ${table} o
     JOIN organization_units u ON u.id=o.group_id WHERE o.${key}=$1`, [resource.id],
  )).rows[0];
  if (!ownership) deny();
  const members = await memberships(client, actor.userId);
  const grants = (await client.query(
    `SELECT g.*,m.unit_id AS membership_unit_id FROM organization_grants g
     LEFT JOIN organization_memberships m ON m.id=g.membership_id
     WHERE g.status='active' AND (g.expires_at IS NULL OR g.expires_at>now())
     AND ((m.user_id=$1 AND m.status='active') OR g.recipient_group_id=ANY($2::uuid[]))`,
    [actor.userId, members.map(m => m.unit_id)],
  )).rows;
  const policies: PolicyGrant[] = [];
  for (const g of grants) {
    const matching = g.activity_id ? resource.type === "activity" && g.activity_id === resource.id
      : g.campaign_id ? resource.type === "campaign" && g.campaign_id === resource.id
      : g.unit_id === ownership.group_id;
    if (!matching) continue;
    if ((ownership.group_status !== "active" || !ownership.staffed)
      && g.unit_id && action !== "calendar_summary") continue;
    // A transfer is not permission to inspect historical attachments via a broad role.
    // Existing record grants were revoked atomically; a new explicit record grant is reviewed separately.
    if (ownership.reassessment_required && g.unit_id && action !== "calendar_summary" && action !== "administer") continue;
    const memberUnit = g.membership_unit_id ?? g.recipient_group_id;
    if (!["read", "calendar_summary"].includes(action)
      && !members.some(m => m.unit_id === memberUnit && m.unit_status === "active")) continue;
    if (g.action === "financial_view") {
      if (action === "financial" && members.some(m => m.unit_id === memberUnit)) return;
      continue;
    }
    if (g.action === "calendar_view") {
      policies.push({ role: "read_only_viewer", kind: "calendar", groupId: memberUnit,
        childGroupIds: [ownership.group_id] });
    } else if (g.action) {
      const mapped: OrganizationAction | undefined = ({
        record_view: "read", record_edit: "plan", evidence_submit: "submit_evidence",
      } as const)[g.action as "record_view" | "record_edit" | "evidence_submit"];
      if (mapped) policies.push({ role: "planner", kind: "collaboration", groupId: memberUnit,
        resourceId: resource.id, resourceType: resource.type, actions: [mapped] });
    } else {
      policies.push({ role: g.role, kind: "role", groupId: memberUnit, scopeGroupId: ownership.group_id,
        ...(g.unit_id ? {} : { resourceId: resource.id, resourceType: resource.type }) });
    }
  }
  if (!isAuthorized({ principal: actor, action, resource: {
    ...resource, groupId: ownership.group_id, resolved: true,
    groupActive: ownership.group_status === "active" && ownership.staffed,
    calendarVisible: ownership.calendar_visibility === "summary",
  }, memberships: members.map(m => m.unit_id), grants: policies, requesterUserId })) deny();
}

async function admin(client: Client, actor: VerifiedPrincipal, unitId: string) {
  await identity(client, actor);
  const result = await client.query(
    `SELECT g.id FROM organization_grants g
     JOIN organization_memberships m ON m.id=g.membership_id
     JOIN organization_units u ON u.id=m.unit_id
     WHERE m.user_id=$1 AND m.status='active' AND u.status='active'
     AND g.unit_id=$2 AND g.role='administrator' AND g.status='active'
     AND (g.expires_at IS NULL OR g.expires_at>now())`, [actor.userId, unitId],
  );
  if (!result.rowCount) deny();
}
async function audit(client: Client, actor: VerifiedPrincipal, action: string,
  scope: { unitId?: string; campaignId?: string; activityId?: string }, details: object) {
  await client.query(
    `INSERT INTO organization_audit(actor_id,action,unit_id,campaign_id,activity_id,details)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [actor.userId, action, scope.unitId ?? null, scope.campaignId ?? null, scope.activityId ?? null, JSON.stringify(details)],
  );
}
async function activeOwner(client: Client, groupId: string, userId: string) {
  const result = await client.query(
    `SELECT u.id FROM organization_units u JOIN organization_memberships m ON m.unit_id=u.id
     WHERE u.id=$1 AND u.kind='group' AND u.status='active'
     AND m.user_id=$2 AND m.status='active' AND EXISTS(SELECT 1 FROM organization_memberships gm
       WHERE gm.unit_id=u.id AND gm.user_id=u.accountable_owner_id AND gm.status='active')`, [groupId, userId],
  );
  if (!result.rowCount) deny();
}

async function assign(client: Client, actor: VerifiedPrincipal, input: OwnershipInput, historicalEvidence?: string) {
  await admin(client, actor, input.groupId);
  await activeOwner(client, input.groupId, input.accountableOwnerId);
  const { type, id } = input.resource;
  const legacy = await client.query(`SELECT 1 FROM legacy_${type === "campaign" ? "campaigns" : "activities"} WHERE ${type}_id=$1`, [id]);
  if (historicalEvidence ? !legacy.rowCount : legacy.rowCount) deny();
  const scope = type === "campaign" ? { campaignId: id } : { activityId: id };
  if (type === "campaign") {
    await client.query(`INSERT INTO campaign_group_participation(campaign_id,group_id,created_by) VALUES($1,$2,$3)
      ON CONFLICT DO NOTHING`, [id,input.groupId,actor.userId]);
    await client.query(`INSERT INTO campaign_ownership(campaign_id,group_id,accountable_owner_id,created_by)
      VALUES($1,$2,$3,$4)`, [id,input.groupId,input.accountableOwnerId,historicalEvidence ? null : actor.userId]);
  } else {
    const campaignId = (await client.query("SELECT campaign_id FROM activities WHERE id=$1", [id])).rows[0]?.campaign_id;
    if (!campaignId) deny();
    await client.query(`INSERT INTO activity_ownership(activity_id,campaign_id,group_id,accountable_owner_id,created_by,calendar_visibility)
      VALUES($1,$2,$3,$4,$5,$6)`,
    [id,campaignId,input.groupId,input.accountableOwnerId,historicalEvidence ? null : actor.userId,input.calendarVisibility ?? "private"]);
  }
  await audit(client, actor, historicalEvidence ? "historical_ownership_verified" : "ownership_assigned", scope,
    { groupId: input.groupId, accountableOwnerId: input.accountableOwnerId, evidence: historicalEvidence ?? null });
}

export function createOrganizationService() {
  return {
    /** Controlled, out-of-band two-subject bootstrap; never expose as a route. */
    bootstrapTeam(actor: VerifiedPrincipal, approver: VerifiedPrincipal,
      input: { name: string; evidence: string }) {
      return transaction(async c => {
        await identity(c, actor); await identity(c, approver);
        if (actor.userId === approver.userId || !input.evidence.trim()) deny();
        if ((await c.query("SELECT 1 FROM organization_units")).rowCount) deny();
        const team = (await c.query(`INSERT INTO organization_units(name,kind,status,accountable_owner_id)
          VALUES($1,'team','active',$2) RETURNING *`, [input.name,actor.userId])).rows[0];
        const member = (await c.query(`INSERT INTO organization_memberships(unit_id,user_id,verified_by)
          VALUES($1,$2,$3) RETURNING id`, [team.id,actor.userId,approver.userId])).rows[0];
        await c.query(`INSERT INTO organization_grants(membership_id,unit_id,role,granted_by)
          VALUES($1,$2,'administrator',$3)`, [member.id,team.id,approver.userId]);
        await audit(c, approver, "trusted_bootstrap", { unitId: team.id },
          { administratorUserId: actor.userId, evidence: input.evidence });
        return team;
      });
    },
    /** The insertion callback is trusted server code, not arbitrary HTTP input. */
    assignOwnership(actor: VerifiedPrincipal, input: OwnershipInput, insertRecord: (client: Client) => Promise<void>) {
      return transaction(async c => {
        await admin(c, actor, input.groupId);
        await activeOwner(c, input.groupId, input.accountableOwnerId);
        const existing = await c.query(`SELECT id FROM ${input.resource.type === "campaign" ? "campaigns" : "activities"} WHERE id=$1`,
          [input.resource.id]);
        if (existing.rowCount) deny();
        await insertRecord(c);
        await assign(c, actor, input);
      });
    },
    mapHistoricalOwnership(actor: VerifiedPrincipal, input: OwnershipInput & { evidence: string }) {
      return transaction(async c => {
        if (!input.evidence.trim()) deny();
        await assign(c, actor, input, input.evidence);
      });
    },
    participate(actor: VerifiedPrincipal, campaignId: string, groupId: string) {
      return transaction(async c => {
        const owner = (await c.query(`SELECT o.group_id,u.parent_id FROM campaign_ownership o
          JOIN organization_units u ON u.id=o.group_id WHERE o.campaign_id=$1`, [campaignId])).rows[0];
        if (!owner) deny();
        await admin(c, actor, owner.group_id);
        await admin(c, actor, groupId);
        const dest = (await c.query("SELECT * FROM organization_units WHERE id=$1", [groupId])).rows[0];
        if (!dest || dest.status !== "active" || dest.parent_id !== owner.parent_id) deny();
        await activeOwner(c, groupId, dest.accountable_owner_id);
        await c.query(`INSERT INTO campaign_group_participation(campaign_id,group_id,created_by)
          VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [campaignId,groupId,actor.userId]);
        await audit(c, actor, "participation_added", { campaignId }, { groupId, accessGranted: false });
      });
    },
    setCalendarVisibility(actor: VerifiedPrincipal, activityId: string, visibility: "private" | "summary") {
      return transaction(async c => {
        await check(c, actor, "plan", { type: "activity", id: activityId });
        // Collaborators cannot publish the owning group's private draft into oversight.
        const owner = (await c.query("SELECT group_id FROM activity_ownership WHERE activity_id=$1", [activityId])).rows[0];
        if (!(await memberships(c, actor.userId)).some(m => m.unit_id === owner.group_id)) deny();
        await c.query(`UPDATE activity_ownership SET calendar_visibility=$2,row_version=row_version+1,updated_at=now()
          WHERE activity_id=$1`, [activityId,visibility]);
        await audit(c, actor, "calendar_visibility_changed", { activityId }, { visibility });
      });
    },
    requestTransfer(actor: VerifiedPrincipal, resource: OrganizationResource, destinationGroupId: string) {
      return transaction(async c => {
        const owner = (await c.query(`SELECT * FROM ${resource.type}_ownership WHERE ${resource.type}_id=$1`, [resource.id])).rows[0];
        if (!owner || owner.group_id === destinationGroupId) deny();
        await admin(c, actor, owner.group_id);
        const units = (await c.query("SELECT * FROM organization_units WHERE id=ANY($1::uuid[])", [[owner.group_id,destinationGroupId]])).rows;
        const src = units.find(u => u.id === owner.group_id), dest = units.find(u => u.id === destinationGroupId);
        if (!src || !dest || src.parent_id !== dest.parent_id) deny();
        await activeOwner(c, destinationGroupId, dest.accountable_owner_id);
        const row = (await c.query(`INSERT INTO organization_transfers(campaign_id,activity_id,source_group_id,destination_group_id,requested_by)
          VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [resource.type === "campaign" ? resource.id : null,resource.type === "activity" ? resource.id : null,owner.group_id,destinationGroupId,actor.userId])).rows[0];
        await audit(c, actor, "transfer_requested", { unitId: owner.group_id },
          { transferId: row.id, resource, destinationGroupId, expectedOwnershipVersion: owner.row_version });
        return row;
      });
    },
    acceptTransfer(actor: VerifiedPrincipal, transferId: string) {
      return transaction(async c => {
        await identity(c, actor);
        const transfer = (await c.query("SELECT * FROM organization_transfers WHERE id=$1", [transferId])).rows[0];
        if (!transfer || transfer.status !== "pending" || transfer.requested_by === actor.userId) deny();
        const dest = (await c.query("SELECT * FROM organization_units WHERE id=$1", [transfer.destination_group_id])).rows[0];
        if (dest?.accountable_owner_id !== actor.userId) deny();
        await activeOwner(c, dest.id, actor.userId);
        await c.query(`UPDATE organization_transfers SET accepted_by=$2,accepted_at=now(),status='accepted',row_version=row_version+1 WHERE id=$1`,
          [transferId,actor.userId]);
        await audit(c, actor, "transfer_accepted", { unitId: dest.id }, { transferId });
      });
    },
    completeTransfer(actor: VerifiedPrincipal, transferId: string) {
      return transaction(async c => {
        const t = (await c.query("SELECT * FROM organization_transfers WHERE id=$1", [transferId])).rows[0];
        if (!t || t.status !== "accepted" || !t.accepted_by || t.accepted_by === actor.userId) deny();
        await admin(c, actor, t.source_group_id);
        const dest = (await c.query("SELECT * FROM organization_units WHERE id=$1", [t.destination_group_id])).rows[0];
        if (dest?.accountable_owner_id !== t.accepted_by) deny();
        await activeOwner(c, dest.id, t.accepted_by);
        const type = t.activity_id ? "activity" : "campaign", id = t.activity_id ?? t.campaign_id;
        const prior = (await c.query(`SELECT * FROM ${type}_ownership WHERE ${type}_id=$1`, [id])).rows[0];
        if (!prior || prior.group_id !== t.source_group_id) deny();
        const requestAudit = (await c.query(`SELECT details FROM organization_audit
          WHERE action='transfer_requested' AND actor_id=$1 AND details->>'transferId'=$2
          ORDER BY created_at,id`, [t.requested_by,transferId])).rows;
        // The retained request audit captures the reviewed ownership revision without
        // overloading the transfer row's independent workflow revision.
        if (requestAudit.length !== 1
          || requestAudit[0].details.expectedOwnershipVersion !== prior.row_version) deny();
        const campaignId = type === "campaign" ? id : prior.campaign_id;
        const campaignOwner = (await c.query(`SELECT u.parent_id FROM campaign_ownership o
          JOIN organization_units u ON u.id=o.group_id WHERE o.campaign_id=$1`, [campaignId])).rows[0];
        if (campaignOwner?.parent_id !== dest.parent_id) deny();
        await c.query(`INSERT INTO campaign_group_participation(campaign_id,group_id,created_by)
          VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [campaignId,dest.id,actor.userId]);
        const revoked = (await c.query(`UPDATE organization_grants SET status='revoked',revoked_at=now()
          WHERE ${type}_id=$1 AND status='active' RETURNING id`, [id])).rows.map(r => r.id);
        await c.query(`UPDATE ${type}_ownership SET group_id=$2,accountable_owner_id=$3,
          reassessment_required=true,row_version=row_version+1,updated_at=now()
          ${type === "activity" ? ",calendar_visibility='private'" : ""} WHERE ${type}_id=$1`, [id,dest.id,t.accepted_by]);
        await c.query(`UPDATE organization_transfers SET status='completed',row_version=row_version+1 WHERE id=$1`, [transferId]);
        await c.query(`UPDATE organization_transfers SET status='cancelled',row_version=row_version+1
          WHERE ${type}_id=$1 AND id<>$2 AND status IN ('pending','accepted')`, [id,transferId]);
        await audit(c, actor, "transfer_completed", type === "activity" ? { activityId: id } : { campaignId: id },
          { transferId, prior, destinationGroupId: dest.id, acceptedBy: t.accepted_by, revokedGrantIds: revoked,
            reassessmentRequired: true, descendantsRetained: true });
      });
    },
    archiveGroup(actor: VerifiedPrincipal, groupId: string) {
      return transaction(async c => {
        await admin(c, actor, groupId);
        const group = (await c.query("SELECT * FROM organization_units WHERE id=$1", [groupId])).rows[0];
        if (!group || group.kind !== "group" || group.status !== "active") deny();
        await activeOwner(c, groupId, group.accountable_owner_id);
        const work = await c.query(`SELECT 1 FROM campaign_ownership o JOIN campaigns r ON r.id=o.campaign_id
          WHERE o.group_id=$1 AND lower(r.lifecycle) NOT IN ('completed','cancelled','archived')
          UNION ALL SELECT 1 FROM activity_ownership o JOIN activities r ON r.id=o.activity_id
          WHERE o.group_id=$1 AND lower(r.status) NOT IN ('completed','cancelled','archived')`, [groupId]);
        if (work.rowCount) deny();
        await c.query("UPDATE organization_units SET status='archived',row_version=row_version+1,updated_at=now() WHERE id=$1", [groupId]);
        await audit(c, actor, "group_archived", { unitId: groupId }, { historicalAccessRequiresGrant: true });
      });
    },
    authorize(principal: VerifiedPrincipal | null, action: OrganizationAction, resource: OrganizationResource, requesterUserId?: string) {
      return transaction(c => check(c, principal, action, resource, requesterUserId));
    },
    withAuthorized<T>(principal: VerifiedPrincipal | null, action: OrganizationAction, resource: OrganizationResource,
      work: (client: Client) => Promise<T>, requesterUserId?: string) {
      return transaction(async c => { await check(c, principal, action, resource, requesterUserId); return work(c); });
    },
    visibleIds(principal: VerifiedPrincipal | null, type: "campaign" | "activity", action: OrganizationAction = "read", input: { limit?: unknown; offset?: unknown } = {}) {
      const page = pagination(input);
      return transaction(async c => {
        await identity(c, principal);
        const table = type === "campaign" ? "campaign_ownership" : "activity_ownership";
        const key = type === "campaign" ? "campaign_id" : "activity_id";
        const ids: string[] = [];
        let cursor: string | null = null;
        let total = 0;
        for (;;) {
          const rows: { id: string }[] = (await c.query(`SELECT ${key} AS id FROM ${table} WHERE ($1::uuid IS NULL OR ${key}>$1) ORDER BY ${key} LIMIT 200`, [cursor])).rows;
          if (!rows.length) break;
          for (const row of rows) {
            try { await check(c, principal, action, { type, id: row.id }); }
            catch (error) { if (error instanceof OrganizationAccessError) continue; throw error; }
            if (total >= page.offset && ids.length < page.limit) ids.push(row.id);
            total++;
          }
          cursor = rows[rows.length - 1].id;
        }
        return { items: ids, total, returned: ids.length, nextOffset: total > page.offset + page.limit ? page.offset + page.limit : null };
      });
    },
    calendarSummary(principal: VerifiedPrincipal | null, input: { limit?: unknown; offset?: unknown; groupId?: string } = {}) {
      const page = pagination(input);
      return transaction(async c => {
        await identity(c, principal);
        const summaries: CalendarSummary[] = [];
        let cursor: string | null = null;
        let total = 0;
        for (;;) {
        const rows: { id: string; name: string; type: string; status: string; group_id: string; accountable_owner_id: string; group_name: string; owner_name: string }[] = (await c.query(
          `SELECT a.id,a.name,a.type,a.status,o.group_id,o.accountable_owner_id,
           u.name AS group_name,p.name AS owner_name FROM activities a
           JOIN activity_ownership o ON o.activity_id=a.id
           JOIN organization_units u ON u.id=o.group_id JOIN users p ON p.id=o.accountable_owner_id
           WHERE o.calendar_visibility='summary' AND ($1::uuid IS NULL OR a.id>$1)
           AND ($2::uuid IS NULL OR o.group_id=$2) ORDER BY a.id LIMIT 200`, [cursor, input.groupId ?? null],
        )).rows;
        if (!rows.length) break;
        for (const row of rows) {
          try { await check(c, principal, "calendar_summary", { type: "activity", id: row.id }); }
          catch (error) { if (error instanceof OrganizationAccessError) continue; throw error; }
          total++;
          if (total <= page.offset || summaries.length >= page.limit) continue;
          const dates = (await c.query(
            `SELECT id AS "occurrenceId",session_date::text AS date,start_time::text AS time,
             timezone,duration_minutes AS "durationMinutes" FROM webinar_sessions
             WHERE activity_id=$1 ORDER BY session_date,start_time,id`, [row.id],
          )).rows;
          summaries.push({ activityId: row.id, title: row.name, activityType: row.type,
            planningStatus: row.status, owningGroup: { id: row.group_id, name: row.group_name },
            accountableOwner: { id: row.accountable_owner_id, name: row.owner_name }, dates });
        }
        cursor = rows[rows.length - 1].id;
        }
        return { items: summaries, total, returned: summaries.length, nextOffset: total > page.offset + page.limit ? page.offset + page.limit : null };
      });
    },
    createGroup(actor: VerifiedPrincipal, input: { parentId: string; name: string; accountableOwnerId: string; administratorUserId: string; verificationEvidence: string }) {
      return transaction(async c => {
        await admin(c, actor, input.parentId);
        if (!input.verificationEvidence.trim() || actor.userId === input.accountableOwnerId
          || actor.userId === input.administratorUserId) deny();
        const group = (await c.query(
          `INSERT INTO organization_units(name,kind,parent_id,status,accountable_owner_id)
           VALUES($1,'group',$2,'active',$3) RETURNING *`,
          [input.name, input.parentId, input.accountableOwnerId],
        )).rows[0];
        await c.query(`INSERT INTO organization_memberships(unit_id,user_id,status,verified_by,verified_at)
          VALUES($1,$2,'active',$3,now())`, [group.id, input.accountableOwnerId, actor.userId]);
        if (input.administratorUserId !== input.accountableOwnerId) {
          await c.query(`INSERT INTO organization_memberships(unit_id,user_id,status,verified_by,verified_at)
            VALUES($1,$2,'active',$3,now())`, [group.id,input.administratorUserId,actor.userId]);
        }
        await c.query(`INSERT INTO organization_grants(membership_id,unit_id,role,granted_by)
          SELECT id,$1,'administrator',$3 FROM organization_memberships WHERE unit_id=$1 AND user_id=$2 AND status='active'`,
        [group.id,input.administratorUserId,actor.userId]);
        await audit(c, actor, "group_created", { unitId: group.id }, input);
        return group;
      });
    },
    verifyMembership(actor: VerifiedPrincipal, input: { unitId: string; userId: string; evidence: string }) {
      return transaction(async c => {
        await admin(c, actor, input.unitId);
        if (actor.userId === input.userId || !input.evidence.trim()) deny();
        const unit = (await c.query("SELECT status FROM organization_units WHERE id=$1", [input.unitId])).rows[0];
        if (unit?.status !== "active") deny();
        const row = (await c.query(`INSERT INTO organization_memberships(unit_id,user_id,status,verified_by,verified_at)
          VALUES($1,$2,'active',$3,now()) RETURNING *`, [input.unitId, input.userId, actor.userId])).rows[0];
        await audit(c, actor, "membership_verified", input, { membershipId: row.id, evidence: input.evidence });
        return row;
      });
    },
    grant(actor: VerifiedPrincipal, input: GrantInput) {
      return transaction(async c => {
        if ([input.unitId, input.campaignId, input.activityId].filter(Boolean).length !== 1
          || [input.membershipId, input.recipientGroupId].filter(Boolean).length !== 1
          || [input.role, input.action].filter(Boolean).length !== 1) deny();
        let scopeGroup = input.unitId;
        if (!scopeGroup) {
          const type = input.activityId ? "activity" : "campaign";
          const row = (await c.query(`SELECT group_id FROM ${type}_ownership WHERE ${type}_id=$1`,
            [input.activityId ?? input.campaignId])).rows[0];
          if (!row) deny();
          scopeGroup = row.group_id;
        }
        await admin(c, actor, scopeGroup!);
        let recipientUnit = input.recipientGroupId;
        if (input.membershipId) {
          const member = (await c.query("SELECT * FROM organization_memberships WHERE id=$1 AND status='active'", [input.membershipId])).rows[0];
          if (!member || member.user_id === actor.userId) deny();
          recipientUnit = member.unit_id;
        } else {
          const self = await c.query("SELECT id FROM organization_memberships WHERE user_id=$1 AND unit_id=$2 AND status='active'",
            [actor.userId, recipientUnit]);
          if (self.rowCount || input.role) deny();
        }
        const units = (await c.query("SELECT * FROM organization_units WHERE id=ANY($1::uuid[])", [[scopeGroup, recipientUnit]])).rows;
        const scope = units.find(u => u.id === scopeGroup), recipient = units.find(u => u.id === recipientUnit);
        if (!scope || !recipient || scope.status !== "active" || recipient.status !== "active") deny();
        if (scope.id !== recipient.id) {
          if (input.role && input.role !== "administrator") deny();
          const sameParent = scope.parent_id && scope.parent_id === recipient.parent_id;
          const parentCalendar = input.action === "calendar_view" && scope.parent_id === recipient.id;
          const parentAdmin = input.role === "administrator" && scope.parent_id === recipient.id;
          if (!sameParent && !parentCalendar && !parentAdmin) deny();
          if (!parentCalendar && !parentAdmin && !input.activityId && !input.campaignId) deny();
        }
        if (input.action === "calendar_view" && (!input.unitId || scope.kind !== "group")) deny();
        const row = (await c.query(
          `INSERT INTO organization_grants(membership_id,recipient_group_id,unit_id,campaign_id,activity_id,role,action,status,granted_by,expires_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9) RETURNING *`,
          [input.membershipId ?? null,input.recipientGroupId ?? null,input.unitId ?? null,input.campaignId ?? null,
            input.activityId ?? null,input.role ?? null,input.action ?? null,actor.userId,input.expiresAt ?? null],
        )).rows[0];
        await audit(c, actor, "grant_created", { unitId: scopeGroup }, { grantId: row.id, ...input });
        return row;
      });
    },
    revokeGrant(actor: VerifiedPrincipal, grantId: string) {
      return transaction(async c => {
        const g = (await c.query("SELECT * FROM organization_grants WHERE id=$1", [grantId])).rows[0];
        if (!g) deny();
        let groupId = g.unit_id;
        if (!groupId) {
          const type = g.activity_id ? "activity" : "campaign";
          groupId = (await c.query(`SELECT group_id FROM ${type}_ownership WHERE ${type}_id=$1`,
            [g.activity_id ?? g.campaign_id])).rows[0]?.group_id;
        }
        if (!groupId) deny();
        await admin(c, actor, groupId);
        await c.query("UPDATE organization_grants SET status='revoked',revoked_at=now() WHERE id=$1", [grantId]);
        await audit(c, actor, "grant_revoked", { unitId: groupId }, { grantId });
      });
    },
    revokeMembership(actor: VerifiedPrincipal, membershipId: string) {
      return transaction(async c => {
        const member = (await c.query("SELECT * FROM organization_memberships WHERE id=$1", [membershipId])).rows[0];
        if (!member) deny();
        await admin(c, actor, member.unit_id);
        // Immediate revocation wins over staffing. Owner-less groups cannot obtain new work.
        await c.query("UPDATE organization_memberships SET status='revoked',revoked_at=now(),row_version=row_version+1 WHERE id=$1", [membershipId]);
        await c.query("UPDATE organization_grants SET status='revoked',revoked_at=now() WHERE membership_id=$1 AND status='active'", [membershipId]);
        await audit(c, actor, "membership_revoked", { unitId: member.unit_id }, { membershipId });
      });
    },
  };
}