-- Quarantine all Campaign Governance Foundation taxonomy and channel values.
-- Preserve identities and hierarchy; remove approvals rather than deleting data.
ALTER TABLE governed_channels
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TEMP TABLE foundation_quarantine_metadata(value jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO foundation_quarantine_metadata(value) VALUES ('{
  "source_environment":"development",
  "verification_status":"provisional",
  "publishing_eligible":false,
  "source_reference":"Campaign Governance Foundation, migrated via audit",
  "requires_business_validation":true,
  "sourceLabel":"Campaign Governance Foundation quarantined migration",
  "codeProvenance":"foundation_migrated_provisional"
}'::jsonb);

CREATE TEMP TABLE foundation_quarantined_terms(id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO foundation_quarantined_terms(id)
SELECT id
FROM taxonomy_terms
WHERE category IN ('product_line', 'campaign_shortcode', 'subcampaign')
  AND source_metadata->>'codeProvenance' IN (
  'foundation_production_user_supplied',
  'foundation_migrated_provisional'
);

CREATE TEMP TABLE foundation_quarantined_channels(id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO foundation_quarantined_channels(id) VALUES
  ('psg'), ('psl'), ('disp'), ('orglin'), ('adv'), ('eml'), ('emlc'),
  ('emlp'), ('evlv'), ('evind'), ('evvrt'), ('app'), ('mcp');

UPDATE taxonomy_terms
SET source_metadata = source_metadata || (SELECT value FROM foundation_quarantine_metadata),
    updated_at = now()
WHERE id IN (SELECT id FROM foundation_quarantined_terms);

UPDATE governed_channels
SET source_metadata = source_metadata || (SELECT value FROM foundation_quarantine_metadata),
    updated_at = now()
WHERE id IN (SELECT id FROM foundation_quarantined_channels);

UPDATE taxonomy_terms AS term
SET source_metadata = term.source_metadata
      || (SELECT value FROM foundation_quarantine_metadata)
      || jsonb_build_object(
        'canonicalActivityModel', true,
        'channelType', channel.type
      ),
    updated_at = now()
FROM governed_channels AS channel
WHERE term.category = 'channel'
  AND term.shortcode = channel.id
  AND channel.id IN (SELECT id FROM foundation_quarantined_channels)
  AND term.source_metadata->>'canonicalActivityModel' = 'true';

DELETE FROM approvals
WHERE record_type IN ('taxonomyTerm', 'taxonomy_term')
  AND (
    record_id IN (SELECT id FROM foundation_quarantined_terms)
    OR record_id IN (
      SELECT id FROM taxonomy_terms
      WHERE category = 'channel'
        AND shortcode IN (SELECT id FROM foundation_quarantined_channels)
        AND source_metadata->>'canonicalActivityModel' = 'true'
    )
  );

INSERT INTO governance_audit_events(
  entity_type, entity_id, action, actor, reason, before, after, metadata
)
SELECT
  'taxonomyTerm',
  term.id,
  'quarantine',
  'system:migration',
  'Quarantine unvalidated Campaign Governance Foundation data pending source-system remediation and business validation',
  NULL,
  to_jsonb(term),
  '{"actorProvenance":"declared","source":"migration:0019_quarantine_foundation_governance"}'::jsonb
FROM taxonomy_terms AS term
WHERE term.id IN (SELECT id FROM foundation_quarantined_terms)
  AND NOT EXISTS (
    SELECT 1
    FROM governance_audit_events AS existing
    WHERE existing.entity_type = 'taxonomyTerm'
      AND existing.entity_id = term.id
      AND existing.action = 'quarantine'
      AND existing.metadata->>'source' = 'migration:0019_quarantine_foundation_governance'
  );

DO $$
DECLARE
  metadata jsonb := (SELECT value FROM foundation_quarantine_metadata);
BEGIN
  IF (SELECT count(*) FROM foundation_quarantined_terms) <> 98
    OR (SELECT count(*) FROM taxonomy_terms t
        JOIN foundation_quarantined_terms q ON q.id = t.id
        WHERE t.category = 'product_line' AND t.source_metadata @> metadata) <> 7
    OR (SELECT count(*) FROM taxonomy_terms t
        JOIN foundation_quarantined_terms q ON q.id = t.id
        WHERE t.category = 'campaign_shortcode' AND t.source_metadata @> metadata) <> 51
    OR (SELECT count(*) FROM taxonomy_terms t
        JOIN foundation_quarantined_terms q ON q.id = t.id
        WHERE t.category = 'subcampaign' AND t.source_metadata @> metadata) <> 40 THEN
    RAISE EXCEPTION 'Foundation quarantine must preserve and mark exactly 7 product lines, 51 campaign shortcodes, and 40 subcampaigns';
  END IF;

  IF (SELECT count(*) FROM governed_channels
      WHERE id IN (SELECT id FROM foundation_quarantined_channels)
        AND source_metadata @> metadata) <> 13 THEN
    RAISE EXCEPTION 'Foundation quarantine must mark exactly 13 governed channel IDs';
  END IF;
END $$;