-- Webinar and communication operating details are additive.  Existing
-- communications remain the parent records and are enriched through a
-- one-to-one extension row.

CREATE TABLE IF NOT EXISTS communication_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  communication_id uuid NOT NULL UNIQUE REFERENCES communications(id) ON DELETE CASCADE,
  audience_branch_id uuid NOT NULL REFERENCES audiences(id),
  communication_type text NOT NULL DEFAULT 'Other',
  channel text NOT NULL DEFAULT 'other',
  approval_status text NOT NULL DEFAULT 'Not started',
  qa_audience_confirmed boolean NOT NULL DEFAULT false,
  qa_content_approved boolean NOT NULL DEFAULT false,
  qa_links_verified boolean NOT NULL DEFAULT false,
  qa_timing_verified boolean NOT NULL DEFAULT false,
  qa_owner_confirmed boolean NOT NULL DEFAULT false,
  blocking_dependency_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT communication_details_dependencies_array_check
    CHECK (jsonb_typeof(blocking_dependency_task_ids) = 'array')
);

-- A campaign audience branch is the smallest valid fallback for legacy
-- delivery rows.  It is derived from the campaign's real audience, never a
-- placeholder contact.
INSERT INTO audiences (campaign_id, name, region)
SELECT c.id, c.audience, c.region
FROM campaigns c
WHERE NOT EXISTS (
  SELECT 1 FROM audiences a WHERE a.campaign_id = c.id
);

INSERT INTO communication_details (
  communication_id,
  audience_branch_id,
  communication_type,
  channel,
  approval_status,
  blocking_dependency_task_ids
)
SELECT
  c.id,
  a.id,
  c.type,
  lower(c.type),
  CASE
    WHEN c.status = 'Confirmed' THEN 'Approved'
    WHEN c.status = 'Decision needed' THEN 'Needs review'
    ELSE 'Not started'
  END,
  '[]'::jsonb
FROM communications c
JOIN LATERAL (
  SELECT a.id
  FROM audiences a
  WHERE a.campaign_id = c.campaign_id
  ORDER BY a.created_at, a.id
  LIMIT 1
) a ON true
WHERE NOT EXISTS (
  SELECT 1 FROM communication_details d WHERE d.communication_id = c.id
);

CREATE INDEX IF NOT EXISTS communication_details_audience_branch_idx
  ON communication_details (audience_branch_id);

CREATE TABLE IF NOT EXISTS webinar_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  name text NOT NULL,
  session_date date NOT NULL,
  start_time time NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  timezone text NOT NULL,
  platform text NOT NULL,
  speakers jsonb NOT NULL DEFAULT '[]'::jsonb,
  registration_rule jsonb NOT NULL DEFAULT '{"suppressRecruitmentAfterRegistration": true}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT webinar_sessions_speakers_array_check CHECK (jsonb_typeof(speakers) = 'array'),
  CONSTRAINT webinar_sessions_registration_rule_object_check CHECK (jsonb_typeof(registration_rule) = 'object'),
  CONSTRAINT webinar_sessions_id_campaign_unique UNIQUE (id, campaign_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS webinar_sessions_campaign_activity_name_idx
  ON webinar_sessions (campaign_id, activity_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS webinar_sessions_id_campaign_idx
  ON webinar_sessions (id, campaign_id);

CREATE TABLE IF NOT EXISTS webinar_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  audience_branch_id uuid NOT NULL REFERENCES audiences(id),
  name text NOT NULL,
  is_synthetic boolean NOT NULL DEFAULT true CHECK (is_synthetic = true),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT webinar_people_id_campaign_unique UNIQUE (id, campaign_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS webinar_people_campaign_name_idx
  ON webinar_people (campaign_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS webinar_people_id_campaign_idx
  ON webinar_people (id, campaign_id);

CREATE TABLE IF NOT EXISTS webinar_registration_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES webinar_sessions(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES webinar_people(id) ON DELETE CASCADE,
  result text NOT NULL CHECK (result IN ('registered', 'not_registered')),
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT webinar_registration_results_session_campaign_fk
    FOREIGN KEY (session_id, campaign_id) REFERENCES webinar_sessions(id, campaign_id) ON DELETE CASCADE,
  CONSTRAINT webinar_registration_results_person_campaign_fk
    FOREIGN KEY (person_id, campaign_id) REFERENCES webinar_people(id, campaign_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS webinar_registration_results_session_person_idx
  ON webinar_registration_results (session_id, person_id);
CREATE INDEX IF NOT EXISTS webinar_registration_results_campaign_idx
  ON webinar_registration_results (campaign_id);

CREATE TABLE IF NOT EXISTS webinar_attendance_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES webinar_sessions(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES webinar_people(id) ON DELETE CASCADE,
  result text NOT NULL CHECK (result IN ('attended', 'no_show')),
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT webinar_attendance_results_session_campaign_fk
    FOREIGN KEY (session_id, campaign_id) REFERENCES webinar_sessions(id, campaign_id) ON DELETE CASCADE,
  CONSTRAINT webinar_attendance_results_person_campaign_fk
    FOREIGN KEY (person_id, campaign_id) REFERENCES webinar_people(id, campaign_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS webinar_attendance_results_session_person_idx
  ON webinar_attendance_results (session_id, person_id);
CREATE INDEX IF NOT EXISTS webinar_attendance_results_campaign_idx
  ON webinar_attendance_results (campaign_id);