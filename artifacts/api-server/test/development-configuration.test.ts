import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function configuration(mode: string | undefined, environment: string, deployment?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: environment, DATABASE_URL: "postgres://unreachable.invalid/no-network-used" };
  delete env.PLANNING_ACCESS_MODE;
  delete env.REPLIT_DEPLOYMENT;
  if (mode !== undefined) env.PLANNING_ACCESS_MODE = mode;
  if (deployment !== undefined) env.REPLIT_DEPLOYMENT = deployment;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    "import {planningAccessMode,pool} from '@workspace/db'; console.log(planningAccessMode); await pool.end();"],
  { env, encoding: "utf8" });
}
test("missing config is restricted and invalid config never enables open planning", () => {
  const missing = configuration(undefined, "development");
  assert.equal(missing.status, 0, missing.stderr);
  assert.equal(missing.stdout.trim(), "restricted");
  for (const mode of ["", "open", "administrator"]) assert.notEqual(configuration(mode, "development").status, 0);
});
test("production and deployed environments refuse open planning before connection", () => {
  assert.notEqual(configuration("open-development", "production").status, 0);
  assert.notEqual(configuration("open-development", "development", "1").status, 0);
});