import assert from "node:assert/strict";

const ids = {
  campaign: "00220000-0000-4000-8000-000000000001",
  activity: "00220000-0000-4000-8000-000000000002",
};

export async function seedPriorOrganizationFixture(client) {
  await client.query(`INSERT INTO campaigns(id,name,scope,audience,outcome,owner)
    VALUES ($1,'Synthetic historical campaign','Global','Synthetic audience','Preserve evidence','Unknown historic owner')`, [ids.campaign]);
  await client.query(`INSERT INTO activities(id,campaign_id,name,type,audience,region,timing,status,owner,x,y,activity_answers)
    VALUES ($1,$2,'Synthetic legacy activity','Webinar','Synthetic audience','Global','TBD','Draft','Historic label',0,0,'{"historicalEvidence":"unchanged"}')`, [ids.activity, ids.campaign]);
  await client.query(`INSERT INTO communications(campaign_id,activity_id,name,status)
    VALUES ($1,$2,'Synthetic historical communication','Draft')`, [ids.campaign, ids.activity]);
  await client.query(`INSERT INTO budgets(campaign_id,amount,currency,status) VALUES ($1,123.45,'USD','Draft')`, [ids.campaign]);
  for (const template of ["legacy_9", "default_5"]) {
    await client.query(`INSERT INTO webinar_sessions
      (campaign_id,activity_id,name,session_date,start_time,duration_minutes,timezone,platform,template_version)
      VALUES ($1,$2,$3,'2026-06-15','10:00',60,'America/New_York','Synthetic test platform',$3)`,
    [ids.campaign, ids.activity, template]);
  }
}

