import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { pool } from "@workspace/db";
import router from "../src/routes/development";

test("ownership writes and immutable replay audit commit together; failed audit rolls back", async () => {
  const original = pool.connect;
  let version = 1;
  let audit: any = null;
  let failAudit = false;
  let audits = 0;
  const id = "00000000-0000-4000-8000-000000000001";
  pool.connect = (async () => {
    const oldVersion = version;
    return {
      async query(sql: string, values?: any[]) {
        if (sql === "ROLLBACK") version = oldVersion;
        if (sql.includes("SELECT id FROM organization_units")) return { rowCount: 1, rows: [{ id }] };
        if (sql.includes("FOR UPDATE")) return { rowCount: 1, rows: [{ campaign_id: id, row_version: version }] };
        if (sql.includes("SELECT details")) return { rows: audit?.retryKey === values?.[1] ? [{ response: audit.response }] : [] };
        if (sql.startsWith("UPDATE")) return { rows: [{ rowVersion: ++version, groupId: id, accountableOwnerId: id }] };
        if (sql.includes("INSERT INTO organization_audit")) {
          if (failAudit) throw new Error("audit unavailable");
          audit = JSON.parse(values![3]); audits++;
          return { rowCount: 1, rows: [] };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
  }) as unknown as typeof pool.connect;
  const server = express().use(express.json()).use(router).listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}/development/ownership/campaigns/${id}`;
  const send = (rowVersion: number) => fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rowVersion, groupId: id, accountableOwnerId: id }) });
  try {
    const first = await send(1);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    const retry = await send(1);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), firstBody);
    assert.equal(version, 2);
    assert.equal(audits, 1);
    assert.equal(audit.unverified, true);
    failAudit = true;
    assert.equal((await send(2)).status, 503);
    assert.equal(version, 2);
    assert.equal(audits, 1);
  } finally {
    pool.connect = original;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});