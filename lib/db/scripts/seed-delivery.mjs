import pg from "pg";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed the development database with NODE_ENV=production");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before seeding delivery data");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const communications = [
  { name: "invitation", type: "Email", timing: "-14 days", sortOrder: 10, owner: "EMEA marketing", status: "Confirmed" },
  { name: "reminder", type: "Email", timing: "-7 days", sortOrder: 20, owner: "Marketing operations", status: "Known" },
  { name: "reminder", type: "Email", timing: "-2 days", sortOrder: 30, owner: "Marketing operations", status: "Estimated" },
  { name: "day-of", type: "Email", timing: "0 (day of)", sortOrder: 40, owner: "Webinar team", status: "Confirmed" },
  { name: "attendee", type: "Email", timing: "+1 day", sortOrder: 50, owner: "Sales enablement", status: "Decision needed" },
  { name: "no-show recording", type: "Video", timing: "+1 day", sortOrder: 60, owner: "Content team", status: "Not applicable" },
];
const tasks = [
  { name: "Webinar invitation asset", type: "Asset", timing: "-14 days", sortOrder: 10, owner: "Creative services", status: "Confirmed" },
  { name: "Webinar registration page", type: "Landing page", timing: "-14 days", sortOrder: 20, owner: "Web team", status: "Estimated" },
  { name: "Speaker approval", type: "Approval", timing: "-7 days", sortOrder: 30, owner: "Webinar team", status: "Decision needed" },
  { name: "Campaign tracking", type: "Tracking", timing: "-7 days", sortOrder: 40, owner: "Marketing operations", status: "Known" },
];
const speakers = [
  { name: "Jordan Blake", role: "Index strategist", organization: "Index Research" },
  { name: "Priya Shah", role: "Portfolio specialist", organization: "Index Research" },
];

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const activityResult = await client.query(
      `SELECT a.id, a.campaign_id
       FROM activities a
       INNER JOIN campaigns c ON c.id = a.campaign_id
       WHERE c.region = $1 AND lower(a.type) = lower($2)
       ORDER BY a.created_at, a.id
       LIMIT 1`,
      ["EMEA", "Webinar"],
    );
    const activity = activityResult.rows[0];
    if (!activity) {
      throw new Error("No EMEA Webinar activity exists; delivery seed was not applied");
    }

    const existingCommunicationsResult = await client.query(
      `SELECT id, name, timing, sort_order, type, status
       FROM communications
       WHERE campaign_id = $1 AND activity_id = $2
       ORDER BY sort_order, created_at, id`,
      [activity.campaign_id, activity.id],
    );
    const existingCommunications = existingCommunicationsResult.rows;
    const claimedCommunicationIds = new Set();
    const seededCommunications = [];
    for (const [index, item] of communications.entries()) {
      let communication = existingCommunications.find(
        (row) =>
          !claimedCommunicationIds.has(row.id) &&
          row.name === item.name &&
          row.timing === item.timing,
      );
      if (!communication) {
        communication = existingCommunications.find(
          (row) => !claimedCommunicationIds.has(row.id) && row.sort_order === item.sortOrder,
        );
      }
      if (!communication) {
        communication = existingCommunications.find((row) => !claimedCommunicationIds.has(row.id)) ??
          existingCommunications[index];
      }
      if (!communication) {
        const inserted = await client.query(
          `INSERT INTO communications
            (campaign_id, activity_id, name, type, timing, sort_order, status, owner)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, name, timing, sort_order, type, status`,
          [activity.campaign_id, activity.id, item.name, item.type, item.timing, item.sortOrder, item.status, item.owner],
        );
        communication = inserted.rows[0];
        existingCommunications.push(communication);
      }
      claimedCommunicationIds.add(communication.id);
      seededCommunications.push({ item, communication });
    }
    for (const item of tasks) {
      await client.query(
        `INSERT INTO activity_tasks
          (campaign_id, activity_id, name, type, timing, sort_order, status, owner)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8
         WHERE NOT EXISTS (
           SELECT 1 FROM activity_tasks
           WHERE campaign_id = $1 AND activity_id = $2 AND name = $3 AND type = $4
         )`,
        [activity.campaign_id, activity.id, item.name, item.type, item.timing, item.sortOrder, item.status, item.owner],
      );
    }

    const audienceResult = await client.query(
      `SELECT id FROM audiences WHERE campaign_id = $1 ORDER BY created_at, id LIMIT 1`,
      [activity.campaign_id],
    );
    let audienceBranchId = audienceResult.rows[0]?.id;
    if (!audienceBranchId) {
      const campaignResult = await client.query(
        `SELECT audience, region FROM campaigns WHERE id = $1`,
        [activity.campaign_id],
      );
      const campaign = campaignResult.rows[0];
      if (!campaign) throw new Error("Campaign for EMEA webinar activity no longer exists");
      const branchResult = await client.query(
        `INSERT INTO audiences (campaign_id, name, region)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [activity.campaign_id, campaign.audience, campaign.region],
      );
      audienceBranchId = branchResult.rows[0].id;
    }

    const taskResult = await client.query(
      `SELECT id, name FROM activity_tasks WHERE campaign_id = $1 AND activity_id = $2`,
      [activity.campaign_id, activity.id],
    );
    const taskIds = Object.fromEntries(taskResult.rows.map((row) => [row.name, row.id]));
    for (const { item, communication } of seededCommunications) {
      if (!communication) continue;
      const dependencyNames =
        item.name === "invitation"
          ? ["Webinar registration page"]
          : item.name === "day-of"
            ? ["Speaker approval"]
            : item.name === "attendee" || item.name === "no-show recording"
              ? ["Campaign tracking"]
              : [];
      const dependencyIds = dependencyNames.map((name) => taskIds[name]).filter(Boolean);
      await client.query(
        `INSERT INTO communication_details
          (communication_id, campaign_id, audience_branch_id, communication_type, channel, approval_status,
           qa_audience_confirmed, qa_content_approved, qa_links_verified, qa_timing_verified,
           qa_owner_confirmed, blocking_dependency_task_ids)
         SELECT $1, $6, $2, $3, $4, $5, false, false, false, false, false, $7::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM communication_details WHERE communication_id = $1
         )`,
        [
          communication.id,
          audienceBranchId,
          communication.type,
          communication.type.toLowerCase(),
          communication.status === "Confirmed"
            ? "Approved"
            : communication.status === "Decision needed"
              ? "Needs review"
              : "Not started",
          activity.campaign_id,
           JSON.stringify(dependencyIds),
        ],
      );
      await client.query(
        `UPDATE communication_details
         SET blocking_dependency_task_ids = $2::jsonb, updated_at = now()
         WHERE communication_id = $1
           AND blocking_dependency_task_ids = '[]'::jsonb
           AND updated_at = created_at`,
        [communication.id, JSON.stringify(dependencyIds)],
      );
    }

    const sessionResult = await client.query(
      `INSERT INTO webinar_sessions
        (campaign_id, activity_id, name, session_date, start_time, duration_minutes, timezone, platform, speakers, registration_rule)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
       ON CONFLICT (campaign_id, activity_id, name) DO NOTHING
       RETURNING id`,
      [
        activity.campaign_id,
        activity.id,
        "EMEA Index Outlook Webinar",
        "2026-11-18",
        "14:00",
        60,
        "Europe/London",
        "Zoom Webinar",
        JSON.stringify(speakers),
        JSON.stringify({
          suppressRecruitmentAfterRegistration: true,
          registeredBranch: "registered",
          attendedBranch: "attended",
          noShowBranch: "no_show",
        }),
      ],
    );
    const session =
      sessionResult.rows[0] ??
      (
        await client.query(
          `SELECT id FROM webinar_sessions
           WHERE campaign_id = $1 AND activity_id = $2 AND name = $3`,
          [activity.campaign_id, activity.id, "EMEA Index Outlook Webinar"],
        )
      ).rows[0];
    if (!session) throw new Error("Unable to create or find the seeded EMEA webinar session");

    const people = [
      { name: "Avery Morgan", registration: "registered", attendance: "attended" },
      { name: "Blair Chen", registration: "registered", attendance: "no_show" },
      { name: "Cameron Ellis", registration: null, attendance: null },
    ];
    for (const person of people) {
      const personResult = await client.query(
        `INSERT INTO webinar_people (campaign_id, audience_branch_id, name, is_synthetic)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (campaign_id, name) DO NOTHING
         RETURNING id`,
        [activity.campaign_id, audienceBranchId, person.name],
      );
      const personRow =
        personResult.rows[0] ??
        (
          await client.query(
            `SELECT id FROM webinar_people WHERE campaign_id = $1 AND name = $2`,
            [activity.campaign_id, person.name],
          )
        ).rows[0];
      if (!personRow) throw new Error(`Unable to create or find synthetic person ${person.name}`);
      if (person.registration) {
        await client.query(
          `INSERT INTO webinar_registration_results
            (campaign_id, session_id, person_id, result)
           SELECT $1, $2, $3, $4
           WHERE NOT EXISTS (
             SELECT 1 FROM webinar_registration_results
             WHERE session_id = $2 AND person_id = $3
           )`,
          [activity.campaign_id, session.id, personRow.id, person.registration],
        );
      }
      if (person.attendance) {
        await client.query(
          `INSERT INTO webinar_attendance_results
            (campaign_id, session_id, person_id, result)
           SELECT $1, $2, $3, $4
           WHERE NOT EXISTS (
             SELECT 1 FROM webinar_attendance_results
             WHERE session_id = $2 AND person_id = $3
           )`,
          [activity.campaign_id, session.id, personRow.id, person.attendance],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}