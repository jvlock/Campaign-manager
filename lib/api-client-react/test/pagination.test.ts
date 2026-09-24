import assert from "node:assert/strict";
import { test } from "node:test";
import { customFetch } from "../src/custom-fetch";

const page = (body: unknown, total: number, nextOffset: number | null) => new Response(JSON.stringify(body), {
  headers: { "content-type": "application/json", "X-Pagination": JSON.stringify({ total, returned: Array.isArray(body) ? body.length : 1, nextOffset, hasMore: nextOffset !== null }) },
});
test("generated-client transport consumes all collection pages before resolving", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async input => {
    urls.push(String(input));
    return urls.length === 1 ? page([{ id: "a" }], 2, 1) : page([{ id: "b" }], 2, null);
  };
  try {
    assert.deepEqual(await customFetch("/api/campaigns"), [{ id: "a" }, { id: "b" }]);
    assert.equal(urls[1], "/api/campaigns?offset=1");
  } finally { globalThis.fetch = original; }
});
test("composite group/profile pages are merged by stable ID", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => ++count === 1
    ? page({ groups: [{ id: "a" }], profiles: [{ id: "p" }], unverified: true }, 3, 1)
    : page({ groups: [{ id: "b" }], profiles: [], unverified: true }, 3, null);
  try {
    assert.deepEqual(await customFetch("/api/development/groups"), { groups: [{ id: "a" }, { id: "b" }], profiles: [{ id: "p" }], unverified: true });
  } finally { globalThis.fetch = original; }
});
test("failed or inconsistent later pages never resolve a partial success", async () => {
  const original = globalThis.fetch;
  try {
    for (const later of [
      () => new Response("unavailable", { status: 503 }),
      () => page([{ id: "b" }], 3, null),
      () => page([{ id: "a" }], 2, null),
    ]) {
      let count = 0;
      globalThis.fetch = async () => ++count === 1 ? page([{ id: "a" }], 2, 1) : later();
      await assert.rejects(customFetch("/api/campaigns"));
    }
  } finally { globalThis.fetch = original; }
});