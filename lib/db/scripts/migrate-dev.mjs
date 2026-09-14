import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to run the development migration with NODE_ENV=production");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running the development migration");
}

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const migrationFiles = (await readdir(migrationsDir))
  .filter((file) => /^\d+_.*\.sql$/.test(file))
  .sort();
if (!migrationFiles.length) {
  throw new Error(`No development migrations found in ${migrationsDir}`);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const migrationFile of migrationFiles) {
      await client.query(await readFile(resolve(migrationsDir, migrationFile), "utf8"));
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