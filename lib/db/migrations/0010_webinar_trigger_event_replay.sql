-- Registration/cancellation/re-registration can legitimately happen within
-- one clock tick.  Each successful transition is an independent immutable
-- event, so recorded_at is an audit value rather than a uniqueness key.
DROP INDEX IF EXISTS webinar_standard_trigger_events_session_person_recorded_idx;

INSERT INTO webinar_standard_trigger_events (
  campaign_id, session_id, person_id, standard_communication_id, recorded_at
)
SELECT registration.campaign_id,
       registration.session_id,
       registration.person_id,
       standard.id,
       registration.recorded_at
FROM webinar_registration_results AS registration
JOIN webinar_standard_communications AS standard
  ON standard.campaign_id = registration.campaign_id
 AND standard.session_id = registration.session_id
 AND standard.key = 'registration_confirmation'
WHERE registration.result = 'registered'
  AND NOT EXISTS (
    SELECT 1
    FROM webinar_standard_trigger_events AS existing
    WHERE existing.campaign_id = registration.campaign_id
      AND existing.session_id = registration.session_id
      AND existing.person_id = registration.person_id
  );