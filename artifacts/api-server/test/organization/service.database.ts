/** Run only through lib/db/test/disposable-db.mjs, never against a shared database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { createOrganizationService, type VerifiedPrincipal } from "../../src/lib/organization/service";

after(() => pool.end());

test("organization database lifecycle: explicit grants, revocation, calendar, transfer and archive", async () => {
  const service = createOrganizationService();
  const people = await Promise.all(["admin", "witness", "a-owner", "b-owner", "planner", "leader"].map(async name => {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,name,email) VALUES($1,$2,$3)", [id,name,`${id}@fixture.invalid`]);
    return { userId: id, issuer: "isolated-fixture", subject: id } satisfies VerifiedPrincipal;
  }));
  const [admin, witness, aOwner, bOwner, planner, leader] = people;
  // Existing independent suites may have fixtures: trusted bootstrap is tested separately by empty-check.
  const teamId = randomUUID();
  await pool.query(`INSERT INTO organization_units(id,name,kind,accountable_owner_id) VALUES($1,'Team','team',$2)`, [teamId,admin.userId]);
  const adminMembership = (await pool.query(`INSERT INTO organization_memberships(unit_id,user_id,verified_by)
    VALUES($1,$2,$3) RETURNING id`, [teamId,admin.userId,witness.userId])).rows[0].id;
  await pool.query(`INSERT INTO organization_grants(membership_id,unit_id,role,granted_by)
    VALUES($1,$2,'administrator',$3)`, [adminMembership,teamId,witness.userId]);
  await assert.rejects(service.bootstrapTeam(admin, witness, { name: "second", evidence: "approved" }));
  const a = await service.createGroup(admin, { parentId: teamId, name: "A", accountableOwnerId: aOwner.userId,
    administratorUserId: aOwner.userId, verificationEvidence: "owner attestation A" });
  const b = await service.createGroup(admin, { parentId: teamId, name: "B", accountableOwnerId: bOwner.userId,
    administratorUserId: bOwner.userId, verificationEvidence: "owner attestation B" });
  const plannerA = await service.verifyMembership(aOwner, { unitId: a.id, userId: planner.userId, evidence: "verified" });
  await service.verifyMembership(bOwner, { unitId: b.id, userId: planner.userId, evidence: "verified" });
  await service.grant(aOwner, { membershipId: plannerA.id, unitId: a.id, role: "planner" });
  await assert.rejects(service.grant(aOwner, { membershipId: (await pool.query(
    "SELECT id FROM organization_memberships WHERE unit_id=$1 AND user_id=$2", [a.id,aOwner.userId])).rows[0].id,
  unitId: a.id, role: "independent_reviewer" }));
  const campaignA = randomUUID(), campaignB = randomUUID();
  async function campaign(id: string, groupId: string, actor: VerifiedPrincipal) {
    await service.assignOwnership(actor, { resource: { type: "campaign", id }, groupId, accountableOwnerId: actor.userId },
      async c => { await c.query(`INSERT INTO campaigns(id,name,scope,audience,outcome) VALUES($1,'Campaign','Global','Test','Test')`, [id]); });
  }
  await campaign(campaignA,a.id,aOwner); await campaign(campaignB,b.id,bOwner);
  async function activity(campaignId: string, groupId: string, actor: VerifiedPrincipal, visibility: "private" | "summary") {
    const id = randomUUID();
    await service.assignOwnership(actor, { resource: { type: "activity", id }, groupId,
      accountableOwnerId: actor.userId, calendarVisibility: visibility }, async c => {
      await c.query(`INSERT INTO activities(id,campaign_id,name,type,audience,region,timing,status,owner,x,y)
        VALUES($1,$2,'Activity','Webinar','Test','Global','TBD','Tentative','old textual owner',0,0)`, [id,campaignId]);
    });
    return id;
  }
  const publicA = await activity(campaignA,a.id,aOwner,"summary");
  const privateA = await activity(campaignA,a.id,aOwner,"private");
  const publicB = await activity(campaignB,b.id,bOwner,"summary");
  await service.authorize(planner,"plan",{ type: "activity", id: publicA });
  await assert.rejects(service.authorize(planner,"plan",{ type: "activity", id: publicB }));
  assert.deepEqual(new Set((await service.visibleIds(planner,"activity")).items),new Set([publicA,privateA]));
  const leaderMembership = await service.verifyMembership(admin, { unitId: teamId, userId: leader.userId, evidence: "designated leader" });
  await service.grant(aOwner, { membershipId: leaderMembership.id, unitId: a.id, action: "calendar_view" });
  await pool.query(`INSERT INTO webinar_sessions(campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform)
    VALUES($1,$2,'First','2026-11-01','01:30',60,'America/New_York','manual'),
    ($1,$2,'Second','2026-11-02','13:00',45,'Europe/London','manual')`, [campaignA,publicA]);
  const calendar = (await service.calendarSummary(leader)).items;
  assert.equal(calendar.length,1);
  assert.equal(calendar[0].activityId,publicA);
  assert.equal(calendar[0].planningStatus,"Tentative");
  assert.equal(calendar[0].dates.length,2);
  assert.deepEqual(calendar[0].dates.map(d => d.timezone),["America/New_York","Europe/London"]);
  assert.deepEqual(Object.keys(calendar[0]).sort(),
    ["accountableOwner","activityId","activityType","dates","owningGroup","planningStatus","title"]);
  await pool.query("UPDATE activities SET status='Cancelled' WHERE id=$1",[publicA]);
  await pool.query("UPDATE webinar_sessions SET session_date='2026-11-03' WHERE activity_id=$1 AND name='First'",[publicA]);
  const rescheduled = (await service.calendarSummary(leader)).items;
  assert.equal(rescheduled[0].planningStatus,"Cancelled");
  assert.equal(rescheduled[0].dates[1].date,"2026-11-03");
  assert.equal(rescheduled[0].activityId,publicA);
  const concurrent = await Promise.all(Array.from({length:20},(_,i) =>
    service.visibleIds(i % 2 ? leader : planner,"activity")));
  concurrent.forEach((page,i) => assert.deepEqual(new Set(page.items),new Set(i % 2 ? [] : [publicA,privateA])));
  await assert.rejects(service.authorize(leader,"read",{ type: "activity", id: publicA }));
  await assert.rejects(service.authorize(leader,"execute",{ type: "activity", id: publicA }));
  const collaboration = await service.grant(bOwner, { membershipId: plannerA.id, activityId: publicB, action: "record_view" });
  await service.authorize(planner,"read",{ type: "activity", id: publicB });
  await assert.rejects(service.authorize(planner,"participants",{ type: "activity", id: publicB }));
  await service.revokeGrant(bOwner,collaboration.id);
  await assert.rejects(service.withAuthorized(planner,"read",{ type: "activity", id: publicB },async () => "queued"));
  await assert.rejects(service.archiveGroup(aOwner,a.id));
  const staleTransfer = await service.requestTransfer(aOwner,{ type: "activity", id: publicA },b.id);
  await service.acceptTransfer(bOwner,staleTransfer.id);
  await service.setCalendarVisibility(planner,publicA,"summary"); // Reviewed ownership revision has changed.
  await assert.rejects(service.completeTransfer(aOwner,staleTransfer.id));
  assert.equal((await pool.query("SELECT group_id FROM activity_ownership WHERE activity_id=$1",[publicA])).rows[0].group_id,a.id);
  const transfer = await service.requestTransfer(aOwner,{ type: "activity", id: publicA },b.id);
  await assert.rejects(service.acceptTransfer(aOwner,transfer.id));
  await service.acceptTransfer(bOwner,transfer.id);
  await service.completeTransfer(aOwner,transfer.id);
  assert.equal((await pool.query("SELECT status FROM organization_transfers WHERE id=$1",[staleTransfer.id])).rows[0].status,"cancelled");
  await assert.rejects(service.completeTransfer(aOwner,staleTransfer.id));
  const transferred = (await pool.query("SELECT * FROM activity_ownership WHERE activity_id=$1",[publicA])).rows[0];
  assert.equal(transferred.group_id,b.id);
  assert.equal(transferred.reassessment_required,true);
  assert.equal(transferred.calendar_visibility,"private");
  assert.equal((await pool.query("SELECT owner FROM activities WHERE id=$1",[publicA])).rows[0].owner,"old textual owner");
  await assert.rejects(service.authorize(planner,"read",{ type: "activity", id: publicA }));
  assert.equal((await service.calendarSummary(leader)).items.length,0);
  await service.setCalendarVisibility(planner,privateA,"summary");
  const historicalViewer = await service.verifyMembership(aOwner,{unitId:a.id,userId:witness.userId,evidence:"historical reporting"});
  await service.grant(aOwner,{membershipId:historicalViewer.id,activityId:privateA,action:"record_view"});
  await service.grant(aOwner,{membershipId:historicalViewer.id,unitId:a.id,role:"read_only_viewer"});
  await service.revokeMembership(aOwner,plannerA.id);
  let executed = false;
  await assert.rejects(service.withAuthorized(planner,"plan",{ type: "activity", id: privateA },async () => { executed=true; }));
  assert.equal(executed,false);
  await pool.query("UPDATE activities SET status='Completed' WHERE id=$1",[privateA]);
  await pool.query("UPDATE campaigns SET lifecycle='Completed' WHERE id=$1",[campaignA]);
  await service.archiveGroup(aOwner,a.id);
  await service.authorize(witness,"read",{type:"activity",id:privateA});
  await assert.rejects(service.authorize(witness,"read",{type:"campaign",id:campaignA}));
  assert.equal((await service.calendarSummary(leader)).items[0].activityId,privateA);
  await assert.rejects(service.authorize(witness,"plan",{type:"activity",id:privateA}));
  await assert.rejects(service.verifyMembership(aOwner,{unitId:a.id,userId:witness.userId,evidence:"no new work"}));
  await assert.rejects(service.mapHistoricalOwnership(bOwner,{ resource:{ type:"activity",id:publicB },
    groupId:b.id,accountableOwnerId:bOwner.userId,evidence:"new IDs cannot masquerade as legacy" }));
  const audit = await pool.query("SELECT action FROM organization_audit WHERE activity_id=$1",[publicA]);
  assert.ok(audit.rows.some(row => row.action==="transfer_completed"));
});

test("complete calendar population is stable, unique and unscheduled dates stay empty", async () => {
  const service = createOrganizationService();
  const ownerId=randomUUID(), viewerId=randomUUID(), teamId=randomUUID(), groupId=randomUUID(), campaignId=randomUUID();
  for (const id of [ownerId,viewerId])
    await pool.query("INSERT INTO users(id,name,email) VALUES($1,'Synthetic staff',$2)",[id,`${id}@fixture.invalid`]);
  await pool.query("INSERT INTO organization_units(id,name,kind,accountable_owner_id) VALUES($1,'Population team','team',$2)",[teamId,ownerId]);
  await pool.query(`INSERT INTO organization_units(id,name,kind,parent_id,accountable_owner_id)
    VALUES($1,'Population group','group',$2,$3)`,[groupId,teamId,ownerId]);
  await pool.query("INSERT INTO organization_memberships(unit_id,user_id,verified_by) VALUES($1,$2,$3)",[groupId,ownerId,viewerId]);
  const member = (await pool.query("INSERT INTO organization_memberships(unit_id,user_id,verified_by) VALUES($1,$2,$3) RETURNING id",
    [teamId,viewerId,ownerId])).rows[0].id;
  await pool.query(`INSERT INTO organization_grants(membership_id,unit_id,action,granted_by)
    VALUES($1,$2,'calendar_view',$3)`,[member,groupId,ownerId]);
  await pool.query(`INSERT INTO campaigns(id,name,scope,audience,outcome) VALUES($1,'Population','Global','Test','Test')`,[campaignId]);
  await pool.query(`INSERT INTO campaign_group_participation(campaign_id,group_id,created_by) VALUES($1,$2,$3)`,[campaignId,groupId,ownerId]);
  await pool.query(`INSERT INTO campaign_ownership(campaign_id,group_id,accountable_owner_id,created_by) VALUES($1,$2,$3,$3)`,
    [campaignId,groupId,ownerId]);
  const expected = Array.from({length:121},()=>randomUUID()).sort();
  for (const id of expected) {
    await pool.query(`INSERT INTO activities(id,campaign_id,name,type,audience,region,timing,status,owner,x,y)
      VALUES($1,$2,'Unscheduled','Other','Test','Global','next spring','Tentative','label',0,0)`,[id,campaignId]);
    await pool.query(`INSERT INTO activity_ownership(activity_id,campaign_id,group_id,accountable_owner_id,created_by,calendar_visibility)
      VALUES($1,$2,$3,$4,$4,'summary')`,[id,campaignId,groupId,ownerId]);
  }
  const viewer = { userId:viewerId,issuer:"isolated-fixture",subject:viewerId };
  const result = await service.calendarSummary(viewer);
  assert.equal(result.total,121);
  assert.equal(result.returned,100);
  assert.equal(result.nextOffset,100);
  const second = await service.calendarSummary(viewer,{offset:result.nextOffset!});
  assert.equal(second.nextOffset,null);
  assert.deepEqual([...result.items,...second.items].map(row=>row.activityId),expected);
  assert.ok(result.items.every(row=>row.dates.length===0));
  assert.deepEqual(await service.calendarSummary(viewer),result);
});