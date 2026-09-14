import pg from "pg";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed webinar planning with NODE_ENV=production");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before seeding webinar planning");
}

// This is intentionally narrower than a generic "all webinar activity"
// backfill.  It is the fixture created by seed-delivery.mjs, and the exact
// session name prevents free-text webinar communications from acquiring an
// inferred schedule.
const DEMO_SESSION_NAME = "EMEA Index Outlook Webinar";
const COMMUNICATION_PLANS = [
  { name: "invitation", timing: "-14 days", offsetDays: 14, direction: "before" },
  { name: "reminder", timing: "-7 days", offsetDays: 7, direction: "before" },
  { name: "reminder", timing: "-2 days", offsetDays: 2, direction: "before" },
  { name: "day-of", timing: "0 (day of)", offsetDays: 0, direction: "before" },
  { name: "attendee", timing: "+1 day", offsetDays: 1, direction: "after" },
  { name: "no-show recording", timing: "+1 day", offsetDays: 1, direction: "after" },
];
const CORRECTION_REASON = "seed webinar planning correction: relative timing/session timezone";

function assertTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid webinar session timezone: ${timezone}`);
  }
}

function localParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function timezoneOffsetMinutes(date, timezone) {
  const parts = localParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function fromLocalParts(parts, timezone) {
  const naiveUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
  );
  const firstGuess = new Date(naiveUtc - timezoneOffsetMinutes(new Date(naiveUtc), timezone) * 60000);
  return new Date(naiveUtc - timezoneOffsetMinutes(firstGuess, timezone) * 60000);
}

function dateParts(date) {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function addCalendarDays(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + amount);
  return dateParts(date);
}

function isWeekend(parts) {
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day === 0 || day === 6;
}

function shiftBusinessDays(start, amount, strategy) {
  const calendarResult = addCalendarDays(start, amount);
  if (strategy === "calendar") return calendarResult;
  if (strategy === "next_business_day") {
    let result = calendarResult;
    while (isWeekend(result)) result = addCalendarDays(result, 1);
    return result;
  }
  if (strategy === "previous_business_day") {
    let result = calendarResult;
    while (isWeekend(result)) result = addCalendarDays(result, -1);
    return result;
  }
  if (amount === 0) return calendarResult;
  const step = amount < 0 ? -1 : 1;
  let remaining = Math.abs(amount);
  let result = start;
  while (remaining > 0) {
    result = addCalendarDays(result, step);
    if (!isWeekend(result)) remaining -= 1;
  }
  return result;
}

function sessionAnchor(session) {
  const dateText = session.session_date instanceof Date
    ? `${session.session_date.getFullYear()}-${String(session.session_date.getMonth() + 1).padStart(2, "0")}-${String(session.session_date.getDate()).padStart(2, "0")}`
    : String(session.session_date).slice(0, 10);
  const [year, month, day] = dateText.split("-").map(Number);
  const [hour, minute, second = 0] = String(session.start_time).split(":").map(Number);
  assertTimezone(session.timezone);
  return fromLocalParts({ year, month, day, hour, minute, second }, session.timezone);
}

function calculateSeededSendAt(anchorAt, plan, timezone) {
  const localAnchor = localParts(anchorAt, timezone);
  const direction = plan.direction === "before" ? -1 : 1;
  const strategy = plan.direction === "before" ? "previous_business_day" : "next_business_day";
  const shiftedDate = shiftBusinessDays(
    { year: localAnchor.year, month: localAnchor.month, day: localAnchor.day },
    direction * plan.offsetDays,
    strategy,
  );
  const minuteDate = new Date(Date.UTC(shiftedDate.year, shiftedDate.month - 1, shiftedDate.day, 9, 0, 0));
  const shiftedParts = dateParts(minuteDate);
  return fromLocalParts({
    ...shiftedParts,
    hour: minuteDate.getUTCHours(),
    minute: minuteDate.getUTCMinutes(),
    second: 0,
  }, timezone);
}

function isUntouchedAutoGeneratedDefaultRule(rule) {
  const createdAt = new Date(rule.created_at).getTime();
  const updatedAt = new Date(rule.updated_at).getTime();
  const targetSendTime = String(rule.target_send_time ?? "");
  return (
    Number(rule.row_version) === 1 &&
    Number.isFinite(createdAt) &&
    createdAt === updatedAt &&
    Number(rule.offset_days) === 1 &&
    Number(rule.offset_minutes) === 0 &&
    rule.direction === "before" &&
    rule.business_day_strategy === "previous_business_day" &&
    rule.audience_local_timezone === true &&
    rule.timezone === "UTC" &&
    (targetSendTime === "09:00" || targetSendTime === "09:00:00") &&
    rule.enabled === true
  );
}

async function seedWebinarPlanning(client) {
  const sessionResult = await client.query(
    `SELECT s.id, s.campaign_id, s.activity_id, s.session_date, s.start_time, s.timezone
       FROM webinar_sessions s
       JOIN campaigns c ON c.id = s.campaign_id
       JOIN activities a ON a.id = s.activity_id AND a.campaign_id = s.campaign_id
      WHERE s.name = $1
        AND c.region = 'EMEA'
        AND lower(a.type) = 'webinar'
      ORDER BY s.created_at, s.id`,
    [DEMO_SESSION_NAME],
  );
  if (sessionResult.rows.length === 0) {
    throw new Error(`No seeded ${DEMO_SESSION_NAME} session exists; run seed:webinar first`);
  }
  if (sessionResult.rows.length > 1) {
    throw new Error(`Expected one seeded ${DEMO_SESSION_NAME} session, found ${sessionResult.rows.length}`);
  }

  const session = sessionResult.rows[0];
  const anchorAt = sessionAnchor(session);
  const expectedCommunicationIds = [];

  for (const plan of COMMUNICATION_PLANS) {
    const communicationResult = await client.query(
      `SELECT id
         FROM communications
        WHERE campaign_id = $1
          AND activity_id = $2
          AND name = $3
          AND timing = $4
        ORDER BY sort_order, created_at, id`,
      [session.campaign_id, session.activity_id, plan.name, plan.timing],
    );
    if (communicationResult.rows.length !== 1) {
      throw new Error(
        `Expected exactly one seeded communication ${plan.name} (${plan.timing}), found ${communicationResult.rows.length}`,
      );
    }
    expectedCommunicationIds.push({ ...plan, communicationId: communicationResult.rows[0].id });
  }

  for (const plan of expectedCommunicationIds) {
    const ruleResult = await client.query(
      `SELECT *
         FROM schedule_rules
        WHERE campaign_id = $1
          AND communication_id = $2
        ORDER BY created_at, id`,
      [session.campaign_id, plan.communicationId],
    );
    if (ruleResult.rows.length > 1) {
      throw new Error(`Multiple schedule rules exist for seeded communication ${plan.name} (${plan.timing}); refusing to choose one`);
    }

    const calculatedAt = calculateSeededSendAt(anchorAt, plan, session.timezone);
    let rule;
    let corrected = false;
    if (ruleResult.rows.length === 0) {
      const inserted = await client.query(
        `INSERT INTO schedule_rules
          (campaign_id, activity_id, communication_id, anchor_activity_id,
           offset_days, offset_minutes, direction, business_day_strategy,
           audience_local_timezone, timezone, target_send_time, enabled)
         VALUES ($1, $2, $3, $2, $4, 0, $5, $6, true, $7, '09:00', true)
         RETURNING *`,
        [
          session.campaign_id,
          session.activity_id,
          plan.communicationId,
          plan.offsetDays,
          plan.direction,
          plan.direction === "before" ? "previous_business_day" : "next_business_day",
          session.timezone,
        ],
      );
      rule = inserted.rows[0];
    } else {
      rule = ruleResult.rows[0];
      if (!isUntouchedAutoGeneratedDefaultRule(rule)) {
        console.log(`Skipping edited/non-default schedule rule ${rule.id} for ${plan.name} (${plan.timing})`);
        continue;
      }
      const correctedRule = await client.query(
        `UPDATE schedule_rules
            SET activity_id = $2,
                anchor_activity_id = $2,
                offset_days = $3,
                offset_minutes = 0,
                direction = $4,
                business_day_strategy = $5,
                audience_local_timezone = true,
                timezone = $6,
                target_send_time = '09:00',
                enabled = true,
                row_version = row_version + 1,
                updated_at = now()
          WHERE id = $1
            AND row_version = 1
            AND updated_at = created_at
          RETURNING *`,
        [
          rule.id,
          session.activity_id,
          plan.offsetDays,
          plan.direction,
          plan.direction === "before" ? "previous_business_day" : "next_business_day",
          session.timezone,
        ],
      );
      if (correctedRule.rows.length !== 1) {
        throw new Error(`Schedule rule ${rule.id} changed while repairing; rerun after reviewing the rule`);
      }
      rule = correctedRule.rows[0];
      corrected = true;
    }

    const instanceResult = await client.query(
      `SELECT *
         FROM scheduled_instances
        WHERE rule_id = $1
        FOR UPDATE`,
      [rule.id],
    );
    if (instanceResult.rows.length > 1) {
      throw new Error(`Multiple scheduled instances exist for seeded rule ${rule.id}`);
    }
    if (instanceResult.rows.length === 0) {
      await client.query(
        `INSERT INTO scheduled_instances
          (campaign_id, rule_id, activity_id, communication_id,
           original_calculated_at, calculated_at, timezone, status)
         VALUES ($1, $2, $3, $4, $5, $5, $6, 'scheduled')`,
        [
          session.campaign_id,
          rule.id,
          session.activity_id,
          plan.communicationId,
          calculatedAt,
          session.timezone,
        ],
      );
      console.log(`Created ${plan.name} (${plan.timing}) at ${calculatedAt.toISOString()}`);
      continue;
    }

    if (!corrected) {
      // The rule was already edited/corrected, so its instance is left alone.
      continue;
    }

    const instance = instanceResult.rows[0];
    const previousEffectiveAt = instance.adjusted_at ?? instance.calculated_at;
    await client.query(
      `INSERT INTO scheduled_instance_history
        (campaign_id, scheduled_instance_id, rule_id, anchor_at,
         previous_calculated_at, calculated_at, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        session.campaign_id,
        instance.id,
        rule.id,
        anchorAt,
        previousEffectiveAt,
        calculatedAt,
        CORRECTION_REASON,
      ],
    );
    const updatedInstance = await client.query(
      `UPDATE scheduled_instances
          SET calculated_at = $2,
              timezone = $3,
              row_version = row_version + 1,
              updated_at = now()
        WHERE id = $1
          AND row_version = $4
        RETURNING id`,
      [instance.id, calculatedAt, session.timezone, instance.row_version],
    );
    if (updatedInstance.rows.length !== 1) {
      throw new Error(`Scheduled instance ${instance.id} changed while repairing; rerun after reviewing the instance`);
    }
    console.log(`Corrected ${plan.name} (${plan.timing}) at ${calculatedAt.toISOString()} with history`);
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await seedWebinarPlanning(client);
    await client.query("COMMIT");
    console.log("Seeded webinar planning repair completed");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}