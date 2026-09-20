-- Publishing must discover composite reference keys as UNIQUE constraints,
-- not merely standalone indexes. Reuse the indexes so data and foreign-key
-- dependencies remain intact.
DO $$
DECLARE
  target_table text;
  constraint_name text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['assets', 'landing_pages', 'ctas']
  LOOP
    constraint_name := target_table || '_id_campaign_unique';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.' || target_table)
        AND conname = constraint_name
        AND contype = 'u'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I UNIQUE USING INDEX %I',
        target_table, constraint_name, constraint_name
      );
    END IF;
  END LOOP;
END $$;