import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFoundationRequests, foundationFingerprint, validateFoundationResponse,
  FoundationProviderError, SyntheticContractAdapter, knownSyntheticFixtureProvider,
  type FoundationRequest } from "../../src/lib/webinar-foundation";
import { inspectFoundationObservations, resolveFoundationObservations } from "../../src/lib/webinar-foundation-service";
import type { OccurrenceSources } from "../../src/lib/webinar-evaluation-sources";

const cid = "a1111111-1111-4111-8111-111111111111";
const aid = "a2222222-2222-4222-8222-222222222222";
const sid = "a3333333-3333-4333-8333-333333333333";
const mid = "a4444444-4444-4444-8444-444444444444";
const did = "a5555555-5555-4555-8555-555555555555";
const at = new Date("2030-01-01T00:00:00Z");
function sources(): OccurrenceSources {
  return { campaign: { id: cid, name: "Never sent" }, activity: { id: aid, campaign_id: cid,
    activity_type_id: "webinar", type: "Webinar", activity_answers: { objectiveId: "objective_1", audienceId: "audience_1",
      productFamilyId: "product_1" } }, occurrence: { id: sid, campaign_id: cid, activity_id: aid,
      session_date: "2030-02-01", start_time: "10:00", timezone: "UTC", duration_minutes: 60,
      platform: "test", name: "Draft", template_version: "draft" },
    binding: { standard_id: "WEB-STANDARD-001", standard_version: "1.0", revision: 1 },
    communications: [{ id: mid, session_id: sid, key: "invite", effective_scheduled_at: null,
      created_at: "2029-01-01T00:00:00Z" }], applicationCommunications: [{ id: mid, type: "email" }],
    communicationLandingPages: [{ communication_id: mid, landing_page_id: did }],
    destinations: [{ id: did, url: "https://example.org/register" }],
    records: [], participants: [], registrations: [], attendances: [], lifecycleEvents: [],
    lifecycleObligations: [], syntheticExecutions: [], details: [], configurations: [], schedules: [],
    scheduleRules: [], ctas: [], assets: [], communicationCtas: [], landingPageAssets: [], ownership: [],
    legacy: false, development: true, participantTotal: 0, participantRemaining: 0 };
}
function response(r: FoundationRequest) {
  const byType = {
    taxonomy: { type: "taxonomy", classifications: [{ id: "webinar", label: "Webinar" }] },
    internal_title: { type: "internal_title", title: "Fixture-issued title", components: { activity: "webinar" } },
    campaign_code: { type: "campaign_code", code: "SIM123", reservation: "simulated" },
    utm: { type: "utm", parameters: { utm_source: "email", utm_medium: "invite", utm_campaign: "SIM123" },
      url: "https://example.org/register?utm_source=email&utm_medium=invite&utm_campaign=SIM123" },
    objective_membership: { type: "objective_membership", decision: true, objectiveId: "objective_1" },
    campaign_exclusion: { type: "campaign_exclusion", decision: false, audienceId: "audience_1" },
  };
  return { status: "success", type: r.type, environment: "synthetic", scope: r.scope,
    serviceId: "fixture", serviceVersion: "synthetic-v1", taxonomyVersion: "synthetic-tax-v1",
    requestReference: r.requestReference, inputFingerprint: r.inputFingerprint,
    respondedAt: "2025-12-31T00:00:00Z", validFrom: "2025-12-30T00:00:00Z",
    expiresAt: "2031-01-01T00:00:00Z", deprecated: false,
    provenance: { adapter: "synthetic-contract", reference: "fixture-1" },
    warnings: [], errors: [], output: byType[r.type] };
}
const versions = { serviceVersion: "synthetic-v1", taxonomyVersion: "synthetic-tax-v1" };
const rejected = (fn: () => unknown, reason: string) => assert.throws(fn, e => e instanceof FoundationProviderError && e.reason === reason);

test("builders are deterministic, scope-bound, do not use display labels or participant data", () => {
  const a = sources(), one = buildFoundationRequests(a), two = buildFoundationRequests(a);
  assert.deepEqual(one, two);
  assert.deepEqual(one.map(r => r.type), ["taxonomy", "internal_title", "campaign_code", "objective_membership", "campaign_exclusion", "utm"]);
  assert.equal(one[5]?.scope.communicationId, mid);
  assert.equal(one[5]?.scope.destinationId, did);
  assert.equal(JSON.stringify(one).includes("Never sent"), false);
  a.participants.push({ email: "private@example.org" });
  a.campaign.name = "Different display";
  assert.deepEqual(buildFoundationRequests(a), one);
  assert.equal(JSON.stringify(one).includes("private@example.org"), false);
  a.activity.activity_answers = { objectiveId: "objective_2" };
  assert.notEqual(buildFoundationRequests(a)[0]?.inputFingerprint, one[0]?.inputFingerprint);
  assert.equal(foundationFingerprint({ a: 1, b: 2 }), foundationFingerprint({ b: 2, a: 1 }));
});

