#!/usr/bin/env node
// Persistent isolated synthetic planning database. Never reads DATABASE_URL.
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dbRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(dbRoot, "../..");
const root = join(workspace, ".local/open-development-planning");
const data = join(root, "data");
const socket = join(root, "socket");
const database = "open_development_planning";
const user = userInfo().username;
const { Client } = createRequire(join(dbRoot, "package.json"))("pg");
const command = process.argv[2] ?? "dev";
const ids = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mode = process.env.PLANNING_ACCESS_MODE ?? "restricted";

function findProgram(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const path = join(dir, name);
    if (dir && spawnSync("test", ["-x", path]).status === 0) return path;
  }
  const result = spawnSync("find", ["/nix/store", "-maxdepth", "3", "-path", `*/bin/${name}`, "-print", "-quit"], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  throw new Error(`Required PostgreSQL program not found: ${name}`);
}
function run(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`${basename(program)} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result;
}
async function privateDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== userInfo().uid ||
      (info.mode & 0o077) !== 0 || await realpath(path) !== path) {
    throw new Error(`Private, locally owned, non-symlink directory required: ${path}`);
  }
}
async function verify(client) {
  const { rows: [actual] } = await client.query(`SELECT current_database() AS database,
    inet_server_addr() IS NULL AS socket, current_setting('data_directory') AS directory,
    current_setting('listen_addresses') AS listeners`);
  if (actual.database !== database || !actual.socket || actual.listeners !== "" ||
      await realpath(actual.directory) !== await realpath(data)) throw new Error("Local database identity mismatch");
  const marker = await client.query(`SELECT 1 FROM development_planning_environment e
    JOIN organization_units g ON g.id=e.default_group_id AND g.kind='group' AND g.status='active'
    JOIN users c ON c.id=e.creator_id JOIN users a ON a.id=e.accountable_owner_id
    WHERE e.id AND e.marker='synthetic-open-development-v1'`);
  if (marker.rowCount !== 1) throw new Error("Local database is missing its synthetic isolation marker");
  const contamination = await client.query(`SELECT
    EXISTS (SELECT 1 FROM campaigns c WHERE NOT EXISTS (
      SELECT 1 FROM development_record_registry r WHERE r.entity_type='campaign' AND r.entity_id=c.id))
    OR EXISTS (SELECT 1 FROM activities a WHERE NOT EXISTS (
      SELECT 1 FROM development_record_registry r WHERE r.entity_type='activity' AND r.entity_id=a.id))
    OR EXISTS (SELECT 1 FROM webinar_people)
    AS contaminated`);
  if (contamination.rows[0].contaminated) throw new Error("Local development database contains unregistered campaign or activity records; access refused");
}
async function seed(client, files) {
  await client.query("BEGIN");
  try {
    await client.query(await readFile(join(dbRoot, "test/pre-0001-foundation.sql"), "utf8"));
    for (const file of files) {
      if (file.startsWith("0016_")) {
        await client.query(`INSERT INTO taxonomy_versions(id,version,effective_at)
          VALUES($1,'synthetic-open-development-NON-AUTHORITATIVE-v1','2020-01-01')`, [ids(16)]);
      }
      await client.query(await readFile(join(dbRoot, "migrations", file), "utf8"));
    }
    await client.query(`UPDATE taxonomy_terms SET source_metadata=source_metadata ||
      '{"development_only":true,"authoritative":false,"source":"synthetic local bootstrap"}'::jsonb`);
    await client.query(`INSERT INTO users(id,name,email,role) VALUES
      ($1,'Unverified development creator','creator@synthetic.invalid','marketer'),
      ($2,'Unverified development accountable owner','accountable@synthetic.invalid','marketer')`, [ids(3), ids(4)]);
    await client.query(`INSERT INTO organization_units(id,name,kind,accountable_owner_id)
      VALUES($1,'Synthetic development team','team',$2)`, [ids(1), ids(4)]);
    await client.query(`INSERT INTO organization_units(id,name,kind,parent_id,accountable_owner_id)
      VALUES($1,'Synthetic development group','group',$2,$3)`, [ids(2), ids(1), ids(4)]);
    await client.query(`INSERT INTO development_planning_environment(marker,default_group_id,creator_id,accountable_owner_id)
      VALUES('synthetic-open-development-v1',$1,$2,$3)`, [ids(2), ids(3), ids(4)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
async function startLocal() {
  const newCluster = await lstat(root).then(() => false, error => {
    if (error.code === "ENOENT") return true;
    throw error;
  });
  const files = (await readdir(join(dbRoot, "migrations"))).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort();
  const hashes = {};
  let upgrade = false;
  for (const file of files) hashes[file] = createHash("sha256").update(await readFile(join(dbRoot, "migrations", file))).digest("hex");
  if (newCluster) {
    if (command === "upgrade-0024") throw new Error("Upgrade requires an existing reviewed 0001-0023 cluster");
    await mkdir(root, { mode: 0o700 });
    await mkdir(socket, { mode: 0o700 });
    run(findProgram("initdb"), ["-D", data, "-U", user, "--auth-local=peer", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
    await chmod(data, 0o700);
    await writeFile(join(data, "postgresql.auto.conf"), [
      "listen_addresses = ''", `unix_socket_directories = '${socket.replaceAll("'", "''")}'`,
      "unix_socket_permissions = 0700", "",
    ].join("\n"), { mode: 0o600 });
  } else {
    // An interrupted/unknown bootstrap is refused, never overwritten or repaired silently.
    await privateDirectory(root);
    const manifest = JSON.parse(await readFile(join(root, "bootstrap-manifest.json"), "utf8"));
    if (JSON.stringify(manifest.migrations) !== JSON.stringify(hashes)) {
      const priorFiles = files.filter(file => file < "0024_");
      upgrade = command === "upgrade-0024" && manifest.marker === "synthetic-open-development-v1" &&
        files.length === 24 && priorFiles.length === 23 &&
        Object.keys(manifest.migrations ?? {}).length === 23 &&
        priorFiles.every(file => manifest.migrations[file] === hashes[file]);
      if (!upgrade) throw new Error("Existing local cluster migration manifest differs; explicit reviewed upgrade-0024 required. No reset performed.");
    }
  }
  for (const path of [root, data, socket]) await privateDirectory(path);
  const pgCtl = findProgram("pg_ctl");
  const status = spawnSync(pgCtl, ["-D", data, "status"], { stdio: "ignore" });
  if (status.status !== 0) run(pgCtl, ["-D", data, "-l", join(root, "postgres.log"), "-w", "start", "-o", "-p 5432"]);
  if (newCluster) {
    const admin = new Client({ host: socket, port: 5432, database: "postgres", user, password: "", ssl: false });
    await admin.connect();
    try { await admin.query(`CREATE DATABASE ${database}`); } finally { await admin.end(); }
  }
  const client = new Client({ host: socket, port: 5432, database, user, password: "", ssl: false });
  await client.connect();
  try {
    if (newCluster) await seed(client, files);
    await verify(client);
    if (upgrade) {
      // Explicit operator command, only this peer-auth private synthetic cluster.
      // A committed migration with failed manifest write fails closed on retry for manual review.
      await client.query("BEGIN");
      try {
        await client.query(await readFile(join(dbRoot, "migrations/0024_webinar_persistence_foundation.sql"), "utf8"));
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    if (newCluster || upgrade) await writeFile(join(root, "bootstrap-manifest.json"),
      JSON.stringify({ marker: "synthetic-open-development-v1", migrations: hashes }, null, 2), { mode: 0o600 });
  } finally { await client.end(); }
  console.log("Verified private Unix-socket synthetic development planning database (non-authoritative).");
}
async function api() {
  // Child-only NODE_ENV; platform database configuration is neither replaced nor inspected.
  const child = spawn("pnpm", ["run", "dev:api"], {
    cwd: join(workspace, "artifacts/api-server"), stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => child.kill(signal));
  process.exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", code => done(code ?? 1));
  });
}
try {
  if (command === "--help") {
    console.log(`Usage: node lib/db/scripts/open-development-planning.mjs [dev|setup|stop|upgrade-0024]
dev: restricted retains normal API dev command; explicit open-development provisions/verifies isolated DB then starts API.
setup: requires PLANNING_ACCESS_MODE=open-development, NODE_ENV=development, non-deployment.
upgrade-0024: explicit additive upgrade of an exact checksum-matching 0001-0023 private synthetic cluster; no reset.
stop: pg_ctl fast graceful stop; preserves all plans and cluster files.
API shutdown does NOT delete or stop persistent PostgreSQL. Use stop after stopping API.
Root: ${root} (git ignored, 0700); Unix socket only, peer auth, no TCP.
New clusters only: synthetic pre-0001 prerequisite, all migrations, non-authority taxonomy.
Existing clusters: verify marker and migration checksums; never reset or automatically migrate.
Interrupted bootstrap: explicit operator review required; preserve data before any manual recovery.
Restricted transition requires a separate operational database and verified identities; never reuse this development DB.`);
  } else if (command === "stop") {
    await privateDirectory(root);
    await privateDirectory(data);
    run(findProgram("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
    console.log("Local PostgreSQL stopped; persistent planning records preserved.");
  } else {
    if (!["dev", "setup", "upgrade-0024"].includes(command)) throw new Error("Unknown launcher command; use --help");
    if (!["restricted", "open-development"].includes(mode)) throw new Error("Invalid PLANNING_ACCESS_MODE");
    if (mode === "open-development") {
      if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) throw new Error("Open planning requires NODE_ENV=development and is forbidden in deployment");
      await startLocal();
    } else if (command !== "dev") throw new Error("Setup or upgrade requires explicit open-development mode");
    if (command === "dev") await api();
  }
} catch (error) {
  console.error(error?.message ?? error);
  process.exitCode = 1;
}