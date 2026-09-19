-- Governance refinement is additive.  Existing campaign taxonomy and approval
-- rows remain addressable while canonical governance fields are introduced.

ALTER TABLE taxonomy_terms
  ADD COLUMN IF NOT EXISTS superseded_by uuid,
  ADD COLUMN IF NOT EXISTS legacy_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_deprecated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deprecated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS deprecation_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'taxonomy_terms_parent_id_fk'
  ) THEN
    ALTER TABLE taxonomy_terms
      ADD CONSTRAINT taxonomy_terms_parent_id_fk
      FOREIGN KEY (parent_id) REFERENCES taxonomy_terms(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'taxonomy_terms_superseded_by_fk'
  ) THEN
    ALTER TABLE taxonomy_terms
      ADD CONSTRAINT taxonomy_terms_superseded_by_fk
      FOREIGN KEY (superseded_by) REFERENCES taxonomy_terms(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'taxonomy_terms_version_id_fk'
  ) THEN
    ALTER TABLE taxonomy_terms
      ADD CONSTRAINT taxonomy_terms_version_id_fk
      FOREIGN KEY (version_id) REFERENCES taxonomy_versions(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS taxonomy_terms_version_idx
  ON taxonomy_terms (version_id);
-- 0016 replaces this legacy global namespace with hierarchy-scoped indexes.
-- The development migration runner replays every migration, so do not recreate
-- the obsolete index after stable-key support has been installed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'taxonomy_terms'
      AND column_name = 'stable_key'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS taxonomy_terms_version_shortcode_uq
      ON taxonomy_terms (version_id, shortcode);
  END IF;
END $$;

-- Approvals are one polymorphic table.  campaign_id is retained nullable as
-- a compatibility column for old clients, but record_type/record_id are the
-- canonical target fields going forward.
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS record_type text,
  ADD COLUMN IF NOT EXISTS record_id uuid;

UPDATE approvals
SET record_type = 'campaign',
    record_id = campaign_id
WHERE record_type IS NULL OR record_id IS NULL;

ALTER TABLE approvals
  ALTER COLUMN campaign_id DROP NOT NULL,
  ALTER COLUMN record_type SET NOT NULL,
  ALTER COLUMN record_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approvals_record_type_ck'
  ) THEN
    ALTER TABLE approvals
      ADD CONSTRAINT approvals_record_type_ck
      CHECK (record_type IN (
        'campaign', 'activity', 'communication', 'asset', 'landingPage',
        'kpi', 'budget', 'conflict', 'taxonomyTerm', 'taxonomyVersion',
        'importBatch', 'importCandidate'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS approvals_record_target_idx
  ON approvals (record_type, record_id);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type text NOT NULL,
  record_id uuid NOT NULL,
  body text NOT NULL,
  actor text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_record_target_idx
  ON comments (record_type, record_id);

CREATE TABLE IF NOT EXISTS governance_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  before jsonb,
  after jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS governance_audit_events_entity_idx
  ON governance_audit_events (entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS taxonomy_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES taxonomy_versions(id),
  source_name text NOT NULL,
  idempotency_key text UNIQUE,
  status text NOT NULL DEFAULT 'staged',
  actor text NOT NULL,
  reason text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS taxonomy_import_batches_version_idx
  ON taxonomy_import_batches (version_id);

CREATE TABLE IF NOT EXISTS taxonomy_import_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES taxonomy_import_batches(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'staged',
  conflict_type text,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_note text,
  committed_term_id uuid REFERENCES taxonomy_terms(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT taxonomy_import_candidates_batch_source_key_uq
    UNIQUE (batch_id, source_key)
);
CREATE INDEX IF NOT EXISTS taxonomy_import_candidates_batch_idx
  ON taxonomy_import_candidates (batch_id);