-- Enforce campaign membership at the database boundary.  The existing
-- single-column references prevent missing parents but cannot prevent a row
-- from pairing a child in one campaign with a parent in another.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communications_id_campaign_unique'
  ) THEN
    ALTER TABLE communications
      ADD CONSTRAINT communications_id_campaign_unique UNIQUE (id, campaign_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activities_id_campaign_unique'
  ) THEN
    ALTER TABLE activities
      ADD CONSTRAINT activities_id_campaign_unique UNIQUE (id, campaign_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audiences_id_campaign_unique'
  ) THEN
    ALTER TABLE audiences
      ADD CONSTRAINT audiences_id_campaign_unique UNIQUE (id, campaign_id);
  END IF;
END $$;

ALTER TABLE communication_details
  ADD COLUMN IF NOT EXISTS campaign_id uuid;

UPDATE communication_details d
SET campaign_id = c.campaign_id
FROM communications c
WHERE c.id = d.communication_id
  AND d.campaign_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM communication_details WHERE campaign_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot make communication_details.campaign_id required while details are not attached to a communication';
  END IF;
END $$;

ALTER TABLE communication_details
  ALTER COLUMN campaign_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communication_details_campaign_fk'
  ) THEN
    ALTER TABLE communication_details
      ADD CONSTRAINT communication_details_campaign_fk
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communication_details_communication_campaign_fk'
  ) THEN
    ALTER TABLE communication_details
      ADD CONSTRAINT communication_details_communication_campaign_fk
      FOREIGN KEY (communication_id, campaign_id)
      REFERENCES communications(id, campaign_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communication_details_audience_campaign_fk'
  ) THEN
    ALTER TABLE communication_details
      ADD CONSTRAINT communication_details_audience_campaign_fk
      FOREIGN KEY (audience_branch_id, campaign_id)
      REFERENCES audiences(id, campaign_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'webinar_sessions_activity_campaign_fk'
  ) THEN
    ALTER TABLE webinar_sessions
      ADD CONSTRAINT webinar_sessions_activity_campaign_fk
      FOREIGN KEY (activity_id, campaign_id)
      REFERENCES activities(id, campaign_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'webinar_people_audience_campaign_fk'
  ) THEN
    ALTER TABLE webinar_people
      ADD CONSTRAINT webinar_people_audience_campaign_fk
      FOREIGN KEY (audience_branch_id, campaign_id)
      REFERENCES audiences(id, campaign_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS communication_details_campaign_audience_idx
  ON communication_details (campaign_id, audience_branch_id);
CREATE INDEX IF NOT EXISTS webinar_sessions_campaign_activity_idx
  ON webinar_sessions (campaign_id, activity_id);
CREATE INDEX IF NOT EXISTS webinar_people_campaign_audience_idx
  ON webinar_people (campaign_id, audience_branch_id);

-- The planning core keeps history campaign-scoped as well.  Backfill the
-- additive column before enforcing the same composite ownership boundary.
ALTER TABLE scheduled_instance_history
  ADD COLUMN IF NOT EXISTS campaign_id uuid;

UPDATE scheduled_instance_history h
SET campaign_id = i.campaign_id
FROM scheduled_instances i
WHERE i.id = h.scheduled_instance_id
  AND h.campaign_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM scheduled_instance_history WHERE campaign_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot make scheduled_instance_history.campaign_id required while history rows are not attached to an instance';
  END IF;
END $$;

ALTER TABLE scheduled_instance_history
  ALTER COLUMN campaign_id SET NOT NULL;