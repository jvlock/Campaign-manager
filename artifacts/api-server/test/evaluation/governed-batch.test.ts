import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { planWebinarAudience } from "../../src/lib/webinar-standard-audience";
import { GOVERNED_BATCH_RULE_IDS } from "../../src/lib/webinar-standard-evaluation";
import { IMPLEMENTED_RULE_IDS } from "../../src/lib/webinar-standard-evaluation/evaluators";
import { SCHEDULING_BATCH_RULE_IDS, AUDIENCE_BATCH_RULE_IDS, DELIVERABLE_BATCH_RULE_IDS } from "../../src/lib/webinar-standard-evaluation";
import { fixture, observation, now } from "./governed-fixtures";
import { catalog, registry, makeContext } from "./fixtures";

// Deliberately mutable malformed boundary fixtures; production types remain readonly.
type Mutable = any;
for (const id of GOVERNED_BATCH_RULE_IDS) {
  const key = id === "WEB-SETUP-003" ? "objective" : "exclusion";
  function check(name: string, mutate: (c: Mutable, v: Mutable, r: Mutable) => void, status: string, reason?: string) {
    test(`${id}: ${name}`, () => {
      const c: Mutable = structuredClone(fixture(id));
      mutate(c, c.governed[key], c.governed[key].observations[0]);
      const result = registry.evaluate(id, c);
      assert.equal(result.status, status, JSON.stringify(result.evidence));
      if (reason) assert.equal(result.reason, reason);
    });
  }
  check("valid authoritative scoped observation", () => {}, "pass");
  check("missing governed output is unavailable", (_c, v) => { v.observations = []; }, "evidence_unavailable");
  check("source outage is unavailable", (_c, _v, r) => {
    r.status = "unavailable"; r.decision = null; r.outputReference = null; r.unavailableReason = "outage";
  }, "evidence_unavailable");
  check("source error is unavailable", (_c, _v, r) => {
    r.status = "error"; r.decision = null; r.outputReference = null; r.unavailableReason = "error";
  }, "evidence_unavailable");
  for (const [field, value] of Object.entries({
    standardId: "OTHER", standardVersion: "old", source: "manual", capability: "local",
    eventId: "other", campaignId: "other", participantId: "other", objectiveId: "other",
    inputFingerprint: "other", inputVersion: "old", requestReference: "other",
    outputType: "text", sourceVersion: "old", expiresAtEpochMs: now,
    generatedAtEpochMs: now + 1, recordedAtEpochMs: now + 1, validFromEpochMs: "yesterday",
    status: "approved", decision: "yes", outputReference: null,
  })) check(`rejects wrong ${field}`, (_c, _v, r) => { r[field] = value; }, "fail", "invalid_context");
  check("test fixture is not production evidence", c => { c.governed.environment = "production"; }, "fail", "invalid_context");
  check("deprecated source version", (_c, v) => { v.request.expectedSourceVersion.deprecated = true; }, "fail", "invalid_context");
  check("future effective source version", (_c, v) => { v.request.expectedSourceVersion.effectiveFromEpochMs = now + 1; }, "fail", "invalid_context");
  check("expired effective source version", (_c, v) => { v.request.expectedSourceVersion.effectiveThroughEpochMs = now; }, "fail", "invalid_context");
  check("current expected version is explicit", (_c, v) => { delete v.request.expectedSourceVersion; }, "fail", "invalid_context");
  check("copied output without provenance", (_c, _v, r) => { r.provenance = null; }, "fail", "invalid_context");
  check("provenance reference required", (_c, _v, r) => { r.provenance.sourceReference = null; }, "fail", "invalid_context");
  check("supplier identity cannot claim verification", (_c, _v, r) => { r.provenance.suppliedBy.identityVerified = true; }, "fail", "invalid_context");
  check("duplicate receipt IDs", (_c, v, r) => { v.observations.push(structuredClone(r)); }, "fail", "invalid_context");
  check("simultaneous contradictory authoritative observations", (_c, v, r) => {
    v.observations.push({ ...r, observationId: "receipt-2", decision: false });
  }, "fail", "invalid_context");
  check("latest authoritative outage defeats earlier pass", (_c, v, r) => {
    v.observations.push({ ...r, observationId: "receipt-2", generatedAtEpochMs: now - 50,
      recordedAtEpochMs: now - 25, validFromEpochMs: now - 50, status: "error",
      decision: null, outputReference: null, unavailableReason: "outage" });
  }, "evidence_unavailable");
  check("manual approval alone cannot replace governed result", (_c, v, r) => { v.observations = [r.provenance]; }, "fail", "invalid_context");
  check("documented dependency cannot bypass missing output", (_c, v) => { v.observations = []; v.dependency = "approved"; }, "evidence_unavailable");
  check("exception cannot bypass missing output", (c, v) => { v.observations = []; c.exceptions = [{ approved: true }]; }, "evidence_unavailable");
  test(`${id}: canonical non-exception eligibility`, () => assert.equal(catalog.rules.find(r => r.ruleId === id)!.exceptionEligible, false));
  test(`${id}: old generic governance values do not prove service invocation`, () => assert.equal(registry.evaluate(id, makeContext()).status, "evidence_unavailable"));
  test(`${id}: immutable deterministic result and unchanged inputs`, () => {
    const c = fixture(id), before = JSON.stringify(c);
    const first = registry.evaluate(id, c);
    assert.deepEqual(first, registry.evaluate(id, c)); assert.equal(JSON.stringify(c), before);
    assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.evidence));
  });
  check("accessors rejected without execution", (_c, _v, r) => {
    Object.defineProperty(r, "decision", { get() { throw new Error("must not execute"); }, enumerable: true });
  }, "fail", "invalid_context");
}
test("SETUP: valid Foundation nonmembership fails", () => {
  const c: Mutable = fixture("WEB-SETUP-003"); c.governed.objective.observations[0].decision = false;
  assert.equal(registry.evaluate("WEB-SETUP-003", c).reason, "violation");
});
test("SETUP: selected objective exact identity binding", () => {
  const c: Mutable = fixture("WEB-SETUP-003"); c.governed.objective.objectiveId = "other";
  assert.equal(registry.evaluate("WEB-SETUP-003", c).reason, "invalid_context");
});
test("SETUP: non-Webinar not applicable", () => {
  const c: Mutable = fixture("WEB-SETUP-003"); c.setup.activityType = "Other";
  assert.equal(registry.evaluate("WEB-SETUP-003", c).status, "not_applicable");
});
test("SETUP: later authoritative nonmembership overrides earlier membership", () => {
  const c: Mutable = fixture("WEB-SETUP-003");
  c.governed.objective.observations.push({ ...observation("WEB-SETUP-003"), observationId: "later", decision: false,
    generatedAtEpochMs: now - 50, recordedAtEpochMs: now - 25, validFromEpochMs: now - 50 });
  assert.equal(registry.evaluate("WEB-SETUP-003", c).reason, "violation");
});
test("REC: genuine prohibited operational recipient fails", () => {
  const c: Mutable = fixture("WEB-REC-010"); c.governed.exclusion.operational[0].recipientObservations[0].included = true;
  assert.equal(registry.evaluate("WEB-REC-010", c).reason, "violation");
});
function historicalExclusion(clearance: boolean, includedAt: number): Mutable {
  const c: Mutable = structuredClone(fixture("WEB-REC-010"));
  const v = c.governed.exclusion;
  v.operational[0].recipientObservations[0].included = true;
  v.operational[0].recipientObservations[0].scheduledAtEpochMs = includedAt;
  v.observations.push({ ...observation("WEB-REC-010"), observationId: "later",
    generatedAtEpochMs: now - 50, recordedAtEpochMs: now - 25, validFromEpochMs: now - 50, decision: !clearance });
  if (clearance) {
    v.audienceInput.participants[0].governedExclusion = false;
    v.audiencePlan = planWebinarAudience(catalog, v.audienceInput);
  }
  return c;
}
test("REC: later reaffirmation cannot erase an earlier prohibited inclusion", () => {
  assert.equal(registry.evaluate("WEB-REC-010", historicalExclusion(false, now - 500)).reason, "violation");
});
test("REC: clearance after inclusion retains the historical violation", () => {
  assert.equal(registry.evaluate("WEB-REC-010", historicalExclusion(true, now - 500)).reason, "violation");
});
test("REC: clearance before inclusion permits that inclusion without rewriting history", () => {
  assert.equal(registry.evaluate("WEB-REC-010", historicalExclusion(true, now - 10)).status, "pass");
});
test("REC: clearance at inclusion instant ends the prior exclusion interval", () => {
  assert.equal(registry.evaluate("WEB-REC-010", historicalExclusion(true, now - 50)).status, "pass");
});
test("REC: missing historical operational evidence remains unavailable after clearance", () => {
  const c = historicalExclusion(true, now - 500);
  c.governed.exclusion.operational = [];
  assert.equal(registry.evaluate("WEB-REC-010", c).status, "evidence_unavailable");
});
test("REC: reaffirmation cannot narrow operational evidence to hide prior exclusions", () => {
  const c = historicalExclusion(false, now - 500);
  c.governed.exclusion.operational[0].evidence.binding.observationFromEpochMs = now - 50;
  assert.equal(registry.evaluate("WEB-REC-010", c).status, "evidence_unavailable");
});
test("REC: clearance cannot accept incomplete historical operational evidence", () => {
  const c = historicalExclusion(true, now - 500);
  c.governed.exclusion.operational[0].evidence.binding.observationThroughEpochMs = now - 500;
  assert.equal(registry.evaluate("WEB-REC-010", c).status, "evidence_unavailable");
});
for (const id of GOVERNED_BATCH_RULE_IDS) {
  for (const outage of [false, true]) test(`${id}: rejected governed provenance ${outage ? "during outage" : "for success"} is invalid, not business noncompliance`, () => {
    const c: Mutable = structuredClone(fixture(id));
    const r = c.governed[id === "WEB-SETUP-003" ? "objective" : "exclusion"].observations[0];
    r.provenance.evidenceStatus = "rejected";
    if (outage) { r.status = "unavailable"; r.decision = null; r.outputReference = null; r.unavailableReason = "outage"; }
    assert.equal(registry.evaluate(id, c).reason, "invalid_context");
  });
}
test("REC: valid rejected operational evidence still establishes noncompliance", () => {
  const c: Mutable = structuredClone(fixture("WEB-REC-010"));
  c.governed.exclusion.operational[0].evidence.evidenceStatus = "rejected";
  assert.equal(registry.evaluate("WEB-REC-010", c).reason, "violation");
});
test("REC: governed exclusion absent in otherwise valid audience plan fails", () => {
  const c: Mutable = fixture("WEB-REC-010"); const v = c.governed.exclusion;
  v.audienceInput.participants[0].governedExclusion = false; v.audiencePlan = planWebinarAudience(catalog, v.audienceInput);
  assert.equal(registry.evaluate("WEB-REC-010", c).reason, "violation");
});
test("REC: complete authoritative nonapplicability", () => {
  const c: Mutable = fixture("WEB-REC-010"); const v = c.governed.exclusion;
  v.observations[0].decision = false; v.audienceInput.participants[0].governedExclusion = false;
  v.audiencePlan = planWebinarAudience(catalog, v.audienceInput);
  assert.equal(registry.evaluate("WEB-REC-010", c).status, "not_applicable");
});
for (const [name, mutate, status, reason] of [
  ["planner-only is not operational suppression", (v: Mutable) => { v.operational = []; }, "evidence_unavailable", "missing_evidence"],
  ["complete population required", (v: Mutable) => { v.completePopulation = false; }, "evidence_unavailable", "missing_evidence"],
  ["tampered audience result", (v: Mutable) => { v.audiencePlan.participants[0].suppressions = []; }, "fail", "invalid_context"],
  ["wrong communication scope", (v: Mutable) => { v.operational[0].recipientObservations[0].communicationId = "wrong"; }, "fail", "invalid_context"],
  ["incomplete communication scope", (v: Mutable) => { v.operational[0].recipientObservations.pop(); }, "fail", "invalid_context"],
  ["wrong operational scope", (v: Mutable) => { v.operational[0].evidence.scope.participantIds = []; }, "fail", "invalid_context"],
  ["extra person receipt", (v: Mutable) => { v.observations.push({ ...v.observations[0], observationId: "other", participantId: "other" }); }, "fail", "invalid_context"],
] as const) test(`REC: ${name}`, () => {
  const c: Mutable = structuredClone(fixture("WEB-REC-010")); mutate(c.governed.exclusion);
  const r = registry.evaluate("WEB-REC-010", c); assert.equal(r.status, status); assert.equal(r.reason, reason);
});
test("Governed batch exactly reconciles previous 94 and excludes Completion", () => {
  assert.deepEqual(GOVERNED_BATCH_RULE_IDS, ["WEB-SETUP-003", "WEB-REC-010"]);
  const previous = [...IMPLEMENTED_RULE_IDS, ...SCHEDULING_BATCH_RULE_IDS, ...AUDIENCE_BATCH_RULE_IDS, ...DELIVERABLE_BATCH_RULE_IDS];
  assert.equal(previous.length, 94); assert.equal(registry.implementedRuleIds.length, 96);
  assert.equal(registry.unimplementedRuleIds.length, 10);
  assert.equal(new Set(registry.implementedRuleIds).size, 96);
  for (const id of previous) assert.ok(registry.implementedRuleIds.includes(id));
  for (const id of GOVERNED_BATCH_RULE_IDS) assert.ok(!(previous as readonly string[]).includes(id));
  for (const id of registry.implementedRuleIds) assert.ok(catalog.rules.some(r => r.ruleId === id));
  assert.ok(registry.unimplementedRuleIds.every(id => !GOVERNED_BATCH_RULE_IDS.includes(id as never)));
});
const root = fileURLToPath(new URL("../../src/lib/webinar-standard-evaluation/", import.meta.url));
for (const file of readdirSync(root).filter(f => /^governed.*\.ts$/.test(f))) {
  for (const [name, pattern] of Object.entries({
    HTTP: /\b(fetch|axios|https?\.request)\s*\(/, credentials: /(?:apiKey|secretKey|Bearer\s)/,
    environment: /process\.env/, filesystem: /node:fs|from ["']fs/,
    database: /drizzle|@workspace\/db/, routes: /express|Router\(/, UI: /react|\.tsx/,
    sending: /\b(sendMail|sendMessage|publish|deploy)\s*\(/, clock: /Date\.now|new Date\s*\(/,
    fallback: /default.*pass|Proxy\s*\(/,
  })) test(`Governed containment ${file}: no ${name}`, () => assert.doesNotMatch(readFileSync(root + file, "utf8"), pattern));
}