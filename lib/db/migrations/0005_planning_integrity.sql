-- Planning integrity is additive and deliberately fail-closed.  Existing
-- rows are validated before constraints are installed; this migration never
-- deletes or rewrites an orphan into a different campaign.

ALTER TABLE scheduled_instance_history
  ADD COLUMN IF NOT EXISTS campaign_id uuid;

UPDATE scheduled_instance_history h
SET campaign_id = i.campaign_id
FROM scheduled_instances i
WHERE h.campaign_id IS NULL
  AND h.scheduled_instance_id = i.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM schedule_rules r
    LEFT JOIN campaigns c ON c.id = r.campaign_id
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: schedule_rules contains an unknown campaign_id';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM schedule_rules r
    LEFT JOIN activities a ON a.id = r.activity_id AND a.campaign_id = r.campaign_id
    WHERE r.activity_id IS NOT NULL AND a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: schedule_rules contains an activity from another campaign';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM schedule_rules r
    LEFT JOIN activities a ON a.id = r.anchor_activity_id AND a.campaign_id = r.campaign_id
    WHERE r.anchor_activity_id IS NOT NULL AND a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: schedule_rules contains an anchor activity from another campaign';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM schedule_rules r
    LEFT JOIN communications c ON c.id = r.communication_id AND c.campaign_id = r.campaign_id
    WHERE r.communication_id IS NOT NULL AND c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: schedule_rules contains a communication from another campaign';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM scheduled_instances i
    LEFT JOIN campaigns c ON c.id = i.campaign_id
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: scheduled_instances contains an unknown campaign_id';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM scheduled_instances i
    LEFT JOIN schedule_rules r ON r.id = i.rule_id AND r.campaign_id = i.campaign_id
    WHERE r.id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: scheduled_instances contains a rule from another campaign';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM scheduled_instances i
    LEFT JOIN activities a ON a.id = i.activity_id AND a.campaign_id = i.campaign_id
    WHERE i.activity_id IS NOT NULL AND a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: scheduled_instances contains an activity from another campaign';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM scheduled_instances i
    LEFT JOIN communications c ON c.id = i.communication_id AND c.campaign_id = i.campaign_id
    WHERE i.communication_id IS NOT NULL AND c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: scheduled_instances contains a communication from another campaign';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM scheduled_instance_history h
    WHERE h.campaign_id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: scheduled_instance_history contains an unknown instance';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM scheduled_instance_history h
    LEFT JOIN scheduled_instances i
      ON i.id = h.scheduled_instance_id AND i.campaign_id = h.campaign_id
    WHERE i.id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: scheduled_instance_history contains an instance from another campaign';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM scheduled_instance_history h
    LEFT JOIN schedule_rules r
      ON r.id = h.rule_id AND r.campaign_id = h.campaign_id
    WHERE r.id IS NULL
  ) THEN
    RAISE EXCEPTION 'planning integrity: scheduled_instance_history contains a rule from another campaign';
  END IF;
END $$;

ALTER TABLE scheduled_instance_history
  ALTER COLUMN campaign_id SET NOT NULL;

-- PostgreSQL requires a unique key for each composite campaign-scoped
-- reference even though every referenced table already has a UUID primary key.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_id_campaign_unique') THEN
    ALTER TABLE activities ADD CONSTRAINT activities_id_campaign_unique UNIQUE (id, campaign_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_id_campaign_unique') THEN
    ALTER TABLE communications ADD CONSTRAINT communications_id_campaign_unique UNIQUE (id, campaign_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_rules_id_campaign_unique') THEN
    ALTER TABLE schedule_rules ADD CONSTRAINT schedule_rules_id_campaign_unique UNIQUE (id, campaign_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_instances_id_campaign_unique') THEN
    ALTER TABLE scheduled_instances ADD CONSTRAINT scheduled_instances_id_campaign_unique UNIQUE (id, campaign_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_rules_campaign_fk') THEN
    ALTER TABLE schedule_rules
      ADD CONSTRAINT schedule_rules_campaign_fk
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_rules_activity_campaign_fk') THEN
    ALTER TABLE schedule_rules
      ADD CONSTRAINT schedule_rules_activity_campaign_fk
      FOREIGN KEY (activity_id, campaign_id) REFERENCES activities(id, campaign_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_rules_anchor_activity_campaign_fk') THEN
    ALTER TABLE schedule_rules
      ADD CONSTRAINT schedule_rules_anchor_activity_campaign_fk
      FOREIGN KEY (anchor_activity_id, campaign_id) REFERENCES activities(id, campaign_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_rules_communication_campaign_fk') THEN
    ALTER TABLE schedule_rules
      ADD CONSTRAINT schedule_rules_communication_campaign_fk
      FOREIGN KEY (communication_id, campaign_id) REFERENCES communications(id, campaign_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_instances_campaign_fk') THEN
    ALTER TABLE scheduled_instances
      ADD CONSTRAINT scheduled_instances_campaign_fk
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_instances_rule_campaign_fk') THEN
    ALTER TABLE scheduled_instances
      ADD CONSTRAINT scheduled_instances_rule_campaign_fk
      FOREIGN KEY (rule_id, campaign_id) REFERENCES schedule_rules(id, campaign_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_instances_activity_campaign_fk') THEN
    ALTER TABLE scheduled_instances
      ADD CONSTRAINT scheduled_instances_activity_campaign_fk
      FOREIGN KEY (activity_id, campaign_id) REFERENCES activities(id, campaign_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_instances_communication_campaign_fk') THEN
    ALTER TABLE scheduled_instances
      ADD CONSTRAINT scheduled_instances_communication_campaign_fk
      FOREIGN KEY (communication_id, campaign_id) REFERENCES communications(id, campaign_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_instance_history_campaign_fk') THEN
    ALTER TABLE scheduled_instance_history
      ADD CONSTRAINT scheduled_instance_history_campaign_fk
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_instance_history_instance_campaign_fk') THEN
    ALTER TABLE scheduled_instance_history
      ADD CONSTRAINT scheduled_instance_history_instance_campaign_fk
      FOREIGN KEY (scheduled_instance_id, campaign_id)
      REFERENCES scheduled_instances(id, campaign_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_instance_history_rule_campaign_fk') THEN
    ALTER TABLE scheduled_instance_history
      ADD CONSTRAINT scheduled_instance_history_rule_campaign_fk
      FOREIGN KEY (rule_id, campaign_id)
      REFERENCES schedule_rules(id, campaign_id);
  END IF;
END $$;