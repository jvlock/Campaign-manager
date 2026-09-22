-- Test-only snapshot of the tables which existed before migration 0001.
-- The column set is intentionally limited to columns consumed by 0001+.
-- Sources: the canonical declarations in src/schema/campaign.ts and
-- src/schema/governance.ts, with columns introduced by migrations removed.
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid, name text NOT NULL,
  scope text NOT NULL, region text NOT NULL DEFAULT 'Global', audience text NOT NULL,
  outcome text NOT NULL, lifecycle text NOT NULL DEFAULT 'Idea',
  readiness integer NOT NULL DEFAULT 20, timing text NOT NULL DEFAULT 'TBD',
  owner text NOT NULL DEFAULT 'Campaign team',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  email text NOT NULL UNIQUE, role text NOT NULL DEFAULT 'marketer',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campaign_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  region text NOT NULL, configuration jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campaign_strategy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL UNIQUE,
  data jsonb NOT NULL DEFAULT '{}', inheritance jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  name text NOT NULL, region text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  name text NOT NULL, type text NOT NULL, audience text NOT NULL, region text NOT NULL,
  timing text NOT NULL, status text NOT NULL, owner text NOT NULL,
  conflict boolean NOT NULL DEFAULT false, decision_status text NOT NULL DEFAULT 'Estimated',
  x numeric NOT NULL, y numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE activity_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  source uuid NOT NULL, target uuid NOT NULL, trigger text NOT NULL, timing text NOT NULL,
  exclusions jsonb NOT NULL DEFAULT '[]', sentence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  activity_id uuid, name text NOT NULL, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  name text NOT NULL, reusable boolean NOT NULL DEFAULT true, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE landing_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  name text NOT NULL, url text, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  name text NOT NULL, target numeric, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  amount numeric, currency text NOT NULL DEFAULT 'USD', status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), classification text NOT NULL,
  severity text NOT NULL, title text NOT NULL, reason text NOT NULL,
  campaign_ids jsonb NOT NULL, dates text NOT NULL, recommendation text NOT NULL,
  owner text NOT NULL, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conflict_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conflict_id uuid NOT NULL,
  resolution text NOT NULL, owner text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE taxonomy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version text NOT NULL UNIQUE,
  effective_at timestamptz NOT NULL, deprecated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE taxonomy_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL,
  category text NOT NULL, label text NOT NULL, shortcode text NOT NULL,
  parent_id uuid, source_metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  stage text NOT NULL, status text NOT NULL, approver text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE utm_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL,
  destination_url text NOT NULL, full_url text NOT NULL, taxonomy_version text NOT NULL,
  generated_values jsonb NOT NULL, validation text NOT NULL, status text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL,
  entity_id uuid NOT NULL, action text NOT NULL, changes jsonb NOT NULL,
  actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);