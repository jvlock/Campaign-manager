-- CliCS taxonomy source attribution is additive.  Existing taxonomy terms
-- retain their hierarchy, current shortcodes, and legacy namespace while the
-- source details for imported/reference values become explicit.

ALTER TABLE taxonomy_terms
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Be defensive if a development database already had the column from an
-- interrupted/manual application of this migration.
UPDATE taxonomy_terms
SET source_metadata = '{}'::jsonb
WHERE source_metadata IS NULL;

ALTER TABLE taxonomy_terms
  ALTER COLUMN source_metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN source_metadata SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'taxonomy_terms_source_metadata_object_ck'
  ) THEN
    ALTER TABLE taxonomy_terms
      ADD CONSTRAINT taxonomy_terms_source_metadata_object_ck
      CHECK (jsonb_typeof(source_metadata) = 'object');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS taxonomy_terms_version_category_label_idx
  ON taxonomy_terms (version_id, category, label);