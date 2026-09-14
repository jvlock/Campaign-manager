-- Per-person registration confirmations are immutable trigger events.  They
-- are intentionally separate from scheduled_instances, whose rows represent
-- campaign-level template timing rather than a person's registration instant.

CREATE TABLE IF NOT EXISTS webinar_standard_trigger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES webinar_sessions(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  standard_communication_id uuid NOT NULL
    REFERENCES webinar_standard_communications(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS webinar_standard_trigger_events_session_person_recorded_idx;
CREATE UNIQUE INDEX IF NOT EXISTS webinar_standard_communications_id_campaign_idx
  ON webinar_standard_communications (id, campaign_id);

-- Preserve already-successful registrations when the immutable ledger is
-- introduced.  New transitions are appended by the API route.
INSERT INTO webinar_standard_trigger_events (
  campaign_id, session_id, person_id, standard_communication_id, recorded_at
)
SELECT registration.campaign_id,
       registration.session_id,
       registration.person_id,
       standard.id,
       registration.recorded_at
FROM webinar_registration_results AS registration
JOIN webinar_standard_communications AS standard
  ON standard.campaign_id = registration.campaign_id
 AND standard.session_id = registration.session_id
 AND standard.key = 'registration_confirmation'
WHERE registration.result = 'registered'
  AND NOT EXISTS (
    SELECT 1
    FROM webinar_standard_trigger_events AS existing
    WHERE existing.campaign_id = registration.campaign_id
      AND existing.session_id = registration.session_id
      AND existing.person_id = registration.person_id
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'communication_details_audience_branch_id_fkey'
  ) THEN
    ALTER TABLE communication_details
      DROP CONSTRAINT communication_details_audience_branch_id_fkey;
  END IF;
  ALTER TABLE communication_details
    ADD CONSTRAINT communication_details_audience_branch_id_fkey
    FOREIGN KEY (audience_branch_id) REFERENCES audiences(id) ON DELETE CASCADE;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'communication_details_audience_campaign_fk'
  ) THEN
    ALTER TABLE communication_details
      DROP CONSTRAINT communication_details_audience_campaign_fk;
  END IF;
  ALTER TABLE communication_details
    ADD CONSTRAINT communication_details_audience_campaign_fk
    FOREIGN KEY (audience_branch_id, campaign_id)
    REFERENCES audiences(id, campaign_id) ON DELETE CASCADE;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webinar_standard_configs_session_campaign_fk'
  ) THEN
    ALTER TABLE webinar_standard_configs
      ADD CONSTRAINT webinar_standard_configs_session_campaign_fk
      FOREIGN KEY (session_id, campaign_id)
      REFERENCES webinar_sessions(id, campaign_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webinar_standard_communications_session_campaign_fk'
  ) THEN
    ALTER TABLE webinar_standard_communications
      ADD CONSTRAINT webinar_standard_communications_session_campaign_fk
      FOREIGN KEY (session_id, campaign_id)
      REFERENCES webinar_sessions(id, campaign_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webinar_standard_communications_activity_campaign_fk'
  ) THEN
    ALTER TABLE webinar_standard_communications
      ADD CONSTRAINT webinar_standard_communications_activity_campaign_fk
      FOREIGN KEY (activity_id, campaign_id)
      REFERENCES activities(id, campaign_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webinar_standard_communications_communication_campaign_fk'
  ) THEN
    ALTER TABLE webinar_standard_communications
      ADD CONSTRAINT webinar_standard_communications_communication_campaign_fk
      FOREIGN KEY (communication_id, campaign_id)
      REFERENCES communications(id, campaign_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webinar_standard_communications_schedule_rule_campaign_fk'
  ) THEN
    ALTER TABLE webinar_standard_communications
      ADD CONSTRAINT webinar_standard_communications_schedule_rule_campaign_fk
      FOREIGN KEY (schedule_rule_id, campaign_id)
      REFERENCES schedule_rules(id, campaign_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webinar_standard_trigger_events_session_campaign_fk'
  ) THEN
    ALTER TABLE webinar_standard_trigger_events
      ADD CONSTRAINT webinar_standard_trigger_events_session_campaign_fk
      FOREIGN KEY (session_id, campaign_id)
      REFERENCES webinar_sessions(id, campaign_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webinar_standard_trigger_events_person_campaign_fk'
  ) THEN
    ALTER TABLE webinar_standard_trigger_events
      ADD CONSTRAINT webinar_standard_trigger_events_person_campaign_fk
      FOREIGN KEY (person_id, campaign_id)
      REFERENCES webinar_people(id, campaign_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webinar_standard_trigger_events_communication_campaign_fk'
  ) THEN
    ALTER TABLE webinar_standard_trigger_events
      ADD CONSTRAINT webinar_standard_trigger_events_communication_campaign_fk
      FOREIGN KEY (standard_communication_id, campaign_id)
      REFERENCES webinar_standard_communications(id, campaign_id);
  END IF;
END $$;