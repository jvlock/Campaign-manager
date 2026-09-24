import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import express from "express";
import developmentRouter from "../src/routes/development";
import { allowsDevelopmentPlanning, developmentPolicy } from "../src/lib/development-policy";

let server: Server;
let url: string;
before(async () => {
  const app = express();
  app.use(express.json(), developmentPolicy, developmentRouter);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test listener unavailable");
  url = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
const scope = { campaignId: "00000000-0000-4000-8000-000000000001",
  activityId: "00000000-0000-4000-8000-000000000002",
  occurrenceId: "00000000-0000-4000-8000-000000000003" };
const endpoint = "/development/foundation/observations";

test("only scoped read and synthetic refresh are allowlisted; no provider administration or output submission", () => {
  assert.equal(allowsDevelopmentPlanning("GET", endpoint), true);
  assert.equal(allowsDevelopmentPlanning("POST", `${endpoint}/refresh`), true);
  for (const [verb, path] of [
    ["PUT", endpoint], ["PATCH", endpoint], ["POST", endpoint],
    ["GET", `${endpoint}/refresh`], ["POST", `${endpoint}/manual`],
    ["POST", "/development/foundation/connect"], ["GET", "/development/foundation/credentials"],
  ]) assert.equal(allowsDevelopmentPlanning(verb, path), false);
});

test("read rejects incomplete or unrelated scope before querying sources", async () => {
  for (const query of ["", `campaignId=${scope.campaignId}`, `campaignId=${scope.campaignId}&activityId=invalid&occurrenceId=${scope.occurrenceId}`]) {
    const response = await fetch(`${url}${endpoint}?${query}`);
    assert.equal(response.status, 400);
  }
});

test("refresh rejects manual governed output, browser identity and provider addresses before database access", async () => {
  const input = { ...scope, expectedRevision: 0, idempotencyKey: "00000000-0000-4000-8000-000000000004",
    calculationAt: "2027-01-01T00:00:00.000Z" };
  for (const extra of [
    { output: { type: "campaign_code", code: "LOCAL" } },
    { actorId: scope.campaignId }, { providerUrl: "https://example.org/foundation" },
    { credentials: "not-allowed" }, { expectedRevision: -1 }, { idempotencyKey: "arbitrary" },
  ]) {
    const response = await fetch(`${url}${endpoint}/refresh`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, ...extra }),
    });
    assert.equal(response.status, 400, JSON.stringify(extra));
  }
  const response = await fetch(`${url}${endpoint}/refresh`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
  assert.equal(response.status, 409);
  assert.match(JSON.stringify(await response.json()), /No approved synthetic Foundation contract fixture/);
});