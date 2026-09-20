-- Development-only stage-one schema preparation. Managed Publish compares
-- database schemas; it does not replay this SQL against production.
-- Preserve legacy production data while retaining validation for other values.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_status_valid;
ALTER TABLE assets ADD CONSTRAINT assets_status_valid
  CHECK (status IN ('Not Started', 'Drafted', 'In Review', 'Published', 'Confirmed'));

-- Temporarily defer only these four relationships until a verified stage-one
-- publish creates their parent UNIQUE constraints in production.
ALTER TABLE ctas DROP CONSTRAINT IF EXISTS ctas_landing_page_campaign_fk;
ALTER TABLE communication_landing_pages
  DROP CONSTRAINT IF EXISTS communication_landing_pages_landing_page_campaign_fk;
ALTER TABLE landing_page_content_assets
  DROP CONSTRAINT IF EXISTS landing_page_content_assets_asset_campaign_fk;
ALTER TABLE landing_page_content_assets
  DROP CONSTRAINT IF EXISTS landing_page_content_assets_landing_page_campaign_fk;