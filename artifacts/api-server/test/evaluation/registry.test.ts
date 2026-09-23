import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuleId } from "../../src/lib/webinar-standard-catalog/types";
import { createWebinarEvaluatorRegistry } from "../../src/lib/webinar-standard-evaluation/registry";
import { catalog, makeCommunication, makeContext, registry } from "./fixtures";

const approvedImplementedIds = [
  "WEB-REC-005", "WEB-REC-008", "WEB-REC-011", "WEB-WIN-006",
  "WEB-FU-INT-001", "WEB-FU-VAR-001", "WEB-FU-UNK-002",
  "WEB-QA-003", "WEB-QA-004", "WEB-QA-005", "WEB-QA-006",
  "WEB-SETUP-C07", "WEB-RDY-REC-002", "WEB-RDY-REC-008", "WEB-RDY-RUN-001",
  "WEB-SETUP-001", "WEB-SETUP-002", "WEB-SETUP-004", "WEB-SETUP-005",
  "WEB-SETUP-006", "WEB-SETUP-007", "WEB-SETUP-008", "WEB-SETUP-009",
  "WEB-SETUP-010", "WEB-SETUP-011", "WEB-SETUP-013", "WEB-SETUP-014",
  "WEB-SETUP-015", "WEB-SETUP-016", "WEB-SETUP-017", "WEB-SETUP-018",
  "WEB-SETUP-020", "WEB-SETUP-C01", "WEB-SETUP-C05", "WEB-RDY-REC-001",
  "WEB-RDY-REC-007", "WEB-QA-008", "WEB-MEAS-001",
] as const satisfies readonly RuleId[];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

test("published coverage is exactly the approved 38 and remaining 68 of 106", () => {
  assert.equal(catalog.rules.length, 106);
  assert.equal(registry.implementedRuleIds.length, 38);
  assert.equal(registry.unimplementedRuleIds.length, 68);
  assert.deepEqual([...registry.implementedRuleIds].sort(), [...approvedImplementedIds].sort());
  const implemented = new Set(registry.implementedRuleIds);
  assert.equal(implemented.size, 38);
  assert.equal(new Set(registry.unimplementedRuleIds).size, 68);
  assert.ok(registry.unimplementedRuleIds.every((id) => !implemented.has(id)));
  assert.deepEqual(
    [...registry.implementedRuleIds, ...registry.unimplementedRuleIds].sort(),
    catalog.rules.map((rule) => rule.ruleId).sort(),
  );
  assert.equal(new Set(registry.entries.map((entry) => entry.ruleId)).size, registry.entries.length);
  assert.deepEqual(registry.entries.map((entry) => entry.ruleId).sort(), [...approvedImplementedIds].sort());
});

test("unknown runtime IDs throw instead of becoming pass or unimplemented", () => {
  for (const unknownId of ["WEB-DOES-NOT-EXIST", "", null, "toString", "__proto__"]) {
    assert.throws(() => Reflect.apply(registry.evaluate, registry, [unknownId, makeContext()]));
  }
});

test("all unimplemented rules return explicit unimplemented findings, including UNK-001/003", () => {
  assert.ok(registry.unimplementedRuleIds.includes("WEB-FU-UNK-001"));
  assert.ok(registry.unimplementedRuleIds.includes("WEB-FU-UNK-003"));
  for (const id of registry.unimplementedRuleIds) {
    const result = registry.evaluate(id, makeContext());
    assert.equal(result.status, "unimplemented", id);
    assert.equal(result.reason, "not_implemented", id);
    assert.notEqual(result.status, "pass");
  }
});

test("every result reuses exact canonical metadata and identity, without interpreting exceptions", () => {
  for (const canonical of catalog.rules) {
    const result = registry.evaluate(canonical.ruleId, makeContext());
    assert.equal(result.mode, "descriptive_only");
    assert.equal(result.standardId, catalog.standardId);
    assert.equal(result.standardVersion, catalog.standardVersion);
    assert.equal(result.ruleId, canonical.ruleId);
    assert.deepEqual(result.rule, canonical);
    assert.equal(result.rule.failureMessage, canonical.failureMessage);
    assert.equal(result.rule.resolutionGuidance, canonical.resolutionGuidance);
    assert.equal(result.participantId, "participant-1");
    assert.ok(result.evidence.every((evidence) => typeof evidence === "string"));
  }
  const context = makeContext();
  const result = registry.evaluate("WEB-FU-VAR-001", {
    ...context,
    followUp: { ...context.followUp, distinctContentConfirmation: { confirmed: false, evidence: "Reviewer rejected content distinction." } },
  });
  assert.equal(result.rule.exceptionEligible, true);
  assert.equal(result.status, "fail");
  assert.equal(registry.evaluate("WEB-QA-003", { ...context, participant: null }).participantId, null);
});

test("registry entries retain canonical records and return the same result as registry evaluate", () => {
  for (const entry of registry.entries) {
    assert.deepEqual(entry.rule, catalog.rules.find((rule) => rule.ruleId === entry.ruleId));
    assert.deepEqual(entry.evaluate(makeContext()), registry.evaluate(entry.ruleId, makeContext()));
  }
});

test("every evaluator is deterministic and leaves all nested caller data unchanged", () => {
  const context = makeContext();
  const input = deepFreeze({ ...context, communications: [makeCommunication()] });
  const before = structuredClone(input);
  for (const rule of catalog.rules) {
    const first = registry.evaluate(rule.ruleId, input);
    assert.deepEqual(registry.evaluate(rule.ruleId, input), first, rule.ruleId);
    assert.deepEqual(input, before, rule.ruleId);
  }
});

test("registry, published arrays, entries and returned findings are frozen", () => {
  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(registry.entries));
  assert.ok(Object.isFrozen(registry.implementedRuleIds));
  assert.ok(Object.isFrozen(registry.unimplementedRuleIds));
  for (const entry of registry.entries) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.rule));
  }
  for (const rule of catalog.rules) {
    const result = registry.evaluate(rule.ruleId, makeContext());
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.evidence));
    assert.ok(Object.isFrozen(result.rule));
  }
});

test("malformed catalogs are rejected at the registry boundary", () => {
  for (const malformed of [
    null,
    {},
    { ...catalog, rules: catalog.rules.slice(1) },
    { ...catalog, rules: [...catalog.rules.slice(1), catalog.rules[1]] },
    { ...catalog, standardId: "OTHER-STANDARD" },
    { ...catalog, rules: catalog.rules.map((rule, index) => index === 0 ? { ...rule, expectedBehavior: "" } : rule) },
  ]) {
    assert.throws(() => Reflect.apply(createWebinarEvaluatorRegistry, undefined, [malformed]));
  }
});

test("fixture calls return independently owned nested objects", () => {
  const first = makeContext();
  const second = makeContext();
  assert.deepEqual(first, second);
  assert.notEqual(first.event, second.event);
  assert.notEqual(first.participant, second.participant);
  assert.notEqual(first.communications, second.communications);
  assert.notEqual(first.governance.internalName, second.governance.internalName);
  assert.notEqual(first.governance.taxonomyValues, second.governance.taxonomyValues);
  assert.notEqual(first.followUp.attended, second.followUp.attended);
  assert.notEqual(first.consent.confirmation, second.consent.confirmation);
  assert.notEqual(makeCommunication().recipientIds, makeCommunication().recipientIds);
  assert.notEqual(makeCommunication().utm, makeCommunication().utm);
});