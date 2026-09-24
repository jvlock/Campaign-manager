-- Inert in operational databases: no marker is installed by this migration.
-- Marker provisioning is exclusive to the private local bootstrap.
CREATE TABLE development_planning_environment (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  marker text NOT NULL CHECK (marker='synthetic-open-development-v1'),
  default_group_id uuid NOT NULL REFERENCES organization_units(id),
  creator_id uuid NOT NULL REFERENCES users(id),
  accountable_owner_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE development_record_registry (
  entity_type text NOT NULL CHECK (entity_type IN ('campaign','activity')),
  entity_id uuid NOT NULL,
  attribution text NOT NULL DEFAULT 'unverified-development' CHECK (attribution='unverified-development'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entity_type,entity_id)
);
-- Never consulted by canonical approvals, exceptions, evaluation or readiness.
CREATE TABLE development_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL, entity_id uuid NOT NULL,
  label text NOT NULL DEFAULT 'UNVERIFIED DEVELOPMENT SIMULATION',
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(entity_type,entity_id) REFERENCES development_record_registry(entity_type,entity_id)
);
CREATE FUNCTION development_assign_new_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE env development_planning_environment%ROWTYPE; owner_group uuid; owner_user uuid;
BEGIN
  SELECT * INTO env FROM development_planning_environment WHERE id=true;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='campaigns' THEN
    owner_group := env.default_group_id;
    owner_user := env.accountable_owner_id;
    INSERT INTO campaign_ownership(campaign_id,group_id,accountable_owner_id,created_by)
      VALUES(NEW.id,owner_group,owner_user,env.creator_id);
    INSERT INTO campaign_group_participation(campaign_id,group_id,created_by)
      VALUES(NEW.id,owner_group,env.creator_id);
    INSERT INTO development_record_registry(entity_type,entity_id) VALUES('campaign',NEW.id);
  ELSE
    IF NOT EXISTS (SELECT 1 FROM development_record_registry WHERE entity_type='campaign' AND entity_id=NEW.campaign_id) THEN
      RAISE EXCEPTION 'Development activity requires a development campaign';
    END IF;
    SELECT group_id,accountable_owner_id INTO owner_group,owner_user
      FROM campaign_ownership WHERE campaign_id=NEW.campaign_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Development activity requires campaign ownership'; END IF;
    INSERT INTO activity_ownership(activity_id,campaign_id,group_id,accountable_owner_id,created_by)
      VALUES(NEW.id,NEW.campaign_id,owner_group,owner_user,env.creator_id);
    INSERT INTO development_record_registry(entity_type,entity_id) VALUES('activity',NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER development_campaign_ownership AFTER INSERT ON campaigns
FOR EACH ROW EXECUTE FUNCTION development_assign_new_ownership();
CREATE TRIGGER development_activity_ownership AFTER INSERT ON activities
FOR EACH ROW EXECUTE FUNCTION development_assign_new_ownership();
CREATE FUNCTION development_preserve_creator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM development_planning_environment) AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Unverified development creator attribution is stable; change accountable owner instead';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER development_campaign_creator BEFORE UPDATE ON campaign_ownership
FOR EACH ROW EXECUTE FUNCTION development_preserve_creator();
CREATE TRIGGER development_activity_creator BEFORE UPDATE ON activity_ownership
FOR EACH ROW EXECUTE FUNCTION development_preserve_creator();
CREATE TRIGGER development_registry_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON development_record_registry
FOR EACH STATEMENT EXECUTE FUNCTION organization_reject_mutation();
CREATE TRIGGER development_marker_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON development_planning_environment
FOR EACH STATEMENT EXECUTE FUNCTION organization_reject_mutation();