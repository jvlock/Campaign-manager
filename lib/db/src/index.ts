import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { userInfo } from "node:os";
import * as schema from "./schema";

const { Pool } = pg;

export const planningAccessMode = process.env.PLANNING_ACCESS_MODE ?? "restricted";
if (!["restricted", "open-development"].includes(planningAccessMode)) {
  throw new Error("Invalid PLANNING_ACCESS_MODE");
}
const openDevelopment = planningAccessMode === "open-development";
if (openDevelopment && (process.env.NODE_ENV !== "development" || !!process.env.REPLIT_DEPLOYMENT)) {
  throw new Error("Open planning requires non-deployed NODE_ENV=development");
}
let workspace = resolve(process.cwd());
while (!existsSync(join(workspace, "pnpm-workspace.yaml"))) {
  const parent = dirname(workspace);
  if (parent === workspace) throw new Error("Cannot locate planning workspace");
  workspace = parent;
}
const developmentRoot = join(workspace, ".local/open-development-planning");
if (!openDevelopment && !process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = openDevelopment
  ? new Pool({ host: join(developmentRoot, "socket"), port: 5432,
      database: "open_development_planning", user: userInfo().username, password: "",
      ssl: false, connectionTimeoutMillis: 5000 })
  : new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

/** Must complete before the API accepts requests. No shared DB is used in open mode. */
export async function assertPlanningDatabaseIsolation(): Promise<void> {
  const markerTable = await pool.query("SELECT to_regclass('public.development_planning_environment') IS NOT NULL AS present");
  if (!openDevelopment) {
    if (markerTable.rows[0].present) {
      const marker = await pool.query("SELECT 1 FROM development_planning_environment LIMIT 1");
      if (marker.rowCount) throw new Error("Restricted access refuses development planning databases and unverified records");
    }
    return;
  }
  for (const path of [developmentRoot, join(developmentRoot, "data"), join(developmentRoot, "socket")]) {
    const info = statSync(path);
    if (info.uid !== userInfo().uid || (info.mode & 0o077) !== 0 || realpathSync(path) !== path) {
      throw new Error("Development database directories must be private, owned locally and not symlinks");
    }
  }
  const actual = await pool.query(`SELECT current_database() AS database,
    inet_server_addr() IS NULL AS socket, current_setting('data_directory') AS directory,
    current_setting('listen_addresses') AS listeners`);
  const row = actual.rows[0];
  if (row.database !== "open_development_planning" || !row.socket || row.listeners !== "" ||
      realpathSync(row.directory) !== realpathSync(join(developmentRoot, "data")) ||
      !markerTable.rows[0].present) throw new Error("Open planning database isolation verification failed");
  const marker = await pool.query(`SELECT 1 FROM development_planning_environment e
    JOIN organization_units g ON g.id=e.default_group_id AND g.kind='group' AND g.status='active'
    JOIN users c ON c.id=e.creator_id JOIN users a ON a.id=e.accountable_owner_id
    WHERE e.id=true AND e.marker='synthetic-open-development-v1'`);
  if (marker.rowCount !== 1) throw new Error("Missing or invalid synthetic development isolation marker");
  const contamination = await pool.query(`SELECT
    EXISTS (SELECT 1 FROM campaigns c WHERE NOT EXISTS (
      SELECT 1 FROM development_record_registry r WHERE r.entity_type='campaign' AND r.entity_id=c.id))
    OR EXISTS (SELECT 1 FROM activities a WHERE NOT EXISTS (
      SELECT 1 FROM development_record_registry r WHERE r.entity_type='activity' AND r.entity_id=a.id))
    AS contaminated`);
  if (contamination.rows[0].contaminated) {
    throw new Error("Open planning refuses database containing unregistered campaign or activity records");
  }
}

export * from "./schema";