test("six independent types validate against their exact request scopes", () => {
  for (const r of buildFoundationRequests(sources())) {
    const valid = validateFoundationResponse(response(r), r, versions, at);
    assert.equal(valid.type, r.type);
    assert.equal(valid.output?.type, r.type);
  }
});

test("untrusted response rejects malformed, incomplete, partial and unknown fields", () => {
  const r = buildFoundationRequests(sources())[0]!, valid = response(r);
  rejected(() => validateFoundationResponse({ ...valid, random: 1 }, r, versions, at), "malformed_response");
  rejected(() => validateFoundationResponse({ ...valid, output: null }, r, versions, at), "partial");
  rejected(() => validateFoundationResponse({ ...valid, status: "partial" }, r, versions, at), "partial");
  rejected(() => validateFoundationResponse({ ...valid, provenance: null }, r, versions, at), "malformed_response");
  rejected(() => validateFoundationResponse({ ...valid, output: { type: "taxonomy", classifications: [{ id: "unmapped", label: "Webinar" }] } }, r, versions, at), "invalid_request");
});

test("fingerprint, scope, environment, version and expiry fail closed", () => {
  const r = buildFoundationRequests(sources())[0]!, valid = response(r);
  rejected(() => validateFoundationResponse({ ...valid, inputFingerprint: "0".repeat(64) }, r, versions, at), "fingerprint_mismatch");
  rejected(() => validateFoundationResponse({ ...valid, scope: { ...r.scope, occurrenceId: cid } }, r, versions, at), "invalid_request");
  rejected(() => validateFoundationResponse({ ...valid, environment: "production" }, r, versions, at), "malformed_response");
  rejected(() => validateFoundationResponse({ ...valid, serviceVersion: "old" }, r, versions, at), "unsupported_version");
  rejected(() => validateFoundationResponse({ ...valid, deprecated: true }, r, versions, at), "deprecated");
  rejected(() => validateFoundationResponse({ ...valid, expiresAt: "2029-12-31T00:00:00Z" }, r, versions, at), "expired");
});

test("transport arrives after fixed evaluation instant without moving as-of; future facts and actual expiry fail closed", () => {
  const r = buildFoundationRequests(sources())[0]!, valid = response(r);
  const asOf = new Date("2026-01-01T00:00:00Z");
  const receivedAt = new Date("2026-09-25T00:00:00Z");
  const later = { ...valid, respondedAt: "2026-09-24T00:00:00Z",
    validFrom: "2025-12-30T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z" };
  assert.equal(validateFoundationResponse(later, r, versions, asOf, receivedAt).respondedAt, later.respondedAt);
  rejected(() => validateFoundationResponse({ ...later, respondedAt: "2026-09-26T00:00:00Z" },
    r, versions, asOf, receivedAt), "invalid_request");
  rejected(() => validateFoundationResponse({ ...later, validFrom: "2026-02-01T00:00:00Z" },
    r, versions, asOf, receivedAt), "expired");
  rejected(() => validateFoundationResponse({ ...later, expiresAt: "2026-07-01T00:00:00Z" },
    r, versions, asOf, receivedAt), "expired");
});

test("structured provider failures preserve distinct safe codes without copying messages", () => {
  const r = buildFoundationRequests(sources())[0]!, valid = response(r);
  for (const code of ["authentication", "authorization", "rate_limited", "invalid_request", "timeout", "unreachable", "internal_error"]) {
    rejected(() => validateFoundationResponse({ ...valid, status: "error", output: null,
      errors: [{ code }] }, r, versions, at), code);
  }
  rejected(() => validateFoundationResponse({ ...valid, status: "unavailable", output: null,
    errors: [] }, r, versions, at), "unavailable");
});

test("unsafe destination URLs remain explicit unavailable targets without transmitting secrets", () => {
  for (const url of ["https://user:password@example.org/register", "https://example.org/?token=secret", "http://example.org"]) {
    const s = sources(); s.destinations[0]!.url = url;
    const utm = buildFoundationRequests(s).find(r => r.type === "utm");
    assert.equal(utm?.input.destinationState, "invalid");
    assert.equal(utm?.input.destinationUrl, null);
    assert.equal(JSON.stringify(utm).includes("secret"), false);
  }
  const r = buildFoundationRequests(sources()).at(-1)!;
  rejected(() => validateFoundationResponse({ ...response(r), output: { ...response(r).output,
    url: "https://other.example/register?utm_source=email&utm_medium=invite&utm_campaign=SIM123" } },
  r, versions, at), "invalid_request");
});

