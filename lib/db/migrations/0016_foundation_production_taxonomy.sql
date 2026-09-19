-- User-supplied Campaign Governance Foundation production taxonomy.
-- Registration is not approval: this migration creates no approval rows.
ALTER TABLE taxonomy_terms ADD COLUMN IF NOT EXISTS stable_key text;

DROP INDEX IF EXISTS taxonomy_terms_version_shortcode_uq;
CREATE UNIQUE INDEX IF NOT EXISTS taxonomy_terms_version_stable_key_uq
  ON taxonomy_terms(version_id, stable_key) WHERE stable_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS taxonomy_terms_root_shortcode_uq
  ON taxonomy_terms(version_id, category, shortcode)
  WHERE parent_id IS NULL AND is_deprecated = false;
CREATE UNIQUE INDEX IF NOT EXISTS taxonomy_terms_child_shortcode_uq
  ON taxonomy_terms(version_id, category, parent_id, shortcode)
  WHERE parent_id IS NOT NULL AND is_deprecated = false;
CREATE INDEX IF NOT EXISTS taxonomy_terms_hierarchy_lookup_idx
  ON taxonomy_terms(version_id, category, parent_id, shortcode);

-- Retire known historical stand-ins without deleting them. Do not retire
-- unrelated categories or previously sourced exact-key terms.
UPDATE taxonomy_terms
SET is_deprecated = true,
    deprecated_at = COALESCE(deprecated_at, now()),
    deprecation_reason = COALESCE(deprecation_reason, 'Replaced by user-supplied Campaign Governance Foundation production taxonomy'),
    updated_at = now()
WHERE stable_key IS NULL
  AND version_id = (
    SELECT id
    FROM taxonomy_versions
    WHERE effective_at <= now() AND (deprecated_at IS NULL OR deprecated_at > now())
    ORDER BY effective_at DESC
    LIMIT 1
  )
  AND (
    (category = 'Product line' AND shortcode = 'IDX' AND label = 'Index')
    OR (
      category IN ('product_line', 'campaign_shortcode', 'subcampaign')
      AND source_metadata->>'codeProvenance' = 'local_assigned'
    )
  )
  AND is_deprecated = false;

