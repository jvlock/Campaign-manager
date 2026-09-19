-- Unassigned communication channels remain NULL; no provider is guessed.
ALTER TABLE communication_details ALTER COLUMN channel DROP NOT NULL;
ALTER TABLE communication_details ALTER COLUMN channel DROP DEFAULT;

-- Retire only the known invented/generic lowercase-category channel values.
-- Historical rows remain resolvable; no activities or communication history is remapped.
UPDATE taxonomy_terms
SET is_deprecated = true,
    deprecated_at = COALESCE(deprecated_at, now()),
    deprecation_reason = COALESCE(deprecation_reason, 'Retired when canonical Campaign Governance Foundation channels were registered'),
    updated_at = now()
WHERE category = 'channel'
  AND shortcode NOT IN ('psg','psl','disp','orglin','adv','eml','emlc','emlp','evlv','evind','evvrt','app','mcp')
  AND (
    lower(shortcode) IN ('paid search','paid-search','paid_search','paid social','paid-social','paid_social','display','newsletter email','newsletter-email','newsletter_email','nurture email','nurture-email','nurture_email','pre-event email','pre_event_email','post-event email','post_event_email','events','email','webinar')
    OR lower(label) IN ('paid search','paid social','display','newsletter email','nurture email','pre-event email','post-event email','events','email','webinar')
  )
  AND is_deprecated = false;