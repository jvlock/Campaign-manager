-- Webinar standard nine is additive and idempotent.  Legacy webinar
-- communications, schedule rules, instances, and content are never deleted.

ALTER TABLE webinar_sessions
  ADD COLUMN IF NOT EXISTS recruitment_launch_at timestamptz;

ALTER TABLE webinar_registration_results
  ADD COLUMN IF NOT EXISTS first_registered_at timestamptz;

UPDATE webinar_registration_results
SET first_registered_at = recorded_at
WHERE result = 'registered'
  AND first_registered_at IS NULL;

CREATE TABLE IF NOT EXISTS webinar_standard_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id uuid NOT NULL UNIQUE REFERENCES webinar_sessions(id) ON DELETE CASCADE,
  pilot_limits jsonb NOT NULL DEFAULT '{"subject":50,"preheader":90,"hero":60,"body":1200,"ctaLabel":25,"ctaUrl":2000,"internalAssetName":120}'::jsonb,
  variants jsonb NOT NULL DEFAULT '[{"slot":1,"name":"Default","inUse":true,"audienceDefinition":"All eligible webinar audience","messageAngle":"","valueProposition":""}]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webinar_standard_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES webinar_sessions(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  audience_rule text NOT NULL,
  timing_kind text NOT NULL,
  offset_value integer NOT NULL DEFAULT 0,
  offset_unit text NOT NULL,
  direction text NOT NULL,
  weekend_adjustment text NOT NULL,
  locked boolean NOT NULL DEFAULT true,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  communication_id uuid REFERENCES communications(id) ON DELETE SET NULL,
  legacy_communication_id uuid,
  schedule_rule_id uuid REFERENCES schedule_rules(id) ON DELETE SET NULL,
  original_scheduled_at timestamptz,
  current_scheduled_at timestamptz,
  effective_scheduled_at timestamptz,
  schedule_status text NOT NULL DEFAULT 'scheduled',
  skip_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webinar_standard_communications
  ADD COLUMN IF NOT EXISTS communication_id uuid REFERENCES communications(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS webinar_standard_communications_session_key_idx
  ON webinar_standard_communications (session_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS webinar_standard_communications_session_sort_idx
  ON webinar_standard_communications (session_id, sort_order);
CREATE INDEX IF NOT EXISTS webinar_standard_communications_communication_idx
  ON webinar_standard_communications (communication_id);
CREATE INDEX IF NOT EXISTS webinar_standard_communications_campaign_idx
  ON webinar_standard_communications (campaign_id, session_id, sort_order);

-- Reconcile already-existing webinar sessions without touching legacy records.
-- The seeded six communications are linked by name/timing where there is an
-- unambiguous closest standard slot; their rows and histories remain intact.
DO $$
DECLARE
  s record;
  key_name text;
  key_sort integer;
  key_audience text;
  key_kind text;
  key_offset integer;
  key_unit text;
  key_direction text;
  key_weekend text;
  legacy_id uuid;
  used_legacy_ids uuid[] := ARRAY[]::uuid[];
  asset_name text;
BEGIN
  FOR s IN
    SELECT ws.id, ws.campaign_id, ws.activity_id
    FROM webinar_sessions ws
    JOIN activities a ON a.id = ws.activity_id AND a.campaign_id = ws.campaign_id
    -- This migration predates template_version.  On a fresh database the
    -- expression defaults to legacy for every row; on a later idempotent
    -- rerun it prevents provisioning legacy rows onto a new five-message
    -- session created after migration 0011.
    WHERE COALESCE(to_jsonb(ws)->>'template_version', 'legacy_9') = 'legacy_9'
  LOOP
    used_legacy_ids := ARRAY[]::uuid[];
    INSERT INTO webinar_standard_configs (campaign_id, session_id)
    VALUES (s.campaign_id, s.id)
    ON CONFLICT (session_id) DO NOTHING;

    FOR key_name, key_sort, key_audience, key_kind, key_offset, key_unit, key_direction, key_weekend IN
      VALUES
        ('registration_confirmation', 0, 'Successful registration record instant only', 'trigger', 0, 'instant', 'trigger', 'none'),
        ('recruitment_1', 1, 'Not registered and no successful registration record', 'calendar', 21, 'days', 'before', 'previous_friday'),
        ('recruitment_2', 2, 'Not registered and no successful registration record', 'calendar', 14, 'days', 'before', 'previous_friday'),
        ('recruitment_3', 3, 'Not registered and no successful registration record', 'calendar', 7, 'days', 'before', 'previous_friday'),
        ('final_recruitment', 4, 'Not registered and no successful registration record', 'calendar', 1, 'days', 'before', 'previous_friday'),
        ('registered_reminder', 5, 'Registered and non-canceled', 'elapsed', 24, 'hours', 'before', 'none'),
        ('final_reminder', 6, 'Registered and non-canceled', 'elapsed', 1, 'hours', 'before', 'none'),
        ('attendee_followup', 7, 'Confirmed attendance; no-show excluded', 'calendar', 1, 'days', 'after', 'next_monday'),
        ('no_show_followup', 8, 'Registered nonattendance; attended excluded', 'calendar', 1, 'days', 'after', 'next_monday')
    LOOP
      SELECT c.id INTO legacy_id
      FROM communications c
      WHERE c.campaign_id = s.campaign_id
        AND c.activity_id = s.activity_id
        AND (
          (key_name = 'recruitment_2' AND lower(c.name) = 'invitation')
          OR (key_name = 'recruitment_3' AND lower(c.name) = 'reminder' AND c.timing = '-7 days')
          OR (key_name = 'final_recruitment' AND lower(c.name) = 'reminder' AND c.timing = '-2 days')
          OR (key_name = 'registered_reminder' AND lower(c.name) = 'day-of')
          OR (key_name = 'attendee_followup' AND lower(c.name) = 'attendee')
          OR (key_name = 'no_show_followup' AND lower(c.name) = 'no-show recording')
        )
        AND NOT (c.id = ANY(used_legacy_ids))
      ORDER BY c.sort_order, c.created_at, c.id
      LIMIT 1;

      asset_name := 'webinar-' || replace(s.campaign_id::text, '-', '') || '-' ||
        replace(s.id::text, '-', '') || '-' || key_name || '-v1';
      INSERT INTO webinar_standard_communications (
        campaign_id, session_id, activity_id, key, name, sort_order,
        audience_rule, timing_kind, offset_value, offset_unit, direction,
        weekend_adjustment, variants, legacy_communication_id
      )
      VALUES (
        s.campaign_id, s.id, s.activity_id, key_name,
        initcap(replace(key_name, '_', ' ')), key_sort, key_audience,
        key_kind, key_offset, key_unit, key_direction, key_weekend,
        jsonb_build_array(jsonb_build_object(
          'slot', 1,
          'content', jsonb_build_object(
            'subject', '', 'preheader', '', 'hero', '', 'body', '',
            'ctaLabel', '', 'ctaUrl', '', 'internalAssetName', asset_name
          )
        )),
        legacy_id
      )
      ON CONFLICT (session_id, key) DO NOTHING;
      IF legacy_id IS NOT NULL THEN
        used_legacy_ids := array_append(used_legacy_ids, legacy_id);
      END IF;
      legacy_id := NULL;
    END LOOP;
  END LOOP;
END $$;