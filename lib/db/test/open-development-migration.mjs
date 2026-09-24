import assert from "node:assert/strict";

export async function checkDevelopmentConstraints(client, mode) {
  await client.query("BEGIN");
  let rejected = 0;
  const insert = async (sql, params = []) => (await client.query(sql + " RETURNING id", params)).rows[0].id;
  const fails = async (sql, params = []) => {
    await client.query("SAVEPOINT invalid_development");
    await assert.rejects(client.query(sql, params));
    await client.query("ROLLBACK TO SAVEPOINT invalid_development");
    rejected++;
  };
  try {
    assert.equal((await client.query("SELECT count(*)::int n FROM development_record_registry")).rows[0].n, 0, "No historical backfill");
    const historical = await insert("INSERT INTO campaigns(name,scope,audience,outcome) VALUES ('Before marker','Global','Synthetic','Synthetic')");
    assert.equal((await client.query("SELECT count(*)::int n FROM campaign_ownership WHERE campaign_id=$1", [historical])).rows[0].n, 0, "Trigger inert without marker");
    const creator = await insert("INSERT INTO users(name,email) VALUES ('Unverified creator','dev-creator@synthetic.invalid')");
    const accountable = await insert("INSERT INTO users(name,email) VALUES ('Unverified accountable','dev-owner@synthetic.invalid')");
    const team = await insert("INSERT INTO organization_units(name,kind) VALUES ('Synthetic team','team')");
    const group = await insert("INSERT INTO organization_units(name,kind,parent_id,accountable_owner_id) VALUES ('Synthetic group','group',$1,$2)", [team, accountable]);
    await client.query(`INSERT INTO development_planning_environment(marker,default_group_id,creator_id,accountable_owner_id)
      VALUES('synthetic-open-development-v1',$1,$2,$3)`, [group, creator, accountable]);
    const contamination = await client.query(`SELECT
      EXISTS (SELECT 1 FROM campaigns c WHERE NOT EXISTS (
        SELECT 1 FROM development_record_registry r WHERE r.entity_type='campaign' AND r.entity_id=c.id))
      OR EXISTS (SELECT 1 FROM activities a WHERE NOT EXISTS (
        SELECT 1 FROM development_record_registry r WHERE r.entity_type='activity' AND r.entity_id=a.id))
      AS contaminated`);
    assert.equal(contamination.rows[0].contaminated, true, "Installing a marker cannot make historical/unregistered records eligible for open access");
    const campaign = await insert("INSERT INTO campaigns(name,scope,audience,outcome) VALUES ('Development','Global','Synthetic','Synthetic')");
    const activitySql = "INSERT INTO activities(campaign_id,name,type,audience,region,timing,status,owner,x,y) VALUES ($1,'Development','Webinar','Synthetic','Global','TBD','Draft','Unverified',0,0)";
    const activity = await insert(activitySql, [campaign]);
    const owner = (await client.query("SELECT group_id,created_by,accountable_owner_id FROM campaign_ownership WHERE campaign_id=$1", [campaign])).rows[0];
    assert.deepEqual(owner, { group_id: group, created_by: creator, accountable_owner_id: accountable });
    assert.deepEqual((await client.query("SELECT group_id,created_by,accountable_owner_id FROM activity_ownership WHERE activity_id=$1", [activity])).rows[0], owner);
    assert.equal((await client.query("SELECT count(*)::int n FROM development_record_registry")).rows[0].n, 2);
    await fails(activitySql, [historical]);
    await fails("UPDATE campaign_ownership SET created_by=$1 WHERE campaign_id=$2", [accountable, campaign]);
    await fails("UPDATE activity_ownership SET created_by=$1 WHERE activity_id=$2", [accountable, activity]);
    await fails("UPDATE campaign_ownership SET accountable_owner_id=NULL WHERE campaign_id=$1", [campaign]);
    await fails("UPDATE campaign_ownership SET accountable_owner_id=gen_random_uuid() WHERE campaign_id=$1", [campaign]);
    await fails("DELETE FROM development_record_registry");
    await fails("DELETE FROM development_planning_environment");
    await client.query("UPDATE campaign_ownership SET accountable_owner_id=$1 WHERE campaign_id=$2", [creator, campaign]);
    assert.equal((await client.query("SELECT created_by FROM campaign_ownership WHERE campaign_id=$1", [campaign])).rows[0].created_by, creator);
    await client.query("INSERT INTO development_simulations(entity_type,entity_id,payload) VALUES ('campaign',$1,'{\"approval\":\"simulation-only\"}')", [campaign]);
    assert.equal((await client.query("SELECT count(*)::int n FROM approvals WHERE campaign_id=$1", [campaign])).rows[0].n, 0);
    assert.equal((await client.query("SELECT count(*)::int n FROM organization_memberships WHERE user_id IN ($1,$2)", [creator, accountable])).rows[0].n, 0);
    await client.query("UPDATE organization_units SET status='archived' WHERE id=$1", [group]);
    await fails("INSERT INTO campaigns(name,scope,audience,outcome) VALUES ('Must roll back','Global','Synthetic','Synthetic')");
    assert.equal((await client.query("SELECT count(*)::int n FROM campaigns WHERE name='Must roll back'")).rows[0].n, 0);
    console.log(JSON.stringify({ type: "open-development-migration-check", mode, rejectedInvalidOperations: rejected, passed: true }));
  } finally {
    await client.query("ROLLBACK");
  }
}