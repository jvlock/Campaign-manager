import pg from "pg";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed the development database with NODE_ENV=production");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before seeding governance data");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const actor = "system:seed";
const version = "2026.1";
const sourceLabel = "CliCS reference — December 2025";
const codeProvenance = "local_assigned";
const reason = `Seed ${sourceLabel}; taxonomy labels are source values and shortcodes are locally assigned`;
const legacyReason = "Additive development taxonomy seed";

const legacyTerms = [
  { category: "channel", label: "Email", shortcode: "EMAIL" },
  { category: "channel", label: "Webinar", shortcode: "WEBINAR" },
  { category: "region", label: "EMEA", shortcode: "EMEA" },
];

// The reference supplied labels, not shortcodes.  These stable local codes
// are intentionally namespaced by term group and are checked against both
// current and legacy codes before insertion.
const clicsTerms = [
  { category: "product_family", label: "Index", shortcode: "PF_INDEX" },
  { category: "product_family", label: "Analytics", shortcode: "PF_ANALYTICS" },
  {
    category: "product_family",
    label: "Sustainability and Climate",
    shortcode: "PF_SUSTAINABILITY_CLIMATE",
  },
  { category: "product_family", label: "Private Assets", shortcode: "PF_PRIVATE_ASSETS" },
  { category: "product_family", label: "Real Assets", shortcode: "PF_REAL_ASSETS" },
  { category: "region", label: "Global", shortcode: "REG_GLOBAL" },
  { category: "region", label: "Americas", shortcode: "REG_AMERICAS" },
  { category: "region", label: "EMEA", shortcode: "REG_EMEA" },
  { category: "region", label: "APAC", shortcode: "REG_APAC" },
  { category: "region", label: "United States", shortcode: "REG_UNITED_STATES" },
  { category: "region", label: "Canada", shortcode: "REG_CANADA" },
  { category: "region", label: "Latin America", shortcode: "REG_LATIN_AMERICA" },
  { category: "region", label: "United Kingdom", shortcode: "REG_UNITED_KINGDOM" },
  {
    category: "region",
    label: "Continental Europe",
    shortcode: "REG_CONTINENTAL_EUROPE",
  },
  { category: "region", label: "Middle East", shortcode: "REG_MIDDLE_EAST" },
  { category: "region", label: "Africa", shortcode: "REG_AFRICA" },
  { category: "region", label: "Japan", shortcode: "REG_JAPAN" },
  { category: "region", label: "Greater China", shortcode: "REG_GREATER_CHINA" },
  { category: "region", label: "Asia ex-Japan", shortcode: "REG_ASIA_EX_JAPAN" },
  {
    category: "region",
    label: "Australia and New Zealand",
    shortcode: "REG_AUSTRALIA_NEW_ZEALAND",
  },
];

function sourceMetadata() {
  return {
    sourceLabel,
    codeProvenance,
  };
}

function metadataObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function termSnapshot(row) {
  return {
    id: row.id,
    versionId: row.version_id,
    category: row.category,
    label: row.label,
    shortcode: row.shortcode,
    parentId: row.parent_id,
    supersededBy: row.superseded_by,
    legacyCodes: Array.isArray(row.legacy_codes) ? row.legacy_codes : [],
    sourceMetadata: metadataObject(row.source_metadata),
    isDeprecated: Boolean(row.is_deprecated),
    deprecatedAt: row.deprecated_at,
    deprecationReason: row.deprecation_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function auditTerm(client, {
  term,
  action,
  before,
  auditReason = reason,
  metadata = {},
}) {
  await client.query(
    `INSERT INTO governance_audit_events
       (entity_type, entity_id, action, actor, reason, before, after, metadata)
     VALUES ('taxonomyTerm', $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
    [
      term.id,
      action,
      actor,
      auditReason,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(termSnapshot(term)),
      JSON.stringify({
        actorProvenance: "declared",
        ...metadata,
      }),
    ],
  );
}

async function findTermByCategoryLabel(client, versionId, item) {
  const result = await client.query(
    `SELECT id, version_id, category, label, shortcode, parent_id, superseded_by,
            legacy_codes, source_metadata, is_deprecated, deprecated_at,
            deprecation_reason, created_at, updated_at
       FROM taxonomy_terms
      WHERE version_id = $1
        AND lower(category) = lower($2)
        AND label = $3
      LIMIT 2`,
    [versionId, item.category, item.label],
  );
  if (result.rowCount > 1) {
    throw new Error(
      `Refusing to seed ${item.category}/${item.label}: multiple matching taxonomy terms already exist`,
    );
  }
  return result.rows[0] ?? null;
}

async function resolveCategoryGroup(client, versionId, desiredCategory) {
  const result = await client.query(
    `SELECT category, COUNT(*)::int AS count
       FROM taxonomy_terms
      WHERE version_id = $1
        AND lower(category) = lower($2)
      GROUP BY category
      ORDER BY (category = $2) DESC, count DESC, category
      LIMIT 1`,
    [versionId, desiredCategory],
  );
  return result.rows[0]?.category ?? desiredCategory;
}

async function ensureLegacyTerm(client, versionId, item) {
  const byCode = await client.query(
    `SELECT id, version_id, category, label, shortcode, parent_id, superseded_by,
            legacy_codes, source_metadata, is_deprecated, deprecated_at,
            deprecation_reason, created_at, updated_at
       FROM taxonomy_terms
      WHERE version_id = $1 AND shortcode = $2
      LIMIT 1`,
    [versionId, item.shortcode],
  );
  if (byCode.rowCount > 1) {
    throw new Error(`Refusing to seed ${item.shortcode}: duplicate shortcode already exists`);
  }
  if (byCode.rowCount === 1) return { term: byCode.rows[0], created: false };

  const matching = await findTermByCategoryLabel(client, versionId, item);
  if (matching) return { term: matching, created: false };

  const inserted = await client.query(
    `INSERT INTO taxonomy_terms
       (version_id, category, label, shortcode, legacy_codes, source_metadata)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, '{}'::jsonb)
     RETURNING id, version_id, category, label, shortcode, parent_id, superseded_by,
               legacy_codes, source_metadata, is_deprecated, deprecated_at,
               deprecation_reason, created_at, updated_at`,
    [versionId, item.category, item.label, item.shortcode],
  );
  return { term: inserted.rows[0], created: true };
}

async function assertCodeNamespaceAvailable(client, versionId, item) {
  const result = await client.query(
    `SELECT id, shortcode, legacy_codes
       FROM taxonomy_terms
      WHERE version_id = $1
        AND (shortcode = $2 OR legacy_codes @> $3::jsonb)
      LIMIT 1`,
    [versionId, item.shortcode, JSON.stringify([item.shortcode])],
  );
  if (result.rowCount > 0) {
    throw new Error(
      `Taxonomy code ${item.shortcode} is already used by another term or legacy code`,
    );
  }
}

async function ensureClicsTerm(client, versionId, item, category) {
  const matching = await findTermByCategoryLabel(client, versionId, item);
  if (matching) {
    const currentMetadata = metadataObject(matching.source_metadata);
    const nextMetadata = {
      ...currentMetadata,
      sourceLabel,
      codeProvenance,
    };
    if (
      currentMetadata.sourceLabel === nextMetadata.sourceLabel
      && currentMetadata.codeProvenance === nextMetadata.codeProvenance
    ) {
      return { term: matching, created: false, updated: false };
    }

    const updated = await client.query(
      `UPDATE taxonomy_terms
          SET source_metadata = $2::jsonb, updated_at = now()
        WHERE id = $1
      RETURNING id, version_id, category, label, shortcode, parent_id, superseded_by,
                legacy_codes, source_metadata, is_deprecated, deprecated_at,
                deprecation_reason, created_at, updated_at`,
      [matching.id, JSON.stringify(nextMetadata)],
    );
    return { term: updated.rows[0], created: false, updated: true, before: matching };
  }

  await assertCodeNamespaceAvailable(client, versionId, item);
  const inserted = await client.query(
    `INSERT INTO taxonomy_terms
       (version_id, category, label, shortcode, legacy_codes, source_metadata)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, $5::jsonb)
     RETURNING id, version_id, category, label, shortcode, parent_id, superseded_by,
               legacy_codes, source_metadata, is_deprecated, deprecated_at,
               deprecation_reason, created_at, updated_at`,
    [versionId, category, item.label, item.shortcode, JSON.stringify(sourceMetadata())],
  );
  return { term: inserted.rows[0], created: true, updated: false, before: null };
}

async function assertSeedShape(client, versionId) {
  const result = await client.query(
    `SELECT category, label, source_metadata
       FROM taxonomy_terms
      WHERE version_id = $1
        AND lower(category) IN ('product_family', 'region')`,
    [versionId],
  );
  const expected = new Set(clicsTerms.map((item) => `${item.category}:${item.label}`));
  const rowsByValue = new Map();
  for (const row of result.rows) {
    const key = `${row.category.toLowerCase()}:${row.label}`;
    if (!expected.has(key)) continue;
    const rows = rowsByValue.get(key) ?? [];
    rows.push(row);
    rowsByValue.set(key, rows);
  }
  for (const key of expected) {
    const rows = rowsByValue.get(key) ?? [];
    if (rows.length !== 1) {
      throw new Error(`CliCS taxonomy seed expected one governed value for ${key}, found ${rows.length}`);
    }
    const metadata = metadataObject(rows[0].source_metadata);
    if (metadata.sourceLabel !== sourceLabel || metadata.codeProvenance !== codeProvenance) {
      throw new Error(`CliCS taxonomy seed source metadata is incomplete for ${key}`);
    }
  }
}

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Upsert the existing development taxonomy version without changing its
    // effective/deprecation dates, then serialize all term writes on it.
    const versionResult = await client.query(
      `INSERT INTO taxonomy_versions (version, effective_at)
       VALUES ($1, now())
       ON CONFLICT (version) DO UPDATE SET version = EXCLUDED.version
       RETURNING id`,
      [version],
    );
    const versionId = versionResult.rows[0].id;
    await client.query("SELECT id FROM taxonomy_versions WHERE id = $1 FOR UPDATE", [versionId]);

    for (const item of legacyTerms) {
      const ensured = await ensureLegacyTerm(client, versionId, item);
      if (ensured.created) {
        await auditTerm(client, {
          term: ensured.term,
          action: "seed",
          before: null,
          auditReason: legacyReason,
        });
      }
    }

    const canonicalCategories = {
      product_family: await resolveCategoryGroup(client, versionId, "product_family"),
      region: await resolveCategoryGroup(client, versionId, "region"),
    };
    for (const item of clicsTerms) {
      const ensured = await ensureClicsTerm(
        client,
        versionId,
        item,
        canonicalCategories[item.category],
      );
      if (ensured.created) {
        await auditTerm(client, {
          term: ensured.term,
          action: "seed",
          before: null,
          metadata: { sourceLabel, codeProvenance },
        });
      } else if (ensured.updated) {
        await auditTerm(client, {
          term: ensured.term,
          action: "seed",
          before: ensured.before,
          metadata: { sourceLabel, codeProvenance },
        });
      }
    }

    await assertSeedShape(client, versionId);
    await client.query("COMMIT");
    console.log(`CliCS taxonomy seed complete: ${clicsTerms.length} values in ${version}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}