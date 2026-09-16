import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before reconciling webinar standard");
}

const legacyDefinitions = [
  ["registration_confirmation", 0, "instant", 0, "after", "calendar", "none"],
  ["recruitment_1", 1, "days", 21, "before", "previous_business_day", "previous_friday"],
  ["recruitment_2", 2, "days", 14, "before", "previous_business_day", "previous_friday"],
  ["recruitment_3", 3, "days", 7, "before", "previous_business_day", "previous_friday"],
  ["final_recruitment", 4, "days", 1, "before", "previous_business_day", "previous_friday"],
  ["registered_reminder", 5, "hours", 24, "before", "calendar", "none"],
  ["final_reminder", 6, "hours", 1, "before", "calendar", "none"],
  ["attendee_followup", 7, "days", 1, "after", "next_business_day", "next_monday"],
  ["no_show_followup", 8, "days", 1, "after", "next_business_day", "next_monday"],
];
const defaultFiveDefinitions = [
  ["recruitment_1", 0, "days", 14, "before", "previous_business_day", "previous_friday"],
  ["recruitment_2", 1, "days", 7, "before", "previous_business_day", "previous_friday"],
  ["registered_reminder", 2, "hours", 24, "before", "calendar", "none"],
  ["final_reminder", 3, "hours", 1, "before", "calendar", "none"],
  ["attendee_followup", 4, "days", 1, "after", "next_business_day", "next_monday"],
];

function definitionsFor(templateVersion) {
  if (templateVersion === "legacy_9") return legacyDefinitions;
  if (templateVersion === "default_5") return defaultFiveDefinitions;
  throw new Error(`Unknown webinar template version ${templateVersion}`);
}

function assertTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid webinar timezone ${timezone}`);
  }
}
function localParts(date, timezone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return values;
}
function offsetMinutes(date, timezone) {
  const p = localParts(date, timezone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()) / 60000);
}
function fromLocal(p, timezone) {
  const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second ?? 0);
  const first = new Date(naive - offsetMinutes(new Date(naive), timezone) * 60000);
  return new Date(naive - offsetMinutes(first, timezone) * 60000);
}
function addDays(p, amount) {
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  date.setUTCDate(date.getUTCDate() + amount);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
function isWeekend(p) {
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return day === 0 || day === 6;
}
function adjustedDate(p, direction) {
  let result = p;
  while (isWeekend(result)) result = addDays(result, direction === "before" ? -1 : 1);
  return result;
}
function sessionAnchor(session) {
  const date = session.session_date.toISOString?.().slice(0, 10) ?? String(session.session_date).slice(0, 10);
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = String(session.start_time).split(":").map(Number);
  return fromLocal({ year, month, day, hour, minute, second }, session.timezone);
}
function calculatedAt(session, definition) {
  const [, , unit, offset, direction] = definition;
  const anchor = sessionAnchor(session);
  if (unit === "instant") return new Date(session.created_at);
  if (unit === "hours") return new Date(anchor.getTime() + (direction === "before" ? -1 : 1) * offset * 60 * 60 * 1000);
  const local = localParts(anchor, session.timezone);
  const base = { year: local.year, month: local.month, day: local.day };
  const target = adjustedDate(addDays(base, direction === "before" ? -offset : offset), direction);
  return fromLocal({ ...target, hour: local.hour, minute: local.minute, second: local.second }, session.timezone);
}

async function reconcile(client) {
  const sessions = await client.query(`
    SELECT id, campaign_id, activity_id, session_date, start_time, timezone,
           template_version,
           recruitment_launch_at, created_at
      FROM webinar_sessions
     ORDER BY created_at, id
  `);
  for (const session of sessions.rows) {
    const definitions = definitionsFor(session.template_version);
    await client.query(`
      INSERT INTO webinar_standard_configs (campaign_id, session_id)
      VALUES ($1, $2)
      ON CONFLICT (session_id) DO NOTHING
    `, [session.campaign_id, session.id]);
    for (const definition of definitions) {
      const [key, sortOrder, unit, offset, direction, strategy, weekend] = definition;
      const existing = await client.query(`
        SELECT * FROM webinar_standard_communications
         WHERE session_id = $1 AND key = $2
      `, [session.id, key]);
      if (existing.rows.length !== 1) throw new Error(`Expected one standard row for ${session.id}/${key}`);
      const row = existing.rows[0];
      let communicationId = row.communication_id;
      if (!communicationId && row.legacy_communication_id) {
        const legacy = await client.query(`
          SELECT id FROM communications WHERE id = $1 AND campaign_id = $2
        `, [row.legacy_communication_id, session.campaign_id]);
        communicationId = legacy.rows[0]?.id ?? null;
      }
      if (!communicationId) {
        const insertedCommunication = await client.query(`
          INSERT INTO communications
            (campaign_id, activity_id, name, type, timing, sort_order, status, owner)
          VALUES ($1, $2, $3, 'Email', $4, $5, 'Estimated', 'Campaign team')
          RETURNING id
        `, [
          session.campaign_id,
          session.activity_id,
          key.replaceAll("_", " "),
          unit === "instant" ? "Immediate trigger" : `${direction === "before" ? "-" : "+"}${offset} ${unit}`,
          sortOrder,
        ]);
        communicationId = insertedCommunication.rows[0].id;
      }
      const audience = await client.query(`
        SELECT id FROM audiences WHERE campaign_id = $1 ORDER BY created_at, id LIMIT 1
      `, [session.campaign_id]);
      let audienceId = audience.rows[0]?.id;
      if (!audienceId) {
        const createdAudience = await client.query(`
          INSERT INTO audiences (campaign_id, name, region)
          SELECT id, audience, region FROM campaigns WHERE id = $1
          RETURNING id
        `, [session.campaign_id]);
        audienceId = createdAudience.rows[0]?.id;
      }
      if (!audienceId) throw new Error(`Unable to initialize audience for ${session.campaign_id}`);
      await client.query(`
        INSERT INTO communication_details
          (communication_id, campaign_id, audience_branch_id, communication_type, channel)
        VALUES ($1, $2, $3, 'Email', 'email')
        ON CONFLICT (communication_id) DO NOTHING
      `, [communicationId, session.campaign_id, audienceId]);
      await client.query(`
        UPDATE webinar_standard_communications SET communication_id = $1 WHERE id = $2
      `, [communicationId, row.id]);
      let rule = row.schedule_rule_id
        ? (await client.query(`SELECT * FROM schedule_rules WHERE id = $1 FOR UPDATE`, [row.schedule_rule_id])).rows[0]
        : null;
      if (!rule) {
        rule = (await client.query(`
          INSERT INTO schedule_rules
            (campaign_id, activity_id, communication_id, anchor_activity_id,
             offset_days, offset_minutes, direction, business_day_strategy,
             audience_local_timezone, timezone, target_send_time, enabled)
          VALUES ($1, $2, $3, $2, $4, $5, $6, $7, true, $8, NULL, $9)
          RETURNING *
        `, [
          session.campaign_id, session.activity_id, communicationId,
          unit === "days" ? offset : 0,
          unit === "hours" ? offset * 60 : 0,
          direction === "trigger" ? "after" : direction,
          strategy,
          session.timezone,
          unit !== "instant",
        ])).rows[0];
        await client.query(`UPDATE webinar_standard_communications SET schedule_rule_id = $1 WHERE id = $2`, [rule.id, row.id]);
      }
      const calculated = calculatedAt(session, definition);
      const launch = session.recruitment_launch_at ? new Date(session.recruitment_launch_at) : null;
      const skipped = unit === "days" && direction === "before" && launch && calculated < launch;
      const status = unit === "instant" ? "awaiting_registration" : skipped ? "skipped" : "scheduled";
      const skipReason = skipped ? `Adjusted recruitment date ${calculated.toISOString()} is before webinar campaign launch ${launch.toISOString()}` : null;
      const instanceResult = await client.query(`SELECT * FROM scheduled_instances WHERE rule_id = $1 FOR UPDATE`, [rule.id]);
      let instance = instanceResult.rows[0];
      if (!instance) {
        instance = (await client.query(`
          INSERT INTO scheduled_instances
            (campaign_id, rule_id, activity_id, communication_id,
             original_calculated_at, calculated_at, timezone, status)
          VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
          RETURNING *
        `, [session.campaign_id, rule.id, session.activity_id, communicationId, calculated, session.timezone, status])).rows[0];
      } else if (new Date(instance.calculated_at).getTime() !== calculated.getTime() || instance.status !== status) {
        const previousEffective = instance.adjusted_at ?? instance.calculated_at;
        await client.query(`
          INSERT INTO scheduled_instance_history
            (campaign_id, scheduled_instance_id, rule_id, anchor_at,
             previous_calculated_at, calculated_at, reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [session.campaign_id, instance.id, rule.id, sessionAnchor(session), previousEffective, calculated, "webinar standard reconciliation"]);
        instance = (await client.query(`
          UPDATE scheduled_instances
             SET calculated_at = $2, adjusted_at = NULL, adjustment_reason = NULL,
                 timezone = $3, status = $4, row_version = row_version + 1, updated_at = now()
           WHERE id = $1
           RETURNING *
        `, [instance.id, calculated, session.timezone, status])).rows[0];
      }
      await client.query(`
        UPDATE webinar_standard_communications
           SET original_scheduled_at = COALESCE(original_scheduled_at, $2),
               current_scheduled_at = $2,
               effective_scheduled_at = $2,
               schedule_status = $3,
               skip_reason = $4,
               updated_at = now()
         WHERE id = $1
      `, [row.id, instance.calculated_at, status, skipReason]);
    }
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('webinar-standard-reconcile'))");
    await reconcile(client);
    await client.query("COMMIT");
    console.log("Webinar standard reconciliation completed idempotently");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}