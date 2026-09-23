import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { RuleId } from "../../src/lib/webinar-standard-catalog/types";
import {
  AUDIENCE_BATCH_RULE_IDS, DELIVERABLE_BATCH_RULE_IDS,
  FOLLOW_UP_COMPLETION_RULE_IDS, COMPLETION_STAGE_RULE_IDS, COMPLETION_DONE_RULE_IDS,
} from "../../src/lib/webinar-standard-evaluation/index";
import { createWebinarEvaluatorRegistry } from "../../src/lib/webinar-standard-evaluation/registry";
import { SCHEDULING_BATCH_RULE_IDS } from "../../src/lib/webinar-standard-evaluation/scheduling-evaluators";
import { SETUP_BATCH_RULE_IDS } from "../../src/lib/webinar-standard-evaluation/setup-evaluators";
import { catalog, makeCommunication, makeContext, registry } from "./fixtures";

const originalImplementedIds = [
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
const priorImplementedIds = [...originalImplementedIds, ...SCHEDULING_BATCH_RULE_IDS] as const;
const approvedBaselineIds = [...priorImplementedIds, ...AUDIENCE_BATCH_RULE_IDS] as const;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

test("published coverage is the approved baseline plus exact Batches 4, 5 and 6", async () => {
  const plan = await readFile(
    new URL("../../../../docs/verification/phase-2a-5-evaluator-coverage-plan.md", import.meta.url), "utf8",
  );
  const rows = plan.split("\n").filter((line) => line.startsWith("| WEB-"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  const batch4 = rows.filter((cells) => cells[17] === "4").map((cells) => cells[0]);
  const batch5 = rows.filter((cells) => cells[17] === "5").map((cells) => cells[0]);
  const batch6 = rows.filter((cells) => cells[17] === "6").map((cells) => cells[0]);
  const expectedImplementedIds = [...approvedBaselineIds, ...batch4, ...batch5, ...batch6];
  assert.equal(catalog.rules.length, 106);
  assert.equal(registry.implementedRuleIds.length, expectedImplementedIds.length);
  assert.equal(registry.unimplementedRuleIds.length, catalog.rules.length - expectedImplementedIds.length);
  assert.deepEqual([...registry.implementedRuleIds].sort(), expectedImplementedIds.sort());
  const implemented = new Set(registry.implementedRuleIds);
  assert.equal(implemented.size, registry.implementedRuleIds.length);
  assert.equal(new Set(registry.unimplementedRuleIds).size, registry.unimplementedRuleIds.length);
  assert.ok(registry.unimplementedRuleIds.every((id) => !implemented.has(id)));
  assert.deepEqual(
    [...registry.implementedRuleIds, ...registry.unimplementedRuleIds].sort(),
    catalog.rules.map((rule) => rule.ruleId).sort(),
  );
  assert.equal(new Set(registry.entries.map((entry) => entry.ruleId)).size, registry.entries.length);
  assert.deepEqual(registry.entries.map((entry) => entry.ruleId).sort(), expectedImplementedIds.sort());
});

test("Governed Services Batch 5 preserves the prior 94 and Completion Batch 6 is exactly the final ten", async () => {
  const plan = await readFile(
    new URL("../../../../docs/verification/phase-2a-5-evaluator-coverage-plan.md", import.meta.url), "utf8",
  );
  const rows = plan.split("\n").filter((line) => line.startsWith("| WEB-"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  const batch = (number: string) => rows.filter((row) => row[17] === number).map((row) => row[0]);
  const batch4 = batch("4");
  const batch5 = batch("5");
  const batch6 = batch("6");
  const baseline = new Set<RuleId>(approvedBaselineIds);
  const prior94 = new Set<RuleId>([...approvedBaselineIds, ...batch4] as RuleId[]);
  const prior96 = new Set<RuleId>([...prior94, ...batch5] as RuleId[]);
  const added = registry.implementedRuleIds.filter((id) => !prior96.has(id));
  const canonical = new Set(catalog.rules.map((rule) => rule.ruleId));

  assert.equal(baseline.size, 68);
  assert.equal(batch4.length, 26);
  assert.equal(new Set(batch4).size, 26);
  assert.equal(DELIVERABLE_BATCH_RULE_IDS.length, 26);
  assert.equal(new Set(DELIVERABLE_BATCH_RULE_IDS).size, 26);
  assert.deepEqual([...DELIVERABLE_BATCH_RULE_IDS].sort(), batch4.sort());
  assert.ok(batch4.every((id) => prior94.has(id as RuleId)));
  assert.ok(batch4.every((id) => !baseline.has(id as RuleId)));
  assert.ok(batch4.every((id) => canonical.has(id as RuleId)));
  assert.equal(prior94.size, 94);
  assert.ok([...prior94].every((id) => registry.implementedRuleIds.includes(id)));
  assert.equal(batch5.length, 2);
  assert.equal(new Set(batch5).size, 2);
  assert.ok(batch5.every((id) => registry.implementedRuleIds.includes(id as RuleId)));
  assert.ok(batch5.every((id) => !prior94.has(id as RuleId)));
  assert.deepEqual([...batch5].sort(), ["WEB-REC-010", "WEB-SETUP-003"]);
  assert.equal(prior96.size, 96);
  assert.ok([...prior96].every((id) => registry.implementedRuleIds.includes(id)));
  assert.equal(registry.implementedRuleIds.length, 106);
  assert.equal(registry.unimplementedRuleIds.length, 0);
  assert.equal(batch6.length, 10);
  assert.equal(new Set(batch6).size, 10);
  assert.deepEqual([...FOLLOW_UP_COMPLETION_RULE_IDS, ...COMPLETION_STAGE_RULE_IDS, ...COMPLETION_DONE_RULE_IDS].sort(), batch6.sort());
  assert.deepEqual([...added].sort(), batch6.sort());
  assert.deepEqual(registry.unimplementedRuleIds, []);
  assert.equal(new Set([...batch5, ...batch6]).size, 12);
  assert.ok([...batch5, ...batch6].every((id) => canonical.has(id as RuleId)));
});

test("Registrant and Audience Batch 3 is mechanically the exact 15 trimmed plan rows", async () => {
  const plan = await readFile(
    new URL("../../../../docs/verification/phase-2a-5-evaluator-coverage-plan.md", import.meta.url), "utf8",
  );
  const rows = plan.split("\n").filter((line) => line.startsWith("| WEB-"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  const batch3 = rows.filter((cells) => cells[17] === "3").map((cells) => cells[0]);
  assert.equal(batch3.length, 15);
  assert.equal(new Set(batch3).size, 15);
  assert.deepEqual([...AUDIENCE_BATCH_RULE_IDS].sort(), batch3.sort());
  assert.ok(batch3.every((id) => catalog.rules.some((rule) => rule.ruleId === id)));
});

test("Registrant and Audience Batch 3 remains exact while preserving all prior 53 evaluators", () => {
  const canonicalIds = new Set(catalog.rules.map((rule) => rule.ruleId));
  const prior = new Set<RuleId>(priorImplementedIds);
  const audience = new Set<RuleId>(AUDIENCE_BATCH_RULE_IDS);
  assert.equal(prior.size, 53);
  assert.equal(audience.size, 15);
  assert.ok(priorImplementedIds.every((id) => registry.implementedRuleIds.includes(id)));
  assert.ok(AUDIENCE_BATCH_RULE_IDS.every((id) => !prior.has(id)));
  assert.ok(AUDIENCE_BATCH_RULE_IDS.every((id) => canonicalIds.has(id)));
  assert.ok(AUDIENCE_BATCH_RULE_IDS.every((id) => registry.implementedRuleIds.includes(id)));
  assert.equal(new Set([...prior, ...audience]).size, 68);
});

test("Scheduling Batch 2 is mechanically the exact 15 plan rows and preserves exact Batch 1", async () => {
  const plan = await readFile(
    new URL("../../../../docs/verification/phase-2a-5-evaluator-coverage-plan.md", import.meta.url), "utf8",
  );
  const rows = plan.split("\n").filter(line => line.startsWith("| WEB-"))
    .map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
  const batch = (number: string) => rows.filter(row => row[17] === number).map(row => row[0]);
  const batch1 = batch("1");
  const batch2 = batch("2");
  assert.equal(batch1.length, 23);
  assert.equal(new Set(batch1).size, 23);
  assert.equal(batch2.length, 15);
  assert.equal(new Set(batch2).size, 15);
  assert.deepEqual([...SETUP_BATCH_RULE_IDS].sort(), batch1.sort());
  assert.deepEqual([...SCHEDULING_BATCH_RULE_IDS].sort(), batch2.sort());
  assert.ok([...batch1, ...batch2].every(id => catalog.rules.some(rule => rule.ruleId === id)));
  assert.ok(batch2.every(id => !batch1.includes(id)));
});

test("Scheduling Batch 2 remains disjoint, canonical, and preserves the original 38", () => {
  const canonicalIds = new Set(catalog.rules.map(rule => rule.ruleId));
  const original = new Set<RuleId>(originalImplementedIds);
  const scheduling = new Set<RuleId>(SCHEDULING_BATCH_RULE_IDS);
  assert.equal(original.size, 38);
  assert.equal(scheduling.size, 15);
  assert.ok(originalImplementedIds.every(id => registry.implementedRuleIds.includes(id)));
  assert.ok(SCHEDULING_BATCH_RULE_IDS.every(id => !original.has(id)));
  assert.ok(registry.implementedRuleIds.every(id => canonicalIds.has(id)));
  assert.deepEqual(new Set(priorImplementedIds), new Set([...original, ...scheduling]));
  assert.ok([...original, ...scheduling].every((id) => registry.implementedRuleIds.includes(id)));
});

test("unknown runtime IDs throw instead of becoming pass or unimplemented", () => {
  for (const unknownId of ["WEB-DOES-NOT-EXIST", "", null, "toString", "__proto__"]) {
    assert.throws(() => Reflect.apply(registry.evaluate, registry, [unknownId, makeContext()]));
  }
});

test("every canonical rule is explicitly implemented, without a default-pass path", () => {
  assert.equal(registry.unimplementedRuleIds.length, 0);
  for (const id of catalog.rules.map((rule) => rule.ruleId)) {
    const result = registry.evaluate(id, makeContext());
    assert.notEqual(result.status, "unimplemented", id);
    assert.notEqual(result.reason, "not_implemented", id);
  }
  for (const id of [...FOLLOW_UP_COMPLETION_RULE_IDS, ...COMPLETION_STAGE_RULE_IDS, ...COMPLETION_DONE_RULE_IDS]) {
    assert.notEqual(registry.evaluate(id, makeContext()).status, "pass", id);
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