-- Phase 2B-0 section 7 assigns immutable participant/attendance source history
-- beside the existing current registration and attendance projections.
CREATE TABLE webinar_synthetic_fixtures (
  person_id uuid PRIMARY KEY REFERENCES webinar_people(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL,
  fixture_key text NOT NULL CHECK (fixture_key ~ '^fixture-[0-9]{1,8}$'),
  provenance text NOT NULL DEFAULT 'synthetic-participant-simulator' CHECK (provenance = 'synthetic-participant-simulator'),
  audience_class text NOT NULL CHECK (audience_class IN ('customer','internal','test')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id,fixture_key),
  UNIQUE (person_id,campaign_id),
  FOREIGN KEY (person_id,campaign_id) REFERENCES webinar_people(id,campaign_id) ON DELETE RESTRICT
);
CREATE TABLE webinar_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  session_id uuid NOT NULL,
  person_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_key text NOT NULL CHECK (event_key ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  action text NOT NULL CHECK (action IN ('register','waitlist','promote','cancel-registration','cancel-occurrence','reschedule','complete-occurrence','record-attendance','reconcile-attendance','seed-executed-history')),
  source_system text NOT NULL DEFAULT 'synthetic-simulator' CHECK (source_system = 'synthetic-simulator'),
  source_reference text NOT NULL CHECK (source_reference ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  observed_at timestamptz NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  CHECK ((person_id IS NULL) = (action IN ('cancel-occurrence','reschedule','complete-occurrence'))),
  CHECK (action NOT IN ('record-attendance','reconcile-attendance')
    OR payload #>> '{after,attendance}' IN ('attended','absent','unknown')),
  CHECK (action <> 'complete-occurrence' OR payload ? 'actualEndAt'),
  UNIQUE (session_id,event_key),
  UNIQUE (session_id,source_system,source_reference),
  UNIQUE (id,campaign_id,session_id),
  FOREIGN KEY (session_id,campaign_id) REFERENCES webinar_persistence_bindings(session_id,campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (person_id,campaign_id) REFERENCES webinar_synthetic_fixtures(person_id,campaign_id) ON DELETE RESTRICT
);
CREATE INDEX webinar_lifecycle_person_history ON webinar_lifecycle_events(session_id,person_id,reconciled_at,id);
CREATE TABLE webinar_lifecycle_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  session_id uuid NOT NULL,
  person_id uuid NOT NULL,
  communication_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('recruitment_1','recruitment_2','recruitment_3','final_recruitment',
    'registration_confirmation','calendar_information','reminder_24_hour','reminder_1_hour',
    'event_change_notice','event_cancellation_notice','attended_follow_up','absent_follow_up',
    'attendance_reconciliation','neutral_follow_up','waitlist_confirmation','waitlist_promotion',
    'waitlist_closure','participant_cancellation_confirmation','qa_test_send')),
  disposition text NOT NULL CHECK (disposition IN ('required','eligible','omitted','suppressed','cancelled','obsolete','rescheduled','executed')),
  due_at timestamptz,
  reason text NOT NULL,
  source_event_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_event_id,person_id,communication_id),
  FOREIGN KEY (source_event_id,campaign_id,session_id) REFERENCES webinar_lifecycle_events(id,campaign_id,session_id) ON DELETE RESTRICT,
  FOREIGN KEY (person_id,campaign_id) REFERENCES webinar_synthetic_fixtures(person_id,campaign_id) ON DELETE RESTRICT
);
CREATE INDEX webinar_lifecycle_obligation_current ON webinar_lifecycle_obligations(session_id,person_id,communication_id,recorded_at DESC,id DESC);
CREATE FUNCTION webinar_lifecycle_obligation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM webinar_lifecycle_events e WHERE e.id=NEW.source_event_id
    AND e.reconciled_at=NEW.recorded_at AND (e.person_id IS NULL OR e.person_id=NEW.person_id)) THEN
    RAISE EXCEPTION 'Lifecycle obligation must be recorded in its matching source event transaction';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webinar_lifecycle_obligation_source_required BEFORE INSERT ON webinar_lifecycle_obligations
  FOR EACH ROW EXECUTE FUNCTION webinar_lifecycle_obligation_source();
