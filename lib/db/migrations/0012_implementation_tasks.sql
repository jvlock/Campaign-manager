-- Additive, rerunnable. Only obvious terminal legacy values migrate, exactly once.
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_tasks' AND column_name='stage') THEN
 ALTER TABLE activity_tasks ADD COLUMN stage text NOT NULL DEFAULT 'Not Started';
 UPDATE activity_tasks SET stage='Complete' WHERE lower(trim(status)) IN ('done','complete','completed');
END IF;
END $$;
ALTER TABLE activity_tasks
 ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS blocked_reason text,
 ADD COLUMN IF NOT EXISTS supporting_owner text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS requesting_team text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS requester text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'gtm_launch',
 ADD COLUMN IF NOT EXISTS offset_days integer,
 ADD COLUMN IF NOT EXISTS business_day_strategy text NOT NULL DEFAULT 'calendar',
 ADD COLUMN IF NOT EXISTS effort_points double precision NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS activity_task_settings (
 activity_id uuid PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 gtm_launch_at timestamptz, event_at timestamptz, timezone text NOT NULL DEFAULT 'UTC',
 tier text CHECK (tier IN ('Gold','Silver','Bronze'))
);
CREATE TABLE IF NOT EXISTS task_defaults (
 type text PRIMARY KEY, offset_days integer NOT NULL,
 label text NOT NULL DEFAULT 'Configurable reference default'
);
INSERT INTO task_defaults(type,offset_days) VALUES
 ('Other',0),('Asset',-7),('Landing page',-5),('Approval',-2),('Tracking',-1)
 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS owner_capacities (
 owner text PRIMARY KEY, ceiling double precision NOT NULL DEFAULT 10 CHECK (ceiling>=0)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='activity_tasks_implementation_valid') THEN
  ALTER TABLE activity_tasks ADD CONSTRAINT activity_tasks_implementation_valid CHECK (
   stage IN ('Not Started','In Progress','Ready for Review','Complete')
   AND ((blocked AND blocked_reason IS NOT NULL AND blocked_reason IN ('On Hold','Content','Technical','Legal')) OR (NOT blocked AND blocked_reason IS NULL))
   AND trigger IN ('gtm_launch','event')
   AND business_day_strategy IN ('calendar','skip_weekends','next_business_day','previous_business_day')
   AND effort_points >= 0 AND effort_points < 'Infinity'::float8
  );
 END IF;
END $$;