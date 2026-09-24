import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import express from "express";
import developmentRouter from "../src/routes/development";
import { developmentPolicy } from "../src/lib/development-policy";

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

test("simulator rejects PII, caller actor, imports and unrestricted participant administration before database access", async () => {
  const scope = { campaignId: "00000000-0000-4000-8000-000000000001",
    activityId: "00000000-0000-4000-8000-000000000002",
    sessionId: "00000000-0000-4000-8000-000000000003" };
  const fixture = { ...scope, fixtureKey: "fixture-1", audienceClass: "customer",
    audienceBranchId: "00000000-0000-4000-8000-000000000004",
    expectedRevision: 0, idempotencyKey: "00000000-0000-4000-8000-000000000005",
    calculationAt: "2027-01-01T00:00:00.000Z" };
  for (const extra of [
    { email: "real@example.com" }, { name: "Customer name" }, { actorId: scope.campaignId },
    { sourceSystem: "on24" }, { fixtureKey: "person@example.com" },
  ]) {
    const response = await fetch(`${url}/development/participants/fixtures`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...fixture, ...extra }),
    });
    assert.equal(response.status, 400, JSON.stringify(extra));
  }
  for (const path of ["import", "send", "publish", "handoff", "people"]) {
    const response = await fetch(`${url}/development/participants/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 403, path);
  }
});

test("transition requires fixed UUID retry/source tuple and closed synthetic observations", async () => {
  const base = { campaignId: "00000000-0000-4000-8000-000000000001",
    activityId: "00000000-0000-4000-8000-000000000002",
    sessionId: "00000000-0000-4000-8000-000000000003",
    action: "record-attendance", expectedRevision: 0,
    idempotencyKey: "00000000-0000-4000-8000-000000000005",
    sourceReference: "00000000-0000-4000-8000-000000000006",
    calculationAt: "2027-01-01T00:00:00.000Z", attendance: "attended" };
  for (const extra of [
    { idempotencyKey: "retry-free-text" }, { sourceReference: "on24-production-import" },
    { attendance: "opened_email" }, { action: "send" }, { actorId: base.campaignId },
    { participantEmail: "real@example.com" },
  ]) {
    const response = await fetch(`${url}/development/participants/transitions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...base, ...extra }),
    });
    assert.equal(response.status, 400, JSON.stringify(extra));
  }
});

test("fixture-key and participant cursors are distinct and branch scope requires UUIDs", async () => {
  const scope = "campaignId=00000000-0000-4000-8000-000000000001&activityId=00000000-0000-4000-8000-000000000002&sessionId=00000000-0000-4000-8000-000000000003";
  for (const [path, query] of [
    ["fixtures", "after=00000000-0000-4000-8000-000000000004"],
    ["population", "after=fixture-1"],
    ["fixtures", "audienceBranchId=not-a-uuid"],
    ["population", "audienceBranchId=not-a-uuid"],
    ["suppression", "audienceBranchId=not-a-uuid"],
    ["history", "audienceBranchId=not-a-uuid"],
  ]) {
    const response = await fetch(`${url}/development/participants/${path}?${scope}&${query}`);
    assert.equal(response.status, 400, `${path} ${query}`);
  }
});