test("every communication has an explicit UTM target, even missing or ambiguous destinations", () => {
  for (const links of [[], [{ communication_id: mid, landing_page_id: did },
    { communication_id: mid, landing_page_id: cid }]]) {
    const s = sources(); s.communicationLandingPages = links;
    const utm = buildFoundationRequests(s).find(r => r.type === "utm")!;
    assert.equal(utm.input.destinationState, links.length ? "ambiguous" : "missing");
    assert.equal(utm.input.destinationUrl, null);
    assert.equal(utm.scope.communicationId, mid);
  }
});

test("governed UTM query must match structured parameters exactly without extra or duplicate keys", () => {
  const r = buildFoundationRequests(sources()).find(r => r.type === "utm")!;
  const valid = response(r);
  for (const extra of ["&extra=1", "&utm_source=email", "&utm_Source=email", "#repaired"]) {
    rejected(() => validateFoundationResponse({ ...valid, output: { ...valid.output,
      url: (valid.output as { url: string }).url + extra } }, r, versions, at), "invalid_request");
  }
  rejected(() => validateFoundationResponse({ ...valid, output: { ...valid.output,
    parameters: { utm_source: "EMAIL", utm_medium: "invite", utm_campaign: "SIM123" } } },
  r, versions, at), "invalid_request");
});

test("provider diagnostics are allowlisted, oversized guidance clamped at source", () => {
  const r = buildFoundationRequests(sources())[0]!, valid = response(r);
  rejected(() => validateFoundationResponse({ ...valid, warnings: ["secret-token"], errors: [] }, r, versions, at), "malformed_response");
  rejected(() => validateFoundationResponse({ ...valid, status: "error", output: null,
    errors: [{ code: "secret-token" }] }, r, versions, at), "malformed_response");
  assert.equal(new FoundationProviderError("rate_limited", Number.MAX_SAFE_INTEGER).retryAfterMs, 2000);
  assert.equal(new FoundationProviderError("rate_limited", -10).retryAfterMs, 0);
});

