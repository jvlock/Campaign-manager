import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { pool } from "@workspace/db";
import router from "../src/routes/development";
import { pagination, pageHeaders } from "../src/lib/pagination";

test("bounded population headers disclose composite totals and continuation", () => {
  const page = pagination({ limit: 2, offset: 2 });
  let header = "";
  pageHeaders({ setHeader: (_key: string, value: string) => { header = value; } } as any, page, [5, 1], 2);
  assert.deepEqual(JSON.parse(header), { total: 6, returned: 2, nextOffset: 4, hasMore: true });
  for (const input of [{ limit: 0 }, { limit: 501 }, { offset: -1 }, { offset: "NaN" }]) {
    assert.throws(() => pagination(input));
  }
});

test("calendar bounded stable pages disclose totals and filter before counting", async () => {
  const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
  const original = pool.connect;
  const queries: string[] = [];
  pool.connect = (async () => ({
    async query(sql: string, values?: unknown[]) {
      queries.push(sql);
      if (sql.includes("count(*)")) return { rows: [{ total: 3 }] };
      if (sql.includes("SELECT id FROM organization_units")) return { rowCount: 1, rows: [{ id: ids[0] }] };
      if (sql.includes("FOR UPDATE")) return { rowCount: 1, rows: [{ campaign_id: ids[0], row_version: 2 }] };
      if (sql.includes("SELECT a.id")) {
        assert.match(sql, /ORDER BY a.id LIMIT \$4/);
        return { rows: ids.filter(id => !values?.[2] || id > String(values[2])).slice(0, Number(values?.[3])).map(id => ({ id })) };
      }
      return { rows: [] };
    },
    release() {},
  })) as unknown as typeof pool.connect;
  const app = express().use(express.json()).use(router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  try {
    const first = await (await fetch(`${base}/development/calendar?limit=2`)).json();
    assert.equal(first.total, 3);
    assert.equal(first.returned, 2);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextCursor, ids[1]);
    const last = await (await fetch(`${base}/development/calendar?limit=2&after=${first.nextCursor}`)).json();
    assert.equal(last.returned, 1);
    assert.equal(last.hasMore, false);
    assert.equal(last.nextCursor, null);
    assert.deepEqual([...first.entries, ...last.entries].map(entry => entry.id), ids);
    const countSql = queries.find(sql => sql.includes("count(*)"))!;
    assert.match(countSql, /development_record_registry/);
    assert.match(countSql, /o.group_id=\$1/);
    assert.match(countSql, /a.campaign_id=\$2/);
    assert.equal((await fetch(`${base}/development/calendar?limit=201`)).status, 400);
    assert.equal((await fetch(`${base}/development/calendar?after=invalid`)).status, 400);
    assert.equal((await fetch(`${base}/development/ownership/campaigns/${ids[0]}`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" })).status, 428);
    const competing = await Promise.all([1, 2].map(() => fetch(`${base}/development/ownership/campaigns/${ids[0]}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: ids[0], accountableOwnerId: ids[1], rowVersion: 1 }),
    })));
    assert.deepEqual(competing.map(response => response.status), [409, 409]);
    assert.equal(queries.some(sql => sql.startsWith("UPDATE")), false, "Stale ownership requests cannot write state");
  } finally {
    pool.connect = original;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});