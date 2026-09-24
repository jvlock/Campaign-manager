-- Additive sidecars only: existing sessions and their legacy bindings are untouched.
CREATE TABLE webinar_persistence_bindings (
  session_id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL,
  standard_id text,
  standard_version text,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  UNIQUE (session_id, campaign_id),
  FOREIGN KEY (session_id, campaign_id) REFERENCES webinar_sessions(id, campaign_id) ON DELETE RESTRICT,
  CHECK ((standard_id IS NULL) = (standard_version IS NULL)),
  CHECK (standard_id IS NULL OR (length(standard_id) > 0 AND length(standard_version) > 0))
);

CREATE TABLE webinar_persistence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  session_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  kind text NOT NULL CHECK (kind IN ('plan','source','evidence','exception-request','exception-disposition','readiness','completion','release','legal-hold')),
  standard_id text,
  standard_version text,
  calculation_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  input_fingerprint text NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  parent_id uuid,
  release_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attribution text NOT NULL DEFAULT 'unverified-development' CHECK (attribution = 'unverified-development'),
  operational boolean NOT NULL DEFAULT false CHECK (NOT operational),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 160),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  retention_class text NOT NULL CHECK (retention_class IN ('decision','provenance','audit','recomputable')),
  expires_at timestamptz NOT NULL CHECK (expires_at > recorded_at),
  UNIQUE (id, session_id, campaign_id),
  UNIQUE (session_id, revision),
  UNIQUE (session_id, idempotency_key),
  UNIQUE (session_id, kind, input_fingerprint, calculation_at),
  FOREIGN KEY (session_id, campaign_id) REFERENCES webinar_persistence_bindings(session_id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_id, session_id, campaign_id) REFERENCES webinar_persistence_records(id, session_id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (release_id, session_id, campaign_id) REFERENCES webinar_persistence_records(id, session_id, campaign_id) ON DELETE RESTRICT,
  CHECK ((standard_id IS NULL) = (standard_version IS NULL)),
  CHECK (kind NOT IN ('readiness','completion') OR (release_id IS NOT NULL AND standard_id IS NOT NULL)),
  CHECK (kind NOT IN ('evidence','exception-request','exception-disposition','legal-hold') OR parent_id IS NOT NULL)
);
CREATE INDEX webinar_persistence_records_scope ON webinar_persistence_records(campaign_id,session_id,revision);
CREATE INDEX webinar_persistence_records_expiry ON webinar_persistence_records(retention_class,expires_at);
CREATE UNIQUE INDEX webinar_exception_one_disposition ON webinar_persistence_records(parent_id) WHERE kind='exception-disposition';

CREATE TABLE webinar_persistence_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL UNIQUE,
  campaign_id uuid NOT NULL,
  session_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action = 'simulation-recorded'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  retention_class text NOT NULL DEFAULT 'audit' CHECK (retention_class = 'audit'),
  expires_at timestamptz NOT NULL CHECK (expires_at > recorded_at),
  FOREIGN KEY (record_id, session_id, campaign_id) REFERENCES webinar_persistence_records(id, session_id, campaign_id) ON DELETE RESTRICT
);
CREATE INDEX webinar_persistence_audit_scope ON webinar_persistence_audit(campaign_id,session_id);

CREATE FUNCTION webinar_persistence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Webinar persistence history is immutable; deletion is not enabled';
END $$;
CREATE TRIGGER webinar_records_immutable BEFORE UPDATE OR DELETE ON webinar_persistence_records
  FOR EACH ROW EXECUTE FUNCTION webinar_persistence_immutable();
CREATE TRIGGER webinar_records_no_truncate BEFORE TRUNCATE ON webinar_persistence_records
  FOR EACH STATEMENT EXECUTE FUNCTION webinar_persistence_immutable();
CREATE TRIGGER webinar_audit_immutable BEFORE UPDATE OR DELETE ON webinar_persistence_audit
  FOR EACH ROW EXECUTE FUNCTION webinar_persistence_immutable();
CREATE TRIGGER webinar_audit_no_truncate BEFORE TRUNCATE ON webinar_persistence_audit
  FOR EACH STATEMENT EXECUTE FUNCTION webinar_persistence_immutable();

-- A record without its same-transaction audit must never commit, including direct SQL.
CREATE FUNCTION webinar_persistence_require_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM webinar_persistence_audit a
    WHERE a.record_id = NEW.id AND a.actor_id = NEW.actor_id) THEN
    RAISE EXCEPTION 'Webinar record requires corresponding actor audit';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER webinar_records_require_audit
  AFTER INSERT ON webinar_persistence_records DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION webinar_persistence_require_audit();

