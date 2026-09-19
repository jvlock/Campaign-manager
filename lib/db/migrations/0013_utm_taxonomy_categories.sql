-- Category registry only. Values and approvals are deliberately not seeded.
CREATE TABLE IF NOT EXISTS taxonomy_categories (
  key text PRIMARY KEY,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO taxonomy_categories(key,label) VALUES
 ('product_line','Product line'),('campaign_shortcode','Campaign shortcode'),
 ('subcampaign','Subcampaign'),('ads_subtype','Ads subtype'),
 ('utm_objective','UTM objective'),('audience','Audience'),
 ('audience_segment','Audience segment'),('utm_region','UTM region'),
 ('creative_type','Creative type'),('image_size','Image size'),
 ('video_length','Video length'),('content_type','Content type'),
 ('creative_cta','Creative CTA'),('content_order','Content order'),
 ('email_type','Email type'),('owner','Owner'),
 ('display_partner','Display partner'),('source','Source'),
 ('capture_source','Capture source'),('newsletter_version','Newsletter version'),
 ('link_position','Link position'),('nurture_sequence','Nurture sequence'),
 ('channel','Channel')
ON CONFLICT (key) DO NOTHING;