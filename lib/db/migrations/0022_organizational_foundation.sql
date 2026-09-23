-- Additive side associations only. No historical payload/ownership backfill.
-- New record creation must write ownership atomically in the authorization service.
CREATE TABLE organization_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('team','group')),
  parent_id uuid REFERENCES organization_units(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  accountable_owner_id uuid REFERENCES users(id),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='team' AND parent_id IS NULL) OR (kind='group' AND parent_id IS NOT NULL)),
  CHECK (kind <> 'group' OR status <> 'active' OR accountable_owner_id IS NOT NULL),
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE FUNCTION organization_check_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.id <> OLD.id OR NEW.kind <> OLD.kind) THEN
    RAISE EXCEPTION 'Organization identity and kind are immutable';
  END IF;
  IF NEW.kind='group' THEN
    PERFORM 1 FROM organization_units WHERE id=NEW.parent_id AND kind='team' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A group must have a parent team'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_hierarchy BEFORE INSERT OR UPDATE ON organization_units
FOR EACH ROW EXECUTE FUNCTION organization_check_hierarchy();

CREATE TABLE organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES organization_units(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  verified_by uuid NOT NULL REFERENCES users(id), verified_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX organization_membership_active ON organization_memberships(user_id,unit_id) WHERE status='active';
CREATE TABLE organization_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid REFERENCES organization_memberships(id),
  recipient_group_id uuid REFERENCES organization_units(id),
  unit_id uuid REFERENCES organization_units(id),
  campaign_id uuid REFERENCES campaigns(id), activity_id uuid REFERENCES activities(id),
  role text CHECK (role IN ('planner','exception_requester','independent_reviewer','operations_executor','administrator','read_only_viewer')),
  action text CHECK (action IN ('calendar_view','record_view','record_edit','evidence_submit','financial_view')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  granted_by uuid NOT NULL REFERENCES users(id), revoked_at timestamptz, expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(membership_id,recipient_group_id)=1),
  CHECK (num_nonnulls(unit_id,campaign_id,activity_id)=1),
  CHECK (num_nonnulls(role,action)=1),
  CHECK (action IS DISTINCT FROM 'calendar_view' OR unit_id IS NOT NULL),
  CHECK (recipient_group_id IS NULL OR (role IS NULL AND (campaign_id IS NOT NULL OR activity_id IS NOT NULL))),
  CHECK ((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX organization_grant_active ON organization_grants
  (COALESCE(membership_id,recipient_group_id),COALESCE(unit_id,campaign_id,activity_id),
   (CASE WHEN membership_id IS NOT NULL THEN 'member' ELSE 'group' END),
   (CASE WHEN unit_id IS NOT NULL THEN 'unit' WHEN campaign_id IS NOT NULL THEN 'campaign' ELSE 'activity' END),
   COALESCE(role,action)) WHERE status='active';
CREATE INDEX organization_grants_membership ON organization_grants(membership_id) WHERE status='active';
CREATE TABLE campaign_ownership (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id),
  group_id uuid NOT NULL REFERENCES organization_units(id),
  accountable_owner_id uuid NOT NULL REFERENCES users(id), created_by uuid REFERENCES users(id),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  reassessment_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campaign_group_participation (
  campaign_id uuid NOT NULL REFERENCES campaigns(id), group_id uuid NOT NULL REFERENCES organization_units(id),
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(campaign_id,group_id)
);
CREATE TABLE activity_ownership (
  activity_id uuid PRIMARY KEY REFERENCES activities(id), campaign_id uuid NOT NULL REFERENCES campaigns(id),
  group_id uuid NOT NULL REFERENCES organization_units(id),
  accountable_owner_id uuid NOT NULL REFERENCES users(id), created_by uuid REFERENCES users(id),
  calendar_visibility text NOT NULL DEFAULT 'private' CHECK (calendar_visibility IN ('private','summary')),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  reassessment_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(activity_id,campaign_id) REFERENCES activities(id,campaign_id),
  FOREIGN KEY(campaign_id,group_id) REFERENCES campaign_group_participation(campaign_id,group_id)
);
CREATE INDEX campaign_ownership_group ON campaign_ownership(group_id);
CREATE INDEX activity_ownership_group ON activity_ownership(group_id);
CREATE FUNCTION organization_check_group() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM organization_units WHERE id=NEW.group_id AND kind='group' AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'New ownership/participation requires an active group'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_owner_group BEFORE INSERT OR UPDATE OF group_id ON campaign_ownership
FOR EACH ROW EXECUTE FUNCTION organization_check_group();
CREATE TRIGGER activity_owner_group BEFORE INSERT OR UPDATE OF group_id ON activity_ownership
FOR EACH ROW EXECUTE FUNCTION organization_check_group();
CREATE TRIGGER participation_group BEFORE INSERT OR UPDATE OF group_id ON campaign_group_participation
FOR EACH ROW EXECUTE FUNCTION organization_check_group();
CREATE TABLE organization_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL, unit_id uuid REFERENCES organization_units(id),
  campaign_id uuid REFERENCES campaigns(id), activity_id uuid REFERENCES activities(id),
  details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organization_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid REFERENCES campaigns(id),
  activity_id uuid REFERENCES activities(id),
  source_group_id uuid NOT NULL REFERENCES organization_units(id),
  destination_group_id uuid NOT NULL REFERENCES organization_units(id),
  requested_by uuid NOT NULL REFERENCES users(id), accepted_by uuid REFERENCES users(id), accepted_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','completed','cancelled')),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(campaign_id,activity_id)=1),
  CHECK (source_group_id <> destination_group_id),
  CHECK ((accepted_by IS NULL) = (accepted_at IS NULL)),
  CHECK (status NOT IN ('accepted','completed') OR accepted_by IS NOT NULL)
);
CREATE TABLE legacy_campaigns (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id), recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE legacy_activities (
  activity_id uuid PRIMARY KEY REFERENCES activities(id), recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Snapshot the actual cutoff population, never a timestamp or absence-of-owner test.
INSERT INTO legacy_campaigns(campaign_id) SELECT id FROM campaigns;
INSERT INTO legacy_activities(activity_id) SELECT id FROM activities;
CREATE FUNCTION organization_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END $$;
CREATE TRIGGER legacy_campaigns_immutable BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON legacy_campaigns
FOR EACH STATEMENT EXECUTE FUNCTION organization_reject_mutation();
CREATE TRIGGER legacy_activities_immutable BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON legacy_activities
FOR EACH STATEMENT EXECUTE FUNCTION organization_reject_mutation();
CREATE TRIGGER organization_audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON organization_audit
FOR EACH STATEMENT EXECUTE FUNCTION organization_reject_mutation();
CREATE FUNCTION organization_check_creator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    IF TG_TABLE_NAME='campaign_ownership' THEN
      IF NOT EXISTS (SELECT 1 FROM legacy_campaigns WHERE campaign_id=NEW.campaign_id) THEN
        RAISE EXCEPTION 'New campaign ownership requires verified creator attribution';
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM legacy_activities WHERE activity_id=NEW.activity_id) THEN
        RAISE EXCEPTION 'New activity ownership requires verified creator attribution';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_owner_creator BEFORE INSERT OR UPDATE ON campaign_ownership
FOR EACH ROW EXECUTE FUNCTION organization_check_creator();
CREATE TRIGGER activity_owner_creator BEFORE INSERT OR UPDATE ON activity_ownership
FOR EACH ROW EXECUTE FUNCTION organization_check_creator();
CREATE FUNCTION organization_check_grant_group() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recipient_group_id IS NOT NULL THEN
    PERFORM 1 FROM organization_units WHERE id=NEW.recipient_group_id AND kind='group' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Collaboration recipient must be a group'; END IF;
  END IF;
  IF NEW.action='calendar_view' THEN
    PERFORM 1 FROM organization_units WHERE id=NEW.unit_id AND kind='group' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Calendar access must name an explicit child group'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_grant_group BEFORE INSERT OR UPDATE ON organization_grants
FOR EACH ROW EXECUTE FUNCTION organization_check_grant_group();