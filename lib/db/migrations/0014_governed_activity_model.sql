-- Additive migration: preserve every legacy activity while adding governed model state.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS activity_type_id text;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS activity_answers jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS activity_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS generated_name text;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS naming_input text;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS effective_inheritance jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS governed_channels (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('paid','organic','email','event','app')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO governed_channels(id, display_name, type) VALUES
 ('psg','Paid Search: Google','paid'),('psl','Paid Social: LinkedIn','paid'),
 ('disp','Display','paid'),('orglin','Organic Social: LinkedIn','organic'),
 ('adv','Advocacy Social','organic'),('eml','Email: Pardot','email'),
 ('emlc','Email: Certain','email'),('emlp','Email: Partner','email'),
 ('evlv','Event: In-Person','event'),('evind','Event: Industry','event'),
 ('evvrt','Event: Virtual On24','event'),('app','In-App','app'),('mcp','MCP','app')
ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, type=EXCLUDED.type, updated_at=now();

-- Exact governed IDs are authorized values, but are deliberately not auto-approved.
INSERT INTO taxonomy_terms(version_id, category, label, shortcode, source_metadata)
SELECT v.id, 'channel', c.display_name, c.id,
       jsonb_build_object('canonicalActivityModel', true, 'channelType', c.type)
FROM governed_channels c
CROSS JOIN LATERAL (
  SELECT id FROM taxonomy_versions
  WHERE effective_at <= now() AND (deprecated_at IS NULL OR deprecated_at > now())
  ORDER BY effective_at DESC LIMIT 1
) v
WHERE NOT EXISTS (
  SELECT 1 FROM taxonomy_terms t WHERE t.version_id=v.id AND t.category='channel' AND t.shortcode=c.id
);