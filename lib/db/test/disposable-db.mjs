#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { seedPriorOrganizationFixture, priorPayloadSnapshot, assertPriorPayloadUnchanged, checkOrganizationConstraints } from "./organization-migration.mjs";
import { checkDevelopmentConstraints } from "./open-development-migration.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dbRoot = resolve(here, "..");
const migrationsDir = join(dbRoot, "migrations");
const requireFromDb = createRequire(join(dbRoot, "package.json"));
const { Client } = requireFromDb("pg");
const TEST_TAXONOMY_VERSION_ID = "7b5f21d0-7d42-4d91-8c1d-5a6be6c30016";
const TEST_TAXONOMY_VERSION_NAME = "test-disposable-foundation-v1";
const TEST_CLOCK = process.env.TEST_CLOCK ?? "2026-01-01T00:00:00.000Z";
if (!Number.isFinite(Date.parse(TEST_CLOCK))) throw new Error(`Invalid TEST_CLOCK: ${TEST_CLOCK}`);

let root;
let dataDir;
let socketDir;
let pgCtl;
let started = false;
let cleaning = false;

function findProgram(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try { if (spawnSync("test", ["-x", candidate]).status === 0) return candidate; } catch {}
  }
  try {
    const stores = spawnSync("find", ["/nix/store", "-maxdepth", "3", "-path", `*/bin/${name}`, "-print", "-quit"], { encoding: "utf8" });
    if (stores.status === 0 && stores.stdout.trim()) return stores.stdout.trim();
  } catch {}
  throw new Error(`Required PostgreSQL program not found: ${name}`);
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${basename(program)} ${args.join(" ")} failed (${result.status}):\n${result.stderr || result.stdout}`);
  }
  return result;
}

async function cleanup(reason = "normal") {
  if (cleaning) return;
  cleaning = true;
  let pid;
  try {
    pid = Number((await readFile(join(dataDir, "postmaster.pid"), "utf8")).split("\n")[0]);
  } catch {}
  if (started || pid) {
    try { run(pgCtl, ["-D", dataDir, "-m", "immediate", "-w", "stop"]); } catch (error) {
      console.error(`cleanup stop error: ${error.message}`);
    }
    if (pid) {
      try {
        process.kill(pid, 0);
        process.kill(pid, "SIGKILL");
        for (let attempt = 0; attempt < 50; attempt++) {
          await new Promise((done) => setTimeout(done, 20));
          try { process.kill(pid, 0); } catch { break; }
        }
      } catch {}
    }
  }
  let postgresStopped = true;
  if (pid) {
    try { process.kill(pid, 0); postgresStopped = false; } catch {}
  }
  started = false;
  if (root && postgresStopped) await rm(root, { recursive: true, force: true });
  const removed = root ? await stat(root).then(() => false, () => true) : true;
  console.log(JSON.stringify({ type: "cleanup", root, reason, postgresStopped, tempRootRemoved: removed, socketRemoved: removed }));
  if (!postgresStopped || !removed) process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    cleanup(signal).finally(() => process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 })[signal]));
  });
}

async function query(client, text, values) {
  return await client.query(text, values);
}

// Explicit test prerequisite, not an approved business taxonomy source.
async function bootstrapTestTaxonomyVersionFixture(client) {
  const clockCheck = await query(client, "SELECT $1::timestamptz <= now() AS supported", [TEST_CLOCK]);
  if (!clockCheck.rows[0].supported) throw new Error(`TEST_CLOCK must not be later than database now(): ${TEST_CLOCK}`);
  await query(client, `
    INSERT INTO taxonomy_versions(id, version, effective_at)
    VALUES ($1, $2, $3::timestamptz)
  `, [TEST_TAXONOMY_VERSION_ID, TEST_TAXONOMY_VERSION_NAME, TEST_CLOCK]);
}

function safeChildEnvironment(databaseUrl) {
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: root,
    TMPDIR: root,
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    PGHOST: socketDir,
    PGPORT: "5432",
    PGDATABASE: "postgres",
    PGUSER: userInfo().username,
    PGPASSFILE: join(root, "pgpass-does-not-exist"),
    TEST_TAXONOMY_VERSION_ID,
    TEST_CLOCK,
  };
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "CI", "TERM", "FORCE_COLOR", "NO_COLOR"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

async function main() {
  root = await mkdtemp(join(tmpdir(), "disposable-pg-"));
  await import("node:fs/promises").then(({ chmod, mkdir }) => Promise.all([
    chmod(root, 0o700), mkdir(dataDir = join(root, "data")), mkdir(socketDir = join(root, "socket")),
  ]));
  console.log(JSON.stringify({ type: "disposable-created", root, dataDir, socketDir, testClock: TEST_CLOCK }));
  const initdb = findProgram("initdb");
  pgCtl = findProgram("pg_ctl");
  run(initdb, ["-D", dataDir, "-U", userInfo().username, "--auth-local=peer", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  await writeFile(join(dataDir, "postgresql.auto.conf"), [
    `listen_addresses = ''`,
    `unix_socket_directories = '${socketDir.replaceAll("'", "''")}'`,
    "unix_socket_permissions = 0700", "",
  ].join("\n"));
  run(pgCtl, ["-D", dataDir, "-l", join(root, "postgres.log"), "-w", "start", "-o", "-p 5432"]);
  started = true;
  const user = userInfo().username;
  const databaseUrl = `postgresql://${encodeURIComponent(user)}@/postgres?host=${encodeURIComponent(socketDir)}&port=5432`;
  const client = new Client({ host: socketDir, port: 5432, database: "postgres", user });
  await client.connect();
  const applied = [];
  try {
    await query(client, await readFile(join(here, "pre-0001-foundation.sql"), "utf8"));
    const files = (await readdir(migrationsDir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    for (let number = 1; number <= files.length; number++) {
      const prefix = `${String(number).padStart(4, "0")}_`;
      if (files.filter((file) => file.startsWith(prefix)).length !== 1) {
        throw new Error(`Expected exactly one migration with prefix ${prefix}`);
      }
    }
    for (const file of files) {
      if (file.startsWith("0016_")) await bootstrapTestTaxonomyVersionFixture(client);
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await query(client, `BEGIN;\n${sql}\nCOMMIT;`).catch(async (error) => {
        await query(client, "ROLLBACK").catch(() => {});
        throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
      });
      const entry = { filename: file, sha256: createHash("sha256").update(sql).digest("hex") };
      applied.push(entry);
      console.log(JSON.stringify({ type: "migration-applied", ...entry }));
      if (file.startsWith("0016_")) {
        const evidence = await query(client, `
          SELECT count(*)::int AS provisional_terms,
                 count(*) FILTER (WHERE category='product_line')::int AS product_lines,
                 count(*) FILTER (WHERE category='campaign_shortcode')::int AS campaign_shortcodes,
                 count(*) FILTER (WHERE category='subcampaign')::int AS subcampaigns
          FROM taxonomy_terms WHERE version_id=$1
        `, [TEST_TAXONOMY_VERSION_ID]);
        console.log(JSON.stringify({ type: "after-0016-manifest", migration: entry, ...evidence.rows[0] }));
      }
    }
    const verification = await query(client, `
      SELECT
        EXISTS (SELECT 1 FROM pg_index i
          WHERE i.indrelid='webinar_registration_results'::regclass
            AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
            AND i.indpred IS NULL
            AND (SELECT array_agg(a.attname::text ORDER BY u.ord)
              FROM unnest(i.indkey::smallint[]) WITH ORDINALITY u(attnum,ord)
              JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=u.attnum)
              = ARRAY['session_id','person_id']) AS registration_unique,
        EXISTS (SELECT 1 FROM pg_constraint c WHERE conname='scheduled_instances_id_campaign_unique'
          AND conrelid='scheduled_instances'::regclass AND contype='u' AND convalidated
          AND (SELECT array_agg(a.attname::text ORDER BY u.ord)
            FROM unnest(c.conkey) WITH ORDINALITY u(attnum,ord)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum)
            = ARRAY['id','campaign_id']) AS scheduled_constraint_named,
        EXISTS (SELECT 1 FROM taxonomy_versions WHERE id=$1 AND effective_at <= $2::timestamptz
          AND effective_at <= now() AND (deprecated_at IS NULL OR deprecated_at > $2::timestamptz)
          AND (deprecated_at IS NULL OR deprecated_at > now())) AS taxonomy_active
    `, [TEST_TAXONOMY_VERSION_ID, TEST_CLOCK]);
    const checks = verification.rows[0];
    const requiredAfter0016 = ["0017_reusable_deliverables.sql", "0018_validate_landing_page_url.sql",
      "0019_quarantine_foundation_governance.sql", "0020_deliverable_reference_constraints.sql",
      "0021_stage_one_deliverable_publish.sql", "0022_organizational_foundation.sql",
      "0023_open_development_planning.sql"];
    const after0016Present = requiredAfter0016.every((name) => applied.some((entry) => entry.filename === name));
    if (!Object.values(checks).every(Boolean) || !after0016Present || applied.length !== files.length) {
      throw new Error(`Bootstrap verification failed: ${JSON.stringify({ ...checks, after0016Present })}`);
    }
    console.log(JSON.stringify({ type: "verification", allMigrations: applied.length === files.length, after0016Present, migrationCount: applied.length, ...checks }));
    await checkOrganizationConstraints(client, "fresh");
    await checkDevelopmentConstraints(client, "fresh");
    // Separate database in this private, disposable cluster: never a shared URL.
    await query(client, "CREATE DATABASE organization_prior_fixture");
    const prior = new Client({ host: socketDir, port: 5432, database: "organization_prior_fixture", user });
    await prior.connect();
    try {
      await query(prior, await readFile(join(here, "pre-0001-foundation.sql"), "utf8"));
      for (const file of files.filter((name) => name < "0022_")) {
        if (file.startsWith("0016_")) await bootstrapTestTaxonomyVersionFixture(prior);
        await query(prior, `BEGIN;\n${await readFile(join(migrationsDir, file), "utf8")}\nCOMMIT;`);
      }
      await seedPriorOrganizationFixture(prior);
      const before = await priorPayloadSnapshot(prior);
      for (const file of files.filter((name) => name >= "0022_")) {
        const pre0024 = file.startsWith("0024_") ? await priorPayloadSnapshot(prior) : null;
        await query(prior, `BEGIN;\n${await readFile(join(migrationsDir, file), "utf8")}\nCOMMIT;`);
        if (pre0024) {
          await assertPriorPayloadUnchanged(prior, pre0024);
          const empty = await query(prior, "SELECT count(*)::int n FROM webinar_persistence_bindings");
          if (empty.rows[0].n !== 0) throw new Error("0024 fabricated legacy bindings");
          console.log(JSON.stringify({ type: "webinar-pre0024-upgrade", completePriorChain: 23, priorTableCount: Object.keys(pre0024).length, byteEqual: true, noLegacyBackfill: true }));
        }
      }
      await assertPriorPayloadUnchanged(prior, before);
      await checkOrganizationConstraints(prior, "representative-pre0022");
      await checkDevelopmentConstraints(prior, "representative-pre0022");
      console.log(JSON.stringify({ type: "organization-legacy-payload-equality", priorTableCount: Object.keys(before).length, passed: true }));
    } finally {
      await prior.end();
      await query(client, "DROP DATABASE organization_prior_fixture");
    }
    const separator = process.argv.indexOf("--");
    const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
    if (command.length) {
      const child = spawn(command[0], command.slice(1), { stdio: "inherit", env: safeChildEnvironment(databaseUrl) });
      const code = await new Promise((resolveCode, reject) => {
        child.once("error", reject);
        child.once("exit", (value, signal) => resolveCode(value ?? 128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }[signal] ?? 0)));
      });
      if (code !== 0) process.exitCode = code;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  console.error(error?.stack ?? error);
} finally {
  await cleanup(process.exitCode ? "error" : "normal");
}