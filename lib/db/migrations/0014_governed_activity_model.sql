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
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE governed_channels ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO governed_channels(id, display_name, type, source_metadata) VALUES
 ('psg','Paid Search: Google','paid','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('psl','Paid Social: LinkedIn','paid','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('disp','Display','paid','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('orglin','Organic Social: LinkedIn','organic','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('adv','Advocacy Social','organic','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('eml','Email: Pardot','email','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('emlc','Email: Certain','email','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('emlp','Email: Partner','email','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('evlv','Event: In-Person','event','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('evind','Event: Industry','event','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('evvrt','Event: Virtual On24','event','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('app','In-App','app','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb),
 ('mcp','MCP','app','{"source_environment":"development","verification_status":"provisional","publishing_eligible":false,"source_reference":"Campaign Governance Foundation, migrated via audit","requires_business_validation":true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, type=EXCLUDED.type,
  source_metadata=EXCLUDED.source_metadata, updated_at=now();

-- Exact channel IDs are provisional values and are deliberately not auto-approved.
INSERT INTO taxonomy_terms(version_id, category, label, shortcode, source_metadata)
SELECT v.id, 'channel', c.display_name, c.id,
       c.source_metadata || jsonb_build_object('canonicalActivityModel', true, 'channelType', c.type)
FROM governed_channels c
CROSS JOIN LATERAL (
  SELECT id FROM taxonomy_versions
  WHERE effective_at <= now() AND (deprecated_at IS NULL OR deprecated_at > now())
  ORDER BY effective_at DESC LIMIT 1
) v
WHERE NOT EXISTS (
  SELECT 1 FROM taxonomy_terms t WHERE t.version_id=v.id AND t.category='channel' AND t.shortcode=c.id
);