CREATE TEMP TABLE foundation_taxonomy_seed (
  category text NOT NULL,
  tag_code text NOT NULL,
  parent_stable_key text,
  stable_key text NOT NULL,
  display_name text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE foundation_taxonomy_changed (
  id uuid PRIMARY KEY,
  before_state jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO foundation_taxonomy_seed(category, tag_code, parent_stable_key, stable_key, display_name)
SELECT fields[1], fields[2], NULLIF(fields[3], ''), fields[4], fields[5]
FROM (
  SELECT string_to_array(line, '|') AS fields
  FROM regexp_split_to_table($seed$
product_line|analytics||product_line:analytics|Analytics
product_line|climate||climate|Climate
product_line|index||product_line:index|Index
product_line|onemsci||onemsci|OneMSCI
product_line|privateasset||privateasset|Private Asset
product_line|sustainb||sustainb|Sustainability
product_line|wealth||wealth|Wealth
campaign_shortcode|bau|product_line:analytics|campaign_shortcode:analytics:bau|Business as Usual
campaign_shortcode|fut-risk|product_line:analytics|fut-risk|Future of Risk and Performance Management
campaign_shortcode|pow-port|product_line:analytics|pow-port|Powering the Front Office to Build Resilient Portfolios
campaign_shortcode|tps|product_line:analytics|campaign_shortcode:analytics:tps|Total Portfolio Analytics / Solutions
campaign_shortcode|value|product_line:analytics|value|Reinforcing Value
campaign_shortcode|bau|climate|campaign_shortcode:climate:bau|Business as Usual
campaign_shortcode|climate-series|climate|climate-series|Climate Series
campaign_shortcode|me-crisis|climate|campaign_shortcode:climate:me-crisis|Middle East Crisis
campaign_shortcode|phys-risk|climate|phys-risk|Physical Risk
campaign_shortcode|transition|climate|transition|Transition Opportunities to Catalyze Growth
campaign_shortcode|trends|climate|campaign_shortcode:climate:trends|Trends in Focus
campaign_shortcode|bau|product_line:index|campaign_shortcode:index:bau|Business as Usual
campaign_shortcode|i4e|product_line:index|i4e|An Index for Each
campaign_shortcode|i4w|product_line:index|i4w|Expansion into the Wealth Channel
campaign_shortcode|leadership|product_line:index|leadership|Reinforcing the MSCI Index Dominance
campaign_shortcode|bau|onemsci|campaign_shortcode:onemsci:bau|Business as Usual
campaign_shortcode|corp-act-eng|onemsci|campaign_shortcode:onemsci:corp-act-eng|Corporate Activation Engine
campaign_shortcode|employer_brand|onemsci|employer_brand|Employer Brand
campaign_shortcode|institute|onemsci|campaign_shortcode:onemsci:institute|Institute
campaign_shortcode|institutional-investor-forum|onemsci|institutional-investor-forum|Institutional Investor Forum
campaign_shortcode|inv-summit|onemsci|inv-summit|Investor Summit
campaign_shortcode|mstrbr|onemsci|mstrbr|Masterbrand
campaign_shortcode|recruitment_marketing|onemsci|recruitment_marketing|Recruitment Marketing
campaign_shortcode|research|onemsci|campaign_shortcode:onemsci:research|Research
campaign_shortcode|tariff-hub|onemsci|tariff-hub|Tariff Hub
campaign_shortcode|trends|onemsci|campaign_shortcode:onemsci:trends|Trends in Focus
campaign_shortcode|bau|privateasset|campaign_shortcode:privateasset:bau|Business as Usual
campaign_shortcode|benchmkg|privateasset|benchmkg|Benchmarking
campaign_shortcode|expansion|privateasset|expansion|Powering Private Asset Allocation & Expansion
campaign_shortcode|fam-off|privateasset|fam-off|Family Office
campaign_shortcode|gp-solutions|privateasset|gp-solutions|GP Solutions
campaign_shortcode|me-crisis|privateasset|campaign_shortcode:privateasset:me-crisis|Middle East Crisis
campaign_shortcode|pa-ai-infra|privateasset|pa-ai-infra|PA AI Infrastructure
campaign_shortcode|pa-indx|privateasset|pa-indx|PA Index
campaign_shortcode|priv-cred-sols|privateasset|priv-cred-sols|Private Credit Solutions
campaign_shortcode|re-opp|privateasset|re-opp|Capitalize on Real Estate Opportunities
campaign_shortcode|tps|privateasset|campaign_shortcode:privateasset:tps|Total Portfolio Solutions
campaign_shortcode|trends|privateasset|campaign_shortcode:privateasset:trends|Trends in Focus
campaign_shortcode|bau|sustainb|campaign_shortcode:sustainb:bau|Business as Usual
campaign_shortcode|corp-act-eng|sustainb|campaign_shortcode:sustainb:corp-act-eng|Corporate Activation Engine
campaign_shortcode|institute|sustainb|campaign_shortcode:sustainb:institute|Institute
campaign_shortcode|me-crisis|sustainb|campaign_shortcode:sustainb:me-crisis|Middle East Crisis
campaign_shortcode|regulatory|sustainb|regulatory|Regulations
campaign_shortcode|sust-intel|sustainb|sust-intel|Sustainability Intelligence to Drive Stronger Financial Outcomes
campaign_shortcode|trends|sustainb|campaign_shortcode:sustainb:trends|Trends in Focus
campaign_shortcode|analytics|wealth|campaign_shortcode:wealth:analytics|Grow Wealth Management Portfolio Personalization
campaign_shortcode|bau|wealth|campaign_shortcode:wealth:bau|Business as Usual
campaign_shortcode|brand|wealth|campaign_shortcode:wealth:brand|Promote the Global OneMSCI Wealth Brand
campaign_shortcode|dirct-indx|wealth|dirct-indx|Drive Index-Linked ABF from the Wealth Segment
campaign_shortcode|me-crisis|wealth|campaign_shortcode:wealth:me-crisis|Middle East Crisis
campaign_shortcode|trends|wealth|campaign_shortcode:wealth:trends|Trends in Focus
subcampaign|pm-persp|campaign_shortcode:analytics:bau|pm-persp|MSCI Portfolio Management Perspectives
subcampaign|recurring-events|campaign_shortcode:analytics:bau|subcampaign:analytics/bau:recurring-events|Recurring Events
subcampaign|risk-mgmt-dig|campaign_shortcode:analytics:bau|risk-mgmt-dig|MSCI Risk Management Digest
subcampaign|aipi|fut-risk|aipi|AI Portfolio Insights
subcampaign|aon|fut-risk|subcampaign:analytics/fut-risk:aon|AON
subcampaign|cstm-co|fut-risk|cstm-co|Custom Covariance
subcampaign|mvr|fut-risk|mvr|Multidimension View of Risk
subcampaign|cons-alm|pow-port|cons-alm|Construction - ALM
subcampaign|cons-bb|pow-port|cons-bb|Construction - Basket Builder
subcampaign|cons-efm|pow-port|cons-efm|Construction - Equity Factor Models
subcampaign|cons-fi|pow-port|cons-fi|Construction - Fixed Income Factor Models
subcampaign|cons-ssa|pow-port|cons-ssa|Construction - Single Security Analytics
subcampaign|inv-flabs|pow-port|inv-flabs|Innovation - Factor Labs
subcampaign|inv-sl|pow-port|inv-sl|Innovation - Signal Library
subcampaign|ux-aipi|pow-port|ux-aipi|UX - AI Portfolio Insights
subcampaign|ux-bpm|pow-port|ux-bpm|UX - Barra Portfolio Manager
subcampaign|ux-edd|pow-port|ux-edd|UX - Event Driven Data Set
subcampaign|ux-patt|pow-port|ux-patt|UX - Performance Attribution
subcampaign|barra1|campaign_shortcode:analytics:tps|subcampaign:analytics/tps:barra1|BarraOne
subcampaign|factor|campaign_shortcode:analytics:tps|factor|Factor
subcampaign|pcs|campaign_shortcode:analytics:tps|pcs|PCS Transparency Benchmark
subcampaign|cop31|climate-series|cop31|COP31
subcampaign|lcaw|climate-series|lcaw|London Climate Action Week
subcampaign|nycaw|climate-series|nycaw|New York Climate Week
subcampaign|zurich|climate-series|zurich|Zurich Climate Week
subcampaign|first-street|phys-risk|first-street|First Street Acquisition
subcampaign|geospatial|phys-risk|geospatial|Geospatial
subcampaign|issuer-phys-risk|phys-risk|issuer-phys-risk|Issuer Physical Risk
subcampaign|nature-bio|phys-risk|nature-bio|Nature and Biodiversity
subcampaign|phys-risk-asset|phys-risk|phys-risk-asset|Physical Risk Asset Level
subcampaign|supply-chain|phys-risk|supply-chain|Supply Chain
subcampaign|carbon-markets|transition|carbon-markets|Carbon Markets
subcampaign|ccap|transition|ccap|CCAP Regulation for Climate
subcampaign|cop-30|transition|cop-30|Cop 30
subcampaign|transition-framework|transition|transition-framework|Energy Transition Framework
subcampaign|index-ai-insights|campaign_shortcode:index:bau|index-ai-insights|Index AI Insights MCP Handraiser Always On
subcampaign|mkt-ins|campaign_shortcode:index:bau|mkt-ins|MSCI Market Insights
subcampaign|recurring-events|campaign_shortcode:index:bau|subcampaign:index/bau:recurring-events|Recurring Events
subcampaign|clim-indx|i4e|clim-indx|Climate Indexes
subcampaign|clim-sust-indx|i4e|clim-sust-indx|Climate and Sustainability Indexes
$seed$, E'\n') AS line
  WHERE line <> ''
) parsed;

DO $$
DECLARE
  current_version_id uuid;
  seed_source_metadata jsonb := '{"sourceLabel":"Campaign Governance Foundation production taxonomy (user-supplied)","codeProvenance":"foundation_production_user_supplied"}'::jsonb;
BEGIN
  SELECT id INTO current_version_id
  FROM taxonomy_versions
  WHERE effective_at <= now() AND (deprecated_at IS NULL OR deprecated_at > now())
  ORDER BY effective_at DESC
  LIMIT 1;
  IF current_version_id IS NULL THEN
    RAISE EXCEPTION 'No effective taxonomy version exists for Foundation taxonomy seed';
  END IF;

  INSERT INTO foundation_taxonomy_changed(id, before_state)
  SELECT t.id, to_jsonb(t)
  FROM foundation_taxonomy_seed s
  JOIN taxonomy_terms t
    ON t.version_id = current_version_id AND t.stable_key = s.stable_key
  WHERE s.category = 'product_line'
    AND (
      t.category IS DISTINCT FROM s.category
      OR t.label IS DISTINCT FROM s.display_name
      OR t.shortcode IS DISTINCT FROM s.tag_code
      OR t.parent_id IS NOT NULL
      OR t.source_metadata IS DISTINCT FROM seed_source_metadata
      OR t.is_deprecated
      OR t.deprecated_at IS NOT NULL
      OR t.deprecation_reason IS NOT NULL
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO taxonomy_terms(version_id, category, label, shortcode, stable_key, parent_id, legacy_codes, source_metadata)
  SELECT current_version_id, s.category, s.display_name, s.tag_code, s.stable_key, NULL, '[]'::jsonb, seed_source_metadata
  FROM foundation_taxonomy_seed s
  WHERE s.category = 'product_line'
  ON CONFLICT (version_id, stable_key) WHERE stable_key IS NOT NULL DO UPDATE
  SET label = EXCLUDED.label, shortcode = EXCLUDED.shortcode, source_metadata = EXCLUDED.source_metadata,
      is_deprecated = false, deprecated_at = NULL, deprecation_reason = NULL, updated_at = now();

  INSERT INTO foundation_taxonomy_changed(id, before_state)
  SELECT t.id, to_jsonb(t)
  FROM foundation_taxonomy_seed s
  JOIN taxonomy_terms p
    ON p.version_id = current_version_id AND p.stable_key = s.parent_stable_key
  JOIN taxonomy_terms t
    ON t.version_id = current_version_id AND t.stable_key = s.stable_key
  WHERE s.category = 'campaign_shortcode'
    AND (
      t.category IS DISTINCT FROM s.category
      OR t.label IS DISTINCT FROM s.display_name
      OR t.shortcode IS DISTINCT FROM s.tag_code
      OR t.parent_id IS DISTINCT FROM p.id
      OR t.source_metadata IS DISTINCT FROM seed_source_metadata
      OR t.is_deprecated
      OR t.deprecated_at IS NOT NULL
      OR t.deprecation_reason IS NOT NULL
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO taxonomy_terms(version_id, category, label, shortcode, stable_key, parent_id, legacy_codes, source_metadata)
  SELECT current_version_id, s.category, s.display_name, s.tag_code, s.stable_key, p.id, '[]'::jsonb, seed_source_metadata
  FROM foundation_taxonomy_seed s
  JOIN taxonomy_terms p ON p.version_id = current_version_id AND p.stable_key = s.parent_stable_key
  WHERE s.category = 'campaign_shortcode'
  ON CONFLICT (version_id, stable_key) WHERE stable_key IS NOT NULL DO UPDATE
  SET label = EXCLUDED.label, shortcode = EXCLUDED.shortcode, parent_id = EXCLUDED.parent_id,
      source_metadata = EXCLUDED.source_metadata, is_deprecated = false, deprecated_at = NULL,
      deprecation_reason = NULL, updated_at = now();

  INSERT INTO foundation_taxonomy_changed(id, before_state)
  SELECT t.id, to_jsonb(t)
  FROM foundation_taxonomy_seed s
  JOIN taxonomy_terms p
    ON p.version_id = current_version_id AND p.stable_key = s.parent_stable_key
  JOIN taxonomy_terms t
    ON t.version_id = current_version_id AND t.stable_key = s.stable_key
  WHERE s.category = 'subcampaign'
    AND (
      t.category IS DISTINCT FROM s.category
      OR t.label IS DISTINCT FROM s.display_name
      OR t.shortcode IS DISTINCT FROM s.tag_code
      OR t.parent_id IS DISTINCT FROM p.id
      OR t.source_metadata IS DISTINCT FROM seed_source_metadata
      OR t.is_deprecated
      OR t.deprecated_at IS NOT NULL
      OR t.deprecation_reason IS NOT NULL
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO taxonomy_terms(version_id, category, label, shortcode, stable_key, parent_id, legacy_codes, source_metadata)
  SELECT current_version_id, s.category, s.display_name, s.tag_code, s.stable_key, p.id, '[]'::jsonb, seed_source_metadata
  FROM foundation_taxonomy_seed s
  JOIN taxonomy_terms p ON p.version_id = current_version_id AND p.stable_key = s.parent_stable_key
  WHERE s.category = 'subcampaign'
  ON CONFLICT (version_id, stable_key) WHERE stable_key IS NOT NULL DO UPDATE
  SET label = EXCLUDED.label, shortcode = EXCLUDED.shortcode, parent_id = EXCLUDED.parent_id,
      source_metadata = EXCLUDED.source_metadata, is_deprecated = false, deprecated_at = NULL,
      deprecation_reason = NULL, updated_at = now();

  DELETE FROM approvals
  WHERE record_type IN ('taxonomyTerm', 'taxonomy_term')
    AND record_id IN (SELECT id FROM foundation_taxonomy_changed);

  INSERT INTO governance_audit_events(
    entity_type, entity_id, action, actor, reason, before, after, metadata
  )
  SELECT
    'taxonomyTerm',
    changed.id,
    'seed_update',
    'system:migration',
    'Correct user-supplied Campaign Governance Foundation production taxonomy term',
    changed.before_state,
    to_jsonb(term),
    '{"actorProvenance":"declared","source":"migration:0016_foundation_production_taxonomy"}'::jsonb
  FROM foundation_taxonomy_changed changed
  JOIN taxonomy_terms term ON term.id = changed.id;

  IF (SELECT count(*) FROM taxonomy_terms t JOIN foundation_taxonomy_seed s
      ON s.stable_key = t.stable_key AND s.category = t.category
      WHERE t.version_id = current_version_id) <> 98
    OR (SELECT count(*) FROM taxonomy_terms t JOIN foundation_taxonomy_seed s
        ON s.stable_key = t.stable_key AND s.category = 'product_line' AND t.category = s.category
        WHERE t.version_id = current_version_id) <> 7
    OR (SELECT count(*) FROM taxonomy_terms t JOIN foundation_taxonomy_seed s
        ON s.stable_key = t.stable_key AND s.category = 'campaign_shortcode' AND t.category = s.category
        WHERE t.version_id = current_version_id) <> 51
    OR (SELECT count(*) FROM taxonomy_terms t JOIN foundation_taxonomy_seed s
        ON s.stable_key = t.stable_key AND s.category = 'subcampaign' AND t.category = s.category
        WHERE t.version_id = current_version_id) <> 40 THEN
    RAISE EXCEPTION 'Foundation taxonomy seed expected exactly 7 product lines, 51 campaign shortcodes, and 40 subcampaigns';
  END IF;
END $$;