-- Fixture-seeded *past* execution evidence, not a send or execution API.
CREATE TABLE webinar_synthetic_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  session_id uuid NOT NULL,
  person_id uuid NOT NULL,
  communication_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('recruitment_1','recruitment_2','recruitment_3','final_recruitment',
    'registration_confirmation','calendar_information','reminder_24_hour','reminder_1_hour',
    'event_change_notice','event_cancellation_notice','attended_follow_up','absent_follow_up',
    'attendance_reconciliation','neutral_follow_up','waitlist_confirmation','waitlist_promotion',
    'waitlist_closure','participant_cancellation_confirmation','qa_test_send')),
  synthetic_message_reference uuid NOT NULL,
  executed_at timestamptz NOT NULL,
  source_event_id uuid NOT NULL,
  provenance text NOT NULL DEFAULT 'synthetic-fixture-history' CHECK (provenance='synthetic-fixture-history'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,person_id,communication_id),
  UNIQUE(session_id,synthetic_message_reference),
  FOREIGN KEY (source_event_id,campaign_id,session_id) REFERENCES webinar_lifecycle_events(id,campaign_id,session_id) ON DELETE RESTRICT,
  FOREIGN KEY (person_id,campaign_id) REFERENCES webinar_synthetic_fixtures(person_id,campaign_id) ON DELETE RESTRICT
);
CREATE FUNCTION webinar_synthetic_execution_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM webinar_lifecycle_events e WHERE e.id=NEW.source_event_id
    AND e.action='seed-executed-history' AND e.person_id=NEW.person_id
    AND e.reconciled_at=NEW.recorded_at
    AND e.observed_at>=NEW.executed_at
    AND e.payload #>> '{historicalExecution,communicationId}'=NEW.communication_id
    AND e.payload #>> '{historicalExecution,kind}'=NEW.kind
    AND e.payload #>> '{historicalExecution,syntheticMessageReference}'=NEW.synthetic_message_reference::text
    AND (e.payload #>> '{historicalExecution,executedAt}')::timestamptz=NEW.executed_at) THEN
    RAISE EXCEPTION 'Synthetic execution history requires matching immutable fixture-seed source fact';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webinar_synthetic_execution_source_required BEFORE INSERT ON webinar_synthetic_executions
  FOR EACH ROW EXECUTE FUNCTION webinar_synthetic_execution_source();
CREATE TABLE webinar_lifecycle_snapshots (
  event_id uuid NOT NULL REFERENCES webinar_lifecycle_events(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL UNIQUE REFERENCES webinar_persistence_records(id) ON DELETE RESTRICT,
  person_id uuid REFERENCES webinar_synthetic_fixtures(person_id) ON DELETE RESTRICT,
  UNIQUE(event_id,person_id),
  PRIMARY KEY (event_id,snapshot_id)
);
CREATE FUNCTION webinar_lifecycle_require_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM webinar_lifecycle_snapshots s
    JOIN webinar_persistence_records r ON r.id=s.snapshot_id
    WHERE s.event_id=NEW.id AND r.actor_id=NEW.actor_id
      AND r.campaign_id=NEW.campaign_id AND r.session_id=NEW.session_id
      AND r.kind='readiness' AND NOT r.operational) THEN
    RAISE EXCEPTION 'Lifecycle source requires same-actor occurrence-scoped simulation snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM webinar_lifecycle_snapshots s
    JOIN webinar_persistence_records r ON r.id=s.snapshot_id WHERE s.event_id=NEW.id
      AND (r.actor_id<>NEW.actor_id OR r.campaign_id<>NEW.campaign_id OR r.session_id<>NEW.session_id
        OR r.kind<>'readiness' OR r.operational)) THEN
    RAISE EXCEPTION 'Every lifecycle snapshot requires same-actor non-operational occurrence scope';
  END IF;
  IF NEW.person_id IS NOT NULL THEN
    IF (SELECT count(*) FROM webinar_lifecycle_snapshots WHERE event_id=NEW.id AND person_id=NEW.person_id) <> 1
      OR (SELECT count(*) FROM webinar_lifecycle_snapshots WHERE event_id=NEW.id) <> 1 THEN
      RAISE EXCEPTION 'Lifecycle participant requires exactly one matching simulation snapshot';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM webinar_registration_results r
    JOIN webinar_synthetic_fixtures f ON f.person_id=r.person_id AND f.campaign_id=r.campaign_id
    WHERE r.session_id=NEW.session_id AND r.campaign_id=NEW.campaign_id)
    OR EXISTS (SELECT 1 FROM webinar_lifecycle_events e
      WHERE e.session_id=NEW.session_id AND e.campaign_id=NEW.campaign_id AND e.person_id IS NOT NULL) THEN
    IF EXISTS (SELECT 1 FROM (
      SELECT p.person_id FROM (
        SELECT r.person_id FROM webinar_registration_results r
          JOIN webinar_synthetic_fixtures f ON f.person_id=r.person_id AND f.campaign_id=r.campaign_id
          WHERE r.session_id=NEW.session_id AND r.campaign_id=NEW.campaign_id
        UNION
        SELECT e.person_id FROM webinar_lifecycle_events e
          WHERE e.session_id=NEW.session_id AND e.campaign_id=NEW.campaign_id AND e.person_id IS NOT NULL
      ) p LEFT JOIN webinar_lifecycle_snapshots s ON s.event_id=NEW.id AND s.person_id=p.person_id
      WHERE s.snapshot_id IS NULL
    ) missing)
      OR (SELECT count(*) FROM webinar_lifecycle_snapshots WHERE event_id=NEW.id) <>
        (SELECT count(*) FROM (
          SELECT r.person_id FROM webinar_registration_results r
            JOIN webinar_synthetic_fixtures f ON f.person_id=r.person_id AND f.campaign_id=r.campaign_id
            WHERE r.session_id=NEW.session_id AND r.campaign_id=NEW.campaign_id
          UNION SELECT e.person_id FROM webinar_lifecycle_events e
            WHERE e.session_id=NEW.session_id AND e.campaign_id=NEW.campaign_id AND e.person_id IS NOT NULL
        ) population) THEN
      RAISE EXCEPTION 'Occurrence lifecycle requires a complete per-participant simulation population';
    END IF;
  ELSIF (SELECT count(*) FROM webinar_lifecycle_snapshots WHERE event_id=NEW.id AND person_id IS NULL) <> 1
    OR (SELECT count(*) FROM webinar_lifecycle_snapshots WHERE event_id=NEW.id) <> 1 THEN
    RAISE EXCEPTION 'Empty occurrence requires exactly one occurrence simulation snapshot';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER webinar_lifecycle_snapshot_required AFTER INSERT ON webinar_lifecycle_events
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION webinar_lifecycle_require_snapshot();
CREATE FUNCTION webinar_lifecycle_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Synthetic lifecycle history is immutable';
END $$;
CREATE TRIGGER webinar_lifecycle_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON webinar_lifecycle_events
  FOR EACH STATEMENT EXECUTE FUNCTION webinar_lifecycle_immutable();
CREATE TRIGGER webinar_lifecycle_obligations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON webinar_lifecycle_obligations
  FOR EACH STATEMENT EXECUTE FUNCTION webinar_lifecycle_immutable();
CREATE TRIGGER webinar_synthetic_executions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON webinar_synthetic_executions
  FOR EACH STATEMENT EXECUTE FUNCTION webinar_lifecycle_immutable();
CREATE TRIGGER webinar_lifecycle_snapshots_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON webinar_lifecycle_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION webinar_lifecycle_immutable();