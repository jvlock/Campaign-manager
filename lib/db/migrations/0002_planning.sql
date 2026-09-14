-- Planning is additive.  Existing activity connection IDs are retained so
-- the audience branch tree can be enriched without rebuilding it.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS normalized_name text
    GENERATED ALWAYS AS (lower(regexp_replace(name, '[^[:alnum:]]', '', 'g'))) STORED,
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

ALTER TABLE activity_connections
  ADD COLUMN IF NOT EXISTS parent_branch_id uuid,
  ADD COLUMN IF NOT EXISTS entry_condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS suppression_rule jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS campaigns_normalized_name_idx
  ON campaigns (normalized_name);
CREATE INDEX IF NOT EXISTS activity_connections_campaign_parent_idx
  ON activity_connections (campaign_id, parent_branch_id);

CREATE TABLE IF NOT EXISTS schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  activity_id uuid,
  communication_id uuid,
  anchor_activity_id uuid,
  offset_days integer NOT NULL DEFAULT 0,
  offset_minutes integer NOT NULL DEFAULT 0,
  direction text NOT NULL DEFAULT 'after',
  business_day_strategy text NOT NULL DEFAULT 'calendar',
  audience_local_timezone boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'UTC',
  target_send_time text,
  enabled boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  activity_id uuid,
  communication_id uuid,
  original_calculated_at timestamp with time zone NOT NULL,
  calculated_at timestamp with time zone NOT NULL,
  -- calculated_at is rule-derived; adjusted_at is the effective manual send
  -- instant. updated_at records when an adjustment was recorded.
  adjusted_at timestamp with time zone,
  adjustment_reason text,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_instance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_instance_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  anchor_at timestamp with time zone NOT NULL,
  previous_calculated_at timestamp with time zone,
  calculated_at timestamp with time zone NOT NULL,
  reason text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_rules_campaign_idx
  ON schedule_rules (campaign_id, enabled);
CREATE INDEX IF NOT EXISTS schedule_rules_anchor_activity_idx
  ON schedule_rules (anchor_activity_id, enabled);
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_instances_rule_idx
  ON scheduled_instances (rule_id);
CREATE INDEX IF NOT EXISTS scheduled_instance_history_instance_idx
  ON scheduled_instance_history (scheduled_instance_id, created_at);

-- The original calculation is an audit fact, not a mutable projection.
CREATE OR REPLACE FUNCTION prevent_scheduled_instance_original_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.original_calculated_at IS DISTINCT FROM OLD.original_calculated_at THEN
    RAISE EXCEPTION 'scheduled_instances.original_calculated_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scheduled_instances_original_calculated_at_immutable ON scheduled_instances;
CREATE TRIGGER scheduled_instances_original_calculated_at_immutable
BEFORE UPDATE ON scheduled_instances
FOR EACH ROW EXECUTE FUNCTION prevent_scheduled_instance_original_change();

-- Schedule rules are intentionally not inferred from arbitrary webinar
-- communications here.  Free-text delivery rows do not carry enough
-- information to infer an anchor, relative offset, or session timezone.
-- The exact seeded demo webinar is handled by the explicit, idempotent
-- seed-webinar-planning.mjs script after its session exists.