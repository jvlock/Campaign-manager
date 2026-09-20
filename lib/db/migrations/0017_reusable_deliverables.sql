ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS brief text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT 'Campaign team',
  ADD COLUMN IF NOT EXISTS publish_by text;
ALTER TABLE assets ALTER COLUMN reusable SET DEFAULT true;

ALTER TABLE landing_pages
  ADD COLUMN IF NOT EXISTS headline text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supporting_copy_needs text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS personalization_requirements text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT 'Campaign team',
  ADD COLUMN IF NOT EXISTS publish_by text;

-- Normalize the older generic delivery-status vocabulary into the build
-- lifecycle before enforcing the reusable-deliverable contract.
UPDATE assets
SET status = CASE
  WHEN status IN ('Not Started', 'Drafted', 'In Review', 'Published') THEN status
  WHEN lower(status) IN ('confirmed', 'known', 'complete', 'completed') THEN 'Published'
  ELSE 'Not Started'
END;
UPDATE landing_pages
SET status = CASE
  WHEN status IN ('Not Started', 'Drafted', 'In Review', 'Published') THEN status
  WHEN lower(status) IN ('confirmed', 'known', 'complete', 'completed') THEN 'Published'
  ELSE 'Not Started'
END;

CREATE UNIQUE INDEX IF NOT EXISTS assets_id_campaign_unique ON assets(id, campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS landing_pages_id_campaign_unique ON landing_pages(id, campaign_id);

CREATE TABLE IF NOT EXISTS ctas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  name text NOT NULL,
  button_text text NOT NULL,
  landing_page_id uuid,
  destination_url text,
  owner text NOT NULL,
  status text NOT NULL DEFAULT 'Not Started',
  publish_by text,
  legacy_source_key text UNIQUE,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ctas_destination_exactly_one CHECK ((landing_page_id IS NULL) <> (destination_url IS NULL)),
  CONSTRAINT ctas_status_valid CHECK (status IN ('Not Started', 'Drafted', 'In Review', 'Published')),
  CONSTRAINT ctas_landing_page_campaign_fk FOREIGN KEY (landing_page_id, campaign_id) REFERENCES landing_pages(id, campaign_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ctas_id_campaign_unique ON ctas(id, campaign_id);

CREATE TABLE IF NOT EXISTS communication_ctas (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  communication_id uuid NOT NULL,
  cta_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_ctas_pk PRIMARY KEY (communication_id, cta_id),
  CONSTRAINT communication_ctas_communication_campaign_fk FOREIGN KEY (communication_id, campaign_id) REFERENCES communications(id, campaign_id),
  CONSTRAINT communication_ctas_cta_campaign_fk FOREIGN KEY (cta_id, campaign_id) REFERENCES ctas(id, campaign_id)
);
CREATE TABLE IF NOT EXISTS communication_landing_pages (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  communication_id uuid NOT NULL,
  landing_page_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_landing_pages_pk PRIMARY KEY (communication_id, landing_page_id),
  CONSTRAINT communication_landing_pages_communication_campaign_fk FOREIGN KEY (communication_id, campaign_id) REFERENCES communications(id, campaign_id),
  CONSTRAINT communication_landing_pages_landing_page_campaign_fk FOREIGN KEY (landing_page_id, campaign_id) REFERENCES landing_pages(id, campaign_id)
);
CREATE TABLE IF NOT EXISTS landing_page_content_assets (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  landing_page_id uuid NOT NULL,
  content_asset_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT landing_page_content_assets_pk PRIMARY KEY (landing_page_id, content_asset_id),
  CONSTRAINT landing_page_content_assets_landing_page_campaign_fk FOREIGN KEY (landing_page_id, campaign_id) REFERENCES landing_pages(id, campaign_id),
  CONSTRAINT landing_page_content_assets_asset_campaign_fk FOREIGN KEY (content_asset_id, campaign_id) REFERENCES assets(id, campaign_id)
);

ALTER TABLE communication_details
  ADD COLUMN IF NOT EXISTS release_state text NOT NULL DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

DO $$ BEGIN
  ALTER TABLE communication_details ADD CONSTRAINT communication_details_release_state_valid CHECK (release_state IN ('Draft', 'Released'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE assets ADD CONSTRAINT assets_status_valid CHECK (status IN ('Not Started', 'Drafted', 'In Review', 'Published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE landing_pages ADD CONSTRAINT landing_pages_status_valid CHECK (status IN ('Not Started', 'Drafted', 'In Review', 'Published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ctas ADD CONSTRAINT ctas_destination_url_http CHECK (
    destination_url IS NULL OR destination_url ~* '^https?://[^[:space:]/?#]+([/?#].*)?$'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE landing_pages ADD CONSTRAINT landing_pages_url_http CHECK (
    url IS NULL OR url ~* '^https?://[^[:space:]/?#]+([/?#].*)?$'
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Canonicalize valid historical webinar CTA content without changing the
-- legacy JSON. Each variant keeps a stable source key and provenance.
WITH legacy AS (
  SELECT w.campaign_id,
         w.communication_id,
         w.id AS standard_id,
         w.name AS communication_name,
         CASE
           WHEN coalesce(variant->>'slot', '') ~ '^[1-9][0-9]*$' THEN (variant->>'slot')::integer
           ELSE NULL
         END AS slot,
         trim(coalesce(variant->'content'->>'ctaLabel', '')) AS label,
         trim(coalesce(variant->'content'->>'ctaUrl', '')) AS url
  FROM webinar_standard_communications w
  CROSS JOIN LATERAL jsonb_array_elements(w.variants) variant
  WHERE w.communication_id IS NOT NULL
), inserted AS (
  INSERT INTO ctas(campaign_id, name, button_text, destination_url, owner, status, legacy_source_key, source_metadata)
  SELECT campaign_id,
         communication_name || ' — variant ' || slot,
         label,
         url,
         'Campaign team',
         'Not Started',
         'webinar:' || standard_id || ':variant:' || slot,
         jsonb_build_object('source', 'legacy_webinar_variant', 'standardCommunicationId', standard_id, 'variantSlot', slot)
  FROM legacy
  WHERE slot IS NOT NULL
    AND label <> ''
    AND url ~* '^https?://[^[:space:]/?#]+([/?#].*)?$'
  ON CONFLICT (legacy_source_key) DO NOTHING
  RETURNING id, campaign_id, legacy_source_key
)
INSERT INTO communication_ctas(campaign_id, communication_id, cta_id)
SELECT l.campaign_id, l.communication_id, c.id
FROM legacy l
JOIN ctas c ON c.legacy_source_key = 'webinar:' || l.standard_id || ':variant:' || l.slot
ON CONFLICT DO NOTHING;