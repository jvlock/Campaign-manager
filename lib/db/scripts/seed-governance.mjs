import pg from "pg";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed the development database with NODE_ENV=production");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before seeding governance data");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const actor = "system:seed";
const reason = "Additive development taxonomy seed";
const version = "2026.1";
const seedTerms = [
  { category: "channel", label: "Email", shortcode: "EMAIL" },
  { category: "channel", label: "Webinar", shortcode: "WEBINAR" },
  { category: "region", label: "EMEA", shortcode: "EMEA" },
];

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let versionResult = await client.query(
      "SELECT id FROM taxonomy_versions WHERE version = $1 LIMIT 1",
      [version],
    );
    if (versionResult.rowCount === 0) {
      versionResult = await client.query(
        `INSERT INTO taxonomy_versions (version, effective_at)
         VALUES ($1, now())
         RETURNING id`,
        [version],
      );
    }
    const versionId = versionResult.rows[0].id;
    for (const item of seedTerms) {
      const existing = await client.query(
        `SELECT id FROM taxonomy_terms
         WHERE version_id = $1 AND shortcode = $2
         LIMIT 1`,
        [versionId, item.shortcode],
      );
      if (existing.rowCount > 0) continue;
      const inserted = await client.query(
        `INSERT INTO taxonomy_terms
          (version_id, category, label, shortcode, legacy_codes)
         VALUES ($1, $2, $3, $4, '[]'::jsonb)
         RETURNING id, version_id, category, label, shortcode, parent_id,
                   superseded_by, legacy_codes, is_deprecated`,
        [versionId, item.category, item.label, item.shortcode],
      );
      const term = inserted.rows[0];
      await client.query(
        `INSERT INTO governance_audit_events
          (entity_type, entity_id, action, actor, reason, before, after, metadata)
         VALUES ('taxonomyTerm', $1, 'seed', $2, $3, NULL, $4::jsonb, '{"actorProvenance":"declared"}'::jsonb)`,
        [term.id, actor, reason, JSON.stringify(term)],
      );
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