// Capture every prior table, not merely ownership-relevant fields. JSONB row
// text includes evidence, timestamps and generated values without JS date loss.
export async function priorPayloadSnapshot(client) {
  const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const payload = {};
  for (const { tablename } of tables.rows) {
    const escaped = tablename.replaceAll('"', '""');
    payload[tablename] = (await client.query(`SELECT to_jsonb(t)::text AS row FROM "${escaped}" t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return payload;
}

export async function assertPriorPayloadUnchanged(client, before) {
  for (const [table, rows] of Object.entries(before)) {
    const escaped = table.replaceAll('"', '""');
    assert.deepEqual((await client.query(`SELECT to_jsonb(t)::text AS row FROM "${escaped}" t ORDER BY to_jsonb(t)::text`)).rows, rows, `Payload drift: ${table}`);
  }
  assert.deepEqual((await client.query("SELECT campaign_id FROM legacy_campaigns")).rows, [{ campaign_id: ids.campaign }]);
  assert.deepEqual((await client.query("SELECT activity_id FROM legacy_activities")).rows, [{ activity_id: ids.activity }]);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM campaign_ownership")).rows[0].n, 0);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM activity_ownership")).rows[0].n, 0);
}

export async function checkOrganizationConstraints(client, mode) {
  await client.query("BEGIN");
  let assertions = 0;
  const fails = async (sql, params = []) => {
    await client.query("SAVEPOINT invalid");
    await assert.rejects(client.query(sql, params));
    await client.query("ROLLBACK TO SAVEPOINT invalid");
    assertions++;
  };
  const insert = async (sql, params = []) => (await client.query(sql + " RETURNING id", params)).rows[0].id;
  try {
    const actor = await insert("INSERT INTO users(name,email) VALUES ('Synthetic verifier','org-fixture@example.invalid')");
    const team = await insert("INSERT INTO organization_units(name,kind) VALUES ('Team','team')");
    const group = await insert("INSERT INTO organization_units(name,kind,parent_id,accountable_owner_id) VALUES ('Group','group',$1,$2)", [team, actor]);
    await fails("INSERT INTO organization_units(name,kind,parent_id,accountable_owner_id) VALUES ('Third level','group',$1,$2)", [group, actor]);
    await fails("INSERT INTO organization_units(name,kind,parent_id) VALUES ('Ownerless','group',$1)", [team]);
    await fails("UPDATE organization_units SET accountable_owner_id=NULL WHERE id=$1", [group]);
    const member = await insert("INSERT INTO organization_memberships(unit_id,user_id,verified_by) VALUES ($1,$2,$2)", [group, actor]);
    await fails("INSERT INTO organization_memberships(unit_id,user_id,verified_by) VALUES ($1,$2,$2)", [group, actor]);
    await fails("INSERT INTO organization_memberships(unit_id,user_id,verified_by) VALUES ($1,gen_random_uuid(),$2)", [group, actor]);
    await client.query("INSERT INTO organization_grants(membership_id,unit_id,action,granted_by) VALUES ($1,$2,'calendar_view',$3)", [member, group, actor]);
    await fails("INSERT INTO organization_grants(membership_id,unit_id,action,granted_by) VALUES ($1,$2,'calendar_view',$3)", [member, group, actor]);
    await fails("INSERT INTO organization_grants(membership_id,unit_id,action,granted_by) VALUES ($1,$2,'calendar_view',$3)", [member, team, actor]);
    const campaign = await insert("INSERT INTO campaigns(name,scope,audience,outcome) VALUES ('New','Global','Test','Test')");
    const activity = await insert("INSERT INTO activities(campaign_id,name,type,audience,region,timing,status,owner,x,y) VALUES ($1,'New activity','Webinar','Test','Global','TBD','Draft','Test',0,0)", [campaign]);
    await fails("INSERT INTO legacy_campaigns(campaign_id) VALUES ($1)", [campaign]);
    await fails("INSERT INTO legacy_activities(activity_id) VALUES ($1)", [activity]);
    await fails("TRUNCATE legacy_activities");
    await fails("UPDATE legacy_campaigns SET recorded_at=now()");
    await fails("INSERT INTO campaign_ownership(campaign_id,group_id,accountable_owner_id) VALUES ($1,$2,$3)", [campaign, group, actor]);
    await client.query("INSERT INTO campaign_ownership(campaign_id,group_id,accountable_owner_id,created_by) VALUES ($1,$2,$3,$3)", [campaign, group, actor]);
    await fails("INSERT INTO campaign_ownership(campaign_id,group_id,accountable_owner_id,created_by) VALUES ($1,$2,$3,$3)", [campaign, group, actor]);
    await fails("INSERT INTO activity_ownership(activity_id,campaign_id,group_id,accountable_owner_id,created_by) VALUES ($1,$2,$3,$4,$4)", [activity, campaign, group, actor]);
    // A separately owning group participates without receiving any access grant.
    const other = await insert("INSERT INTO organization_units(name,kind,parent_id,accountable_owner_id) VALUES ('Other','group',$1,$2)", [team, actor]);
    await client.query("INSERT INTO campaign_group_participation(campaign_id,group_id,created_by) VALUES ($1,$2,$3)", [campaign, other, actor]);
    await client.query("INSERT INTO activity_ownership(activity_id,campaign_id,group_id,accountable_owner_id,created_by) VALUES ($1,$2,$3,$4,$4)", [activity, campaign, other, actor]);
    assert.equal((await client.query("SELECT calendar_visibility FROM activity_ownership WHERE activity_id=$1", [activity])).rows[0].calendar_visibility, "private");
    assert.equal((await client.query("SELECT count(*)::int n FROM legacy_campaigns WHERE campaign_id=$1", [campaign])).rows[0].n, 0);
    await client.query("INSERT INTO organization_audit(actor_id,action) VALUES ($1,'fixture')", [actor]);
    await fails("DELETE FROM organization_audit");
    await client.query("UPDATE organization_units SET status='archived' WHERE id=$1", [other]);
    await fails("INSERT INTO campaign_group_participation(campaign_id,group_id,created_by) VALUES ($1,$2,$3)", [campaign, other, actor]);
    console.log(JSON.stringify({ type: "organization-migration-check", mode, rejectedInvalidOperations: assertions, passed: true }));
  } finally {
    await client.query("ROLLBACK");
  }
}