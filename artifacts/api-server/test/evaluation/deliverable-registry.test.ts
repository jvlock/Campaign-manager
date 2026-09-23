import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DELIVERABLE_BATCH_RULE_IDS } from "../../src/lib/webinar-standard-evaluation";
import { IMPLEMENTED_RULE_IDS } from "../../src/lib/webinar-standard-evaluation/evaluators";
import { SCHEDULING_BATCH_RULE_IDS } from "../../src/lib/webinar-standard-evaluation/scheduling-evaluators";
import { AUDIENCE_BATCH_RULE_IDS } from "../../src/lib/webinar-standard-evaluation/audience-evaluators";
import { RULE_IDS } from "../../src/lib/webinar-standard-catalog/rule-ids.generated";
import type { RuleId } from "../../src/lib/webinar-standard-catalog/types";
import { aggregateWebinarReadiness } from "../../src/lib/webinar-standard-readiness";
import { input } from "../readiness/fixtures";
import { catalog, registry } from "./fixtures";
import { fixture, proof } from "./deliverable-fixtures";

const root = resolve("../..");
const rows = readFileSync(resolve(root, "docs/verification/phase-2a-5-evaluator-coverage-plan.md"), "utf8")
  .split("\n").filter(l => l.startsWith("| WEB-")).map(l => l.split("|").slice(1, -1).map(s => s.trim()));
const batch = rows.filter(row => row[17] === "4").map(row => row[0]!);
const prior: readonly RuleId[] = [...IMPLEMENTED_RULE_IDS, ...SCHEDULING_BATCH_RULE_IDS, ...AUDIENCE_BATCH_RULE_IDS];
test("Deliverables batch exactly equals the 26 coverage-plan rows, never a prefix selection", () => {
  assert.equal(batch.length, 26);
  assert.deepEqual([...DELIVERABLE_BATCH_RULE_IDS].sort(), batch.sort());
});
test("Deliverables registry preserves all prior 68 and has no overlap, unknown, or duplicate IDs", () => {
  assert.equal(prior.length, 68);
  assert.equal(new Set(registry.implementedRuleIds).size, registry.implementedRuleIds.length);
  assert.ok(prior.every(id => registry.implementedRuleIds.includes(id)));
  assert.ok(DELIVERABLE_BATCH_RULE_IDS.every(id => !prior.includes(id) && RULE_IDS.includes(id)));
  assert.equal(registry.entries.length, 94);
  assert.equal(catalog.rules.length, 106);
  assert.equal(registry.unimplementedRuleIds.length, 12);
});
test("Exactly the two Governed Services and ten Completion evaluators remain missing", () => {
  const missing = rows.filter(row => row[17] === "5" || row[17] === "6").map(row => row[0]!).sort();
  assert.deepEqual([...registry.unimplementedRuleIds].sort(), missing);
  assert.ok(batch.every(id => !missing.includes(id)));
});
test("Readiness evaluator coverage derives from the actual new registry", () => {
  const report = aggregateWebinarReadiness(catalog, registry, input({ results: [] }));
  assert.equal(report.coverage.implementedRuleCount, registry.entries.length);
  assert.deepEqual([...report.coverage.missingEvaluatorRuleIds].sort(), [...registry.unimplementedRuleIds].sort());
});
for (const id of DELIVERABLE_BATCH_RULE_IDS) {
  test(`${id}: canonical classifier alone determines failed blocker or advisory behavior`, () => {
    const c = fixture(id); proof(c, id).evidenceStatus = "rejected";
    const result = registry.evaluate(id, c);
    const report = aggregateWebinarReadiness(catalog, registry, input({ results: [result] }));
    const blocker = result.rule.primaryRuleType === "Mandatory blocker" || result.rule.primaryRuleType === "Conditional blocker";
    assert.equal(report.stages.flatMap(s => s.failedBlockers).some(r => r.ruleId === id), blocker);
    assert.equal(report.stages.flatMap(s => s.failedNonBlocking).some(r => r.ruleId === id), !blocker);
  });
  test(`${id}: registry has a unique explicit evaluator and canonical metadata`, () => {
    const entries = registry.entries.filter(e => e.ruleId === id);
    assert.equal(entries.length, 1);
    assert.equal(typeof entries[0]!.evaluate, "function");
    assert.deepEqual(entries[0]!.rule, catalog.rules.find(r => r.ruleId === id));
  });
}
const directory = resolve("src/lib/webinar-standard-evaluation");
const files = readdirSync(directory).filter(f => f.startsWith("deliverable") && f.endsWith(".ts"));
const forbidden = {
  "sending or publishing": /\b(?:sendMail|sendEmail|dispatchEmail|publish|deploy)\s*\(/,
  "provider SDKs or credentials": /(?:@sendgrid|nodemailer|mailgun|aws-sdk|API_KEY|SECRET|credential)/i,
  "database or ORM access": /(?:from\s+["'][^"']*(?:\/db|prisma|drizzle|postgres)|\bexecuteSql\b)/,
  "routes or UI": /(?:express|Router\s*\(|react|\.tsx["'])/,
  "environment access": /(?:process\.env|import\.meta\.env)/,
  "filesystem access": /(?:node:fs|readFile|writeFile|readdir)/,
  "implicit clocks": /(?:Date\.now|new\s+Date\s*\(|Temporal\.Now)/,
  "network capability": /(?:\bfetch\s*\(|node:https?|axios|WebSocket)/,
  "generic prefix or name policy interpreter": /(?:ruleId\.(?:startsWith|split|match)|ruleName\s*===|defaultPass|defaultEvaluator)/,
};
for (const filename of files) {
  for (const [capability, pattern] of Object.entries(forbidden)) {
    test(`${filename}: pure containment excludes ${capability}`, () => {
      assert.doesNotMatch(readFileSync(resolve(directory, filename), "utf8"), pattern);
    });
  }
}
test("Deliverables evaluator module registers all 26 explicit canonical keys with no default fallback", () => {
  const source = readFileSync(resolve(directory, "deliverable-evaluators.ts"), "utf8");
  for (const id of DELIVERABLE_BATCH_RULE_IDS) assert.ok(source.includes(`"${id}": evaluate_${id.replaceAll("-", "_")}`));
  assert.doesNotMatch(source, /default\s*:|new Proxy|\beval\s*\(|new Function/);
});