CREATE FUNCTION webinar_binding_revision_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id <> OLD.session_id OR NEW.campaign_id <> OLD.campaign_id
    OR NEW.standard_id IS DISTINCT FROM OLD.standard_id
    OR NEW.standard_version IS DISTINCT FROM OLD.standard_version
    OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Binding is immutable; revisions must advance by one';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webinar_binding_revision_only BEFORE UPDATE ON webinar_persistence_bindings
  FOR EACH ROW EXECUTE FUNCTION webinar_binding_revision_only();
CREATE TRIGGER webinar_binding_no_delete BEFORE DELETE ON webinar_persistence_bindings
  FOR EACH ROW EXECUTE FUNCTION webinar_persistence_immutable();
CREATE TRIGGER webinar_binding_no_truncate BEFORE TRUNCATE ON webinar_persistence_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION webinar_persistence_immutable();

-- Validate final transaction state: append inserts the record/audit before advancing
-- the binding. Direct SQL must satisfy the same typed graph and revision invariants.
CREATE FUNCTION webinar_persistence_validate_graph() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  binding webinar_persistence_bindings%ROWTYPE;
  parent webinar_persistence_records%ROWTYPE;
  release webinar_persistence_records%ROWTYPE;
  record_count integer;
  max_revision integer;
BEGIN
  SELECT * INTO binding FROM webinar_persistence_bindings
    WHERE session_id=NEW.session_id AND campaign_id=NEW.campaign_id FOR UPDATE;
  SELECT count(*), COALESCE(max(revision),0) INTO record_count,max_revision
    FROM webinar_persistence_records WHERE session_id=NEW.session_id;
  IF binding.session_id IS NULL OR record_count <> binding.revision OR max_revision <> binding.revision THEN
    RAISE EXCEPTION 'Webinar binding revision must match contiguous immutable history';
  END IF;
  IF TG_TABLE_NAME = 'webinar_persistence_bindings' THEN RETURN NEW; END IF;
  IF NEW.standard_id IS DISTINCT FROM binding.standard_id OR NEW.standard_version IS DISTINCT FROM binding.standard_version THEN
    RAISE EXCEPTION 'Webinar record standard must match exact occurrence binding';
  END IF;
  IF NEW.kind IN ('release','readiness','completion') AND NEW.standard_id IS NULL THEN
    RAISE EXCEPTION 'Release and snapshots require exact standard binding';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM webinar_persistence_records
      WHERE id=NEW.parent_id AND session_id=NEW.session_id AND campaign_id=NEW.campaign_id;
    IF parent.id IS NULL OR parent.revision >= NEW.revision OR NOT (
      (NEW.kind='evidence' AND parent.kind='source') OR
      (NEW.kind='exception-request' AND parent.kind='evidence') OR
      (NEW.kind='exception-disposition' AND parent.kind='exception-request') OR
      (NEW.kind='legal-hold' AND parent.kind IN ('plan','source','evidence','exception-request','exception-disposition','readiness','completion','release'))
    ) THEN RAISE EXCEPTION 'Invalid webinar parent kind or revision ordering'; END IF;
    IF NEW.kind='exception-disposition' AND NEW.actor_id=parent.actor_id THEN
      RAISE EXCEPTION 'Webinar exception disposition requires an independent actor';
    END IF;
  ELSIF NEW.kind IN ('evidence','exception-request','exception-disposition','legal-hold') THEN
    RAISE EXCEPTION 'Webinar record requires typed parent';
  END IF;
  IF NEW.release_id IS NOT NULL THEN
    SELECT * INTO release FROM webinar_persistence_records
      WHERE id=NEW.release_id AND session_id=NEW.session_id AND campaign_id=NEW.campaign_id;
    IF NEW.kind NOT IN ('readiness','completion') OR release.id IS NULL OR release.kind <> 'release'
      OR release.revision >= NEW.revision
      OR release.standard_id IS DISTINCT FROM NEW.standard_id
      OR release.standard_version IS DISTINCT FROM NEW.standard_version
      OR release.calculation_at IS DISTINCT FROM NEW.calculation_at THEN
      RAISE EXCEPTION 'Snapshot requires prior release with exact standard and calculation instant';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER webinar_records_validate_graph
  AFTER INSERT ON webinar_persistence_records DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION webinar_persistence_validate_graph();
CREATE CONSTRAINT TRIGGER webinar_binding_validate_graph
  AFTER INSERT OR UPDATE ON webinar_persistence_bindings DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION webinar_persistence_validate_graph();