test("late async fixture resolution and rejection cannot satisfy aborted request", async () => {
  for (const rejectLate of [false, true]) {
    let finish!: (value: unknown) => void, fail!: (reason: unknown) => void;
    const provider = new SyntheticContractAdapter(versions.serviceVersion, versions.taxonomyVersion,
      (_request, signal) => {
        assert.equal(signal.aborted, false);
        return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      });
    const abort = new AbortController();
    const request = provider.request(buildFoundationRequests(sources())[0]!, abort.signal);
    await Promise.resolve();
    abort.abort();
    await assert.rejects(request, e => e instanceof FoundationProviderError && e.reason === "timeout");
    if (rejectLate) fail(new Error("hidden sensitive diagnostic"));
    else finish(response(buildFoundationRequests(sources())[0]!));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
});

test("service distinguishes unavailable and configured reachable synthetic without writing on failure", async () => {
  const s = sources(), writes: unknown[] = [];
  const transaction = { append: async (v: unknown) => { writes.push(v); return { id: sid, revision: 1 + writes.length }; } };
  const args = { sources: s, client: { query: async () => ({ rowCount: 0 }) }, transaction,
    actorId: cid, calculationAt: at.toISOString(), releaseFingerprint: "a".repeat(64) };
  const unavailable = await resolveFoundationObservations(args as never);
  assert.equal(unavailable.inspection.connectorConfigured, false);
  assert.equal(unavailable.inspection.observationAvailable, false);
  assert.equal(writes.length, 0);
  const provider = new SyntheticContractAdapter(versions.serviceVersion, versions.taxonomyVersion, r => response(r));
  const resolved = await resolveFoundationObservations({ ...args, provider } as never);
  assert.equal(resolved.inspection.connectorReachable, true);
  assert.equal(resolved.inspection.liveProductionConnection, false);
  assert.equal(resolved.receipts.length, 6);
  assert.equal(writes.length, 6);
  assert.ok(writes.every(w => (w as { payload: { governedReceipt: { simulationOnly: boolean } } }).payload.governedReceipt.simulationOnly));
});

test("server-known synthetic fixture supplies only its known webinar taxonomy, never naming/code/UTM readiness", async () => {
  const provider = knownSyntheticFixtureProvider();
  const s = sources(), writes: unknown[] = [];
  const result = await resolveFoundationObservations({ sources: s,
    client: { query: async () => ({ rowCount: 0 }) },
    transaction: { append: async (v: unknown) => { writes.push(v); return { id: mid, revision: 1 + writes.length }; } },
    actorId: cid, calculationAt: "2026-01-01T00:00:00Z", releaseFingerprint: "a".repeat(64), provider } as never);
  assert.equal(result.inspection.contractLabel, "synthetic-contract-only");
  assert.deepEqual(result.receipts.map(r => r.request.type), ["taxonomy"]);
  assert.equal(result.inspection.observationAvailable, true);
  assert.equal(result.inspection.liveProductionConnection, false);
  assert.equal(writes.length, 1);
  assert.ok(result.inspection.observations.filter(o => o.type !== "taxonomy").every(o => o.status === "unavailable"));
});

test("inspection checks original receipt transport timestamp and current validity without moving fixed as-of", async () => {
  const s = sources(), records: unknown[] = [], provider = knownSyntheticFixtureProvider();
  const fixedAsOf = new Date(Date.now() - 1000);
  const args = { sources: s, client: { query: async () => ({ rowCount: 0 }) },
    transaction: { append: async (value: unknown) => {
      records.push(value); return { id: mid, revision: records.length + 1 };
    } }, actorId: cid, calculationAt: fixedAsOf.toISOString(), releaseFingerprint: "a".repeat(64), provider };
  const first = await resolveFoundationObservations(args as never);
  assert.equal(first.inspection.observations.find(o => o.type === "taxonomy")?.status, "available");
  s.records = records.map((row, i) => ({ id: mid, revision: i + 2, kind: "source",
    actor_id: cid, parent_id: null, payload: (row as { payload: Record<string, unknown> }).payload,
    recorded_at: new Date().toISOString(), calculation_at: fixedAsOf.toISOString() }));
  const receipt = s.records[0]!.payload.governedReceipt as { receivedAt: string; response: { respondedAt: string } };
  assert.ok(Date.parse(receipt.response.respondedAt) > fixedAsOf.getTime());
  assert.ok(Date.parse(receipt.receivedAt) >= Date.parse(receipt.response.respondedAt));
  const inspection = inspectFoundationObservations(s, fixedAsOf, provider, args.releaseFingerprint);
  assert.equal(inspection.observations.find(o => o.type === "taxonomy")?.status, "available");
  const reused = await resolveFoundationObservations(args as never);
  assert.equal(reused.inspection.observations.find(o => o.type === "taxonomy")?.source, "immutable-history");
  assert.equal(reused.receipts[0]?.receivedAt, receipt.receivedAt);
  assert.equal(records.length, 1);
  receipt.receivedAt = new Date(Date.parse(receipt.response.respondedAt) - 60_000).toISOString();
  const invalid = inspectFoundationObservations(s, fixedAsOf, provider, args.releaseFingerprint);
  assert.equal(invalid.observations.find(o => o.type === "taxonomy")?.error, "invalid_request");
});

test("inspection is read-only and history is only reused with matching versions, input and validity", async () => {
  const s = sources(), records: unknown[] = [];
  const provider = new SyntheticContractAdapter(versions.serviceVersion, versions.taxonomyVersion, r => response(r));
  const args = { sources: s, client: { query: async () => ({ rowCount: 0 }) },
    transaction: { append: async (v: unknown) => { records.push(v); return { id: mid, revision: records.length + 1 }; } },
    actorId: cid, calculationAt: at.toISOString(), releaseFingerprint: "a".repeat(64), provider };
  await resolveFoundationObservations(args as never);
  const initialWrites = records.length;
  s.records = records.map((r, i) => ({ id: mid, revision: i + 2, kind: "source",
    actor_id: cid, parent_id: null, payload: (r as { payload: Record<string, unknown> }).payload,
    recorded_at: at.toISOString(), calculation_at: at.toISOString() }));
  const inspection = inspectFoundationObservations(s, at, provider);
  assert.equal(inspection.observations.filter(o => o.source === "immutable-history").length, 6);
  assert.equal(records.length, initialWrites);
  const reused = await resolveFoundationObservations(args as never);
  assert.equal(reused.inspection.observations.filter(o => o.source === "immutable-history").length, 6);
  assert.equal(records.length, initialWrites);
  const changed = sources(); changed.activity.activity_answers = { objectiveId: "different_objective" };
  changed.records = s.records;
  assert.equal(inspectFoundationObservations(changed, at, provider).observationAvailable, false);
  const oldVersion = new SyntheticContractAdapter("new-version", versions.taxonomyVersion, r => response(r));
  assert.equal(inspectFoundationObservations(s, at, oldVersion).observationAvailable, false);
  assert.equal(inspectFoundationObservations(s, new Date("2032-01-01T00:00:00Z"), provider).observations[0]?.status, "expired");
});

test("release changes require new receipt, and conflicting historical same-input output fails closed", async () => {
  const s = sources(), records: unknown[] = [];
  const provider = new SyntheticContractAdapter(versions.serviceVersion, versions.taxonomyVersion, r => response(r));
  const args = { sources: s, client: { query: async () => ({ rowCount: 0 }) },
    transaction: { append: async (v: unknown) => { records.push(v); return { id: mid, revision: records.length + 1 }; } },
    actorId: cid, calculationAt: at.toISOString(), releaseFingerprint: "a".repeat(64), provider };
  await resolveFoundationObservations(args as never);
  s.records = records.map((r, i) => ({ id: mid, revision: i + 2, kind: "source", actor_id: cid,
    parent_id: null, payload: (r as { payload: Record<string, unknown> }).payload,
    recorded_at: at.toISOString(), calculation_at: at.toISOString() }));
  const otherRelease = await resolveFoundationObservations({ ...args, releaseFingerprint: "b".repeat(64) } as never);
  assert.equal(otherRelease.inspection.observations.filter(o => o.source === "immutable-history").length, 0);
  assert.equal(otherRelease.persistedIds.length, 6);
  const changed = new SyntheticContractAdapter(versions.serviceVersion, versions.taxonomyVersion, r =>
    r.type === "internal_title" ? { ...response(r), output: {
      type: "internal_title", title: "Conflicting result", components: { activity: "webinar" },
    } } : response(r));
  const conflict = await resolveFoundationObservations({ ...args, provider: changed, fresh: true } as never);
  assert.equal(conflict.inspection.observations.find(o => o.type === "internal_title")?.error, "conflict");
  const expiredConflict = new SyntheticContractAdapter(versions.serviceVersion, versions.taxonomyVersion, r => ({
    ...response(r), respondedAt: "2026-01-01T00:00:00Z", validFrom: "2025-12-30T00:00:00Z",
    expiresAt: "2033-01-01T00:00:00Z",
    output: r.type === "internal_title" ? { type: "internal_title", title: "Conflicting after expiry",
      components: { activity: "webinar" } } : response(r).output,
  }));
  const late = await resolveFoundationObservations({ ...args, provider: expiredConflict,
    calculationAt: "2032-01-01T00:00:00Z" } as never);
  assert.equal(late.inspection.observations.find(o => o.type === "internal_title")?.error, "conflict");
});

test("validation errors are not retried; transient timeout bounded to three attempts", async () => {
  const s = sources(), args = { sources: s, client: { query: async () => ({ rowCount: 0 }) },
    transaction: { append: async () => { throw new Error("must not write"); } },
    actorId: cid, calculationAt: at.toISOString(), releaseFingerprint: "a".repeat(64) };
  let invalidCalls = 0;
  const invalid = new SyntheticContractAdapter(versions.serviceVersion, versions.taxonomyVersion, r => {
    invalidCalls++; return { ...response(r), inputFingerprint: "0".repeat(64) };
  });
  const failed = await resolveFoundationObservations({ ...args, provider: invalid } as never);
  assert.equal(invalidCalls, 6);
  assert.ok(failed.inspection.observations.every(o => o.error === "fingerprint_mismatch"));
  let timeoutCalls = 0;
  const timeout = new SyntheticContractAdapter(versions.serviceVersion, versions.taxonomyVersion, () => {
    timeoutCalls++; throw new FoundationProviderError("timeout");
  });
  const timed = await resolveFoundationObservations({ ...args, provider: timeout } as never);
  assert.equal(timeoutCalls, 18);
  assert.ok(timed.inspection.observations.every(o => o.error === "timeout"));
});

test("authentication and authorization failures are never blindly retried", async () => {
  const s = sources(), args = { sources: s, client: { query: async () => ({ rowCount: 0 }) },
    transaction: { append: async () => { throw new Error("must not write"); } },
    actorId: cid, calculationAt: at.toISOString(), releaseFingerprint: "a".repeat(64) };
  for (const reason of ["authentication", "authorization"] as const) {
    let calls = 0;
    const provider = new SyntheticContractAdapter(versions.serviceVersion, versions.taxonomyVersion, () => {
      calls++; throw new FoundationProviderError(reason);
    });
    const result = await resolveFoundationObservations({ ...args, provider } as never);
    assert.equal(calls, 6);
    assert.ok(result.inspection.observations.every(o => o.error === reason));
  }
});