-- Delivery child entities are intentionally additive.  This migration does not
-- drop or rewrite existing campaign data.
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'Other',
  ADD COLUMN IF NOT EXISTS timing text NOT NULL DEFAULT 'TBD',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT 'Campaign team';

-- The delivery contract requires every child to belong to an activity.  Fail
-- explicitly rather than silently assigning an activity if legacy rows violate
-- that invariant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM communications WHERE activity_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot make communications.activity_id required while legacy rows are unlinked';
  END IF;
  ALTER TABLE communications ALTER COLUMN activity_id SET NOT NULL;
END $$;

ALTER TABLE communications
  ALTER COLUMN type SET DEFAULT 'Other',
  ALTER COLUMN timing SET DEFAULT 'TBD',
  ALTER COLUMN sort_order SET DEFAULT 0,
  ALTER COLUMN status SET DEFAULT 'Estimated',
  ALTER COLUMN owner SET DEFAULT 'Campaign team';

CREATE TABLE IF NOT EXISTS activity_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'Other',
  timing text NOT NULL DEFAULT 'TBD',
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Estimated',
  owner text NOT NULL DEFAULT 'Campaign team',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communications_campaign_sort_order_idx
  ON communications (campaign_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS activity_tasks_campaign_sort_order_idx
  ON activity_tasks (campaign_id, sort_order, created_at);