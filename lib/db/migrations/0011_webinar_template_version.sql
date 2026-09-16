-- Persist the fixed webinar communication template on each session.
--
-- Existing sessions are explicitly legacy nine-message sessions.  The
-- application assigns the five-message version only while creating a new
-- session; this migration never rewrites existing standard rows, schedules,
-- content, or history.

ALTER TABLE webinar_sessions
  ADD COLUMN IF NOT EXISTS template_version text;

UPDATE webinar_sessions
SET template_version = 'legacy_9'
WHERE template_version IS NULL;

ALTER TABLE webinar_sessions
  ALTER COLUMN template_version SET DEFAULT 'legacy_9';

ALTER TABLE webinar_sessions
  ALTER COLUMN template_version SET NOT NULL;