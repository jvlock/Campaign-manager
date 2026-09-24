import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import express from "express";
import { allowsDevelopmentPlanning, developmentPolicy } from "../src/lib/development-policy";
import { FoundationProviderError, type FoundationFailure } from "../src/lib/webinar-foundation";
import { classifyWebinarApiError, WebinarApiError } from "../src/lib/webinar-standard-api";
import webinarApiRouter from "../src/routes/development-webinar-api";

const root = "/campaigns/00000000-0000-4000-8000-000000000001/webinars/00000000-0000-4000-8000-000000000002/standard";
let server: Server, origin: string;
before(async () => {
  const app = express();
  // Mirrors the scoped parser and safe error boundary mounted before the general parser in app.ts.
  app.use(express.json({ limit: "16kb", strict: true }), express.urlencoded({ limit: "16kb", extended: false }));
  app.use((error: { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const tooLarge = error.type === "entity.too.large";
    res.status(tooLarge ? 413 : 400).json({ error: { code: "VALIDATION_ERROR",
      message: tooLarge ? "Request exceeds webinar API payload limit" : "Invalid webinar API request body" } });
  });
  app.use(developmentPolicy, webinarApiRouter);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
const command = {
  expectedRevision: 1, calculationAt: "2026-01-01T00:00:00.000Z",
  idempotencyKey: "00000000-0000-4000-8000-000000000003",
};
const post = async (suffix: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}${root}/${suffix}`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

test("bounded webinar resources only; no external governance or execution endpoints", () => {
  for (const suffix of ["summary", "readiness", "completion", "evaluations", "evidence", "exceptions", "history"])
    assert.equal(allowsDevelopmentPlanning("GET", `${root}/${suffix}`), true, suffix);
  for (const suffix of ["evaluations", "evidence", "exceptions"])
    assert.equal(allowsDevelopmentPlanning("POST", `${root}/${suffix}`), true, suffix);
  for (const [method, suffix] of [["POST", "publish"], ["POST", "send"], ["POST", "readiness/override"],
    ["POST", "foundation-observations"], ["POST", "exceptions/manual-approval"], ["PUT", "evidence"]])
    assert.equal(allowsDevelopmentPlanning(method, `${root}/${suffix}`), false, suffix);
});
test("strict evaluation input rejects supplied authority, provenance, status, invalid clock or idempotency key", async () => {
  for (const input of [
    { ...command, actorId: "00000000-0000-4000-8000-000000000004" }, { ...command, role: "admin" },
    { ...command, operationalReadiness: true }, { ...command, providerProvenance: { id: "external" } },
    { ...command, calculationAt: "tomorrow" }, { ...command, idempotencyKey: "bad" },
    { ...command, expectedRevision: -1 }, { ...command, calculationAt: undefined },
  ]) {
    const response = await post("evaluations", input);
    assert.equal(response.status, 400, JSON.stringify(input));
    assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
  }
  const forged = await post("evaluations", command, { "x-actor-role": "reviewer" });
  assert.equal(forged.status, 400);
  const oversized = await post("evaluations", { ...command, padding: "a".repeat(20_000) });
  assert.equal(oversized.status, 413);
});
test("review fails closed regardless of claimed identity; invalid attempts never query the database", async () => {
  const endpoint = `${origin}${root}/exceptions/00000000-0000-4000-8000-000000000004/review`;
  for (const body of [{}, { actorId: "00000000-0000-4000-8000-000000000005" },
    { role: "admin" }, { decision: "approved" }]) {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json",
      "x-actor-role": "reviewer" }, body: JSON.stringify(body) });
    assert.equal(response.status, Object.keys(body).length ? 400 : 403);
    assert.equal((await response.json()).error.code, Object.keys(body).length ? "VALIDATION_ERROR" : "UNAUTHORIZED");
  }
  const invalid = await post("exceptions/not-a-uuid/review", {});
  assert.equal(invalid.status, 400);
});
test("scope, unknown query, evidence parent and exception expiry are validated before any persistence", async () => {
  const malformedScope = await fetch(`${origin}/campaigns/not-a-uuid/webinars/not-a-uuid/standard/summary`);
  assert.equal(malformedScope.status, 400);
  assert.equal((await malformedScope.json()).error.code, "VALIDATION_ERROR");
  for (const suffix of ["summary?unknown=1", "evidence?scope=all", "history?limit=0", "history?afterRevision=no"]) {
    const response = await fetch(`${origin}${root}/${suffix}`);
    assert.equal(response.status, 400, suffix);
  }
  for (const [suffix, body] of [
    ["evidence", { ...command, evidenceType: "source-observation", sourceId: "bad" }],
    ["evidence", { ...command, evidenceType: "qa", sourceId: command.idempotencyKey, result: "pass" }],
    ["exceptions", { ...command, ruleId: "WEB-EXC-001", evidenceId: command.idempotencyKey,
      reasonCode: "test", expiresAt: "2027-01-01T00:00:00Z", reviewer: "synthetic" }],
    ["exceptions", { ...command, ruleId: "WEB-EXC-001", evidenceId: command.idempotencyKey,
      reasonCode: "test", expiresAt: "bad" }],
  ] as const) {
    const response = await post(suffix, body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});
test("malformed JSON, deeply unexpected fields and oversized JSON/urlencoded bodies have safe coded errors", async () => {
  for (const [contentType, body, status] of [
    ["application/json", '{"expectedRevision":', 400],
    ["application/json", '{"__proto__":{"actorRole":"admin"}}', 400],
    ["application/json", `{"padding":"${"x".repeat(120_000)}"}`, 413],
    ["application/x-www-form-urlencoded", `padding=${"x".repeat(120_000)}`, 413],
    ["text/plain", "x".repeat(17_000), 413],
  ] as const) {
    const response = await fetch(`${origin}${root}/evaluations`, {
      method: "POST", headers: { "content-type": contentType }, body,
    });
    assert.equal(response.status, status);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const text = await response.text();
    assert.equal(JSON.parse(text).error.code, "VALIDATION_ERROR");
    assert.doesNotMatch(text, /<html|<pre|stack|node_modules|at Router/i);
  }
});
test("review cannot acquire authority from query, role, actor, email or provider headers", async () => {
  const endpoint = `${origin}${root}/exceptions/00000000-0000-4000-8000-000000000004/review`;
  for (const [url, headers, body, status] of [
    [`${endpoint}?decision=approved`, {}, "{}", 400],
    [endpoint, { "x-actor-id": command.idempotencyKey }, "{}", 403],
    [endpoint, { "x-actor-role": "admin", "x-provider-provenance": "verified" }, "{}", 403],
    [endpoint, {}, '{"email":"admin@example.invalid"}', 400],
  ] as const) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, status === 403 ? "UNAUTHORIZED" : "VALIDATION_ERROR");
  }
});
test("all 17 actual provider failure categories map to stable non-leaking contract errors", () => {
  const categories: readonly FoundationFailure[] = ["not_configured", "unreachable", "timeout",
    "authentication", "authorization", "rate_limited", "invalid_request", "malformed_response",
    "fingerprint_mismatch", "unsupported_version", "prohibited_environment", "deprecated",
    "expired", "partial", "conflict", "internal_error", "unavailable"];
  assert.equal(categories.length, 17);
  for (const reason of categories) {
    const mapped = classifyWebinarApiError(new FoundationProviderError(reason));
    assert.match(mapped.code, /^[A-Z_]+$/);
    assert.doesNotMatch(mapped.message, /stack|node_modules|http:|raw provider/i);
    if (reason === "not_configured") assert.equal(mapped.code, "PROVIDER_NOT_CONFIGURED");
    if (reason === "unsupported_version") assert.equal(mapped.code, "UNSUPPORTED_GOVERNED_OUTPUT");
    if (["unreachable", "timeout", "rate_limited"].includes(reason)) assert.equal(mapped.code, "PROVIDER_UNAVAILABLE");
    if (["malformed_response", "fingerprint_mismatch"].includes(reason)) assert.equal(mapped.code, "PROVIDER_RESPONSE_INVALID");
  }
  const secret = classifyWebinarApiError(new Error("connection postgres://private:secret@localhost/internal"));
  assert.equal(secret.code, "INTERNAL_ERROR");
  assert.doesNotMatch(secret.message, /secret|postgres/i);
  assert.equal(classifyWebinarApiError(new WebinarApiError("EVALUATION_INCOMPLETE", 422, "re-evaluate")).code,
    "EVALUATION_INCOMPLETE");
});