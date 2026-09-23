import assert from "node:assert/strict";
import { test } from "node:test";
import { DELIVERABLE_BATCH_RULE_IDS } from "../../src/lib/webinar-standard-evaluation";
import { aggregateWebinarReadiness } from "../../src/lib/webinar-standard-readiness";
import { exception, input } from "../readiness/fixtures";
import { catalog, registry } from "./fixtures";
import { fixture, now, proof } from "./deliverable-fixtures";

for (const id of DELIVERABLE_BATCH_RULE_IDS) {
  test(`${id}: explicit current produced and verified evidence passes`, () => {
    const c = fixture(id), before = structuredClone(c);
    const r = registry.evaluate(id, c);
    assert.equal(r.status, "pass", JSON.stringify(r));
    assert.deepEqual(c, before);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.evidence) && Object.isFrozen(r.rule));
    assert.equal(r.rule, registry.entries.find(e => e.ruleId === id)!.rule);
  });
  test(`${id}: actual rejected review fails rather than missing`, () => {
    const c = fixture(id); proof(c, id).evidenceStatus = "rejected";
    assert.equal(registry.evaluate(id, c).reason, "violation");
  });
  test(`${id}: no deliverable snapshot is evidence unavailable`, () => {
    const c = fixture(id); c.deliverables = null;
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: explicit unavailable evidence never becomes a pass`, () => {
    const c = fixture(id); proof(c, id).evidenceStatus = "unavailable";
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: incomplete review is not completed QA`, () => {
    const c = fixture(id); proof(c, id).binding.snapshotCompleteness = "partial";
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: non-Webinar activity is explicitly inapplicable`, () => {
    const c = fixture(id); c.deliverables!.activityType = "Conference";
    assert.equal(registry.evaluate(id, c).status, "not_applicable");
  });
  const invalidEvidenceCases = {
    "wrong standard": (e: ReturnType<typeof proof>) => { e.standardId = "OTHER" as never; },
    "wrong exact standard version": (e: ReturnType<typeof proof>) => { e.standardVersion = "old" as never; },
    "wrong rule": (e: ReturnType<typeof proof>) => { e.ruleId = "WEB-SETUP-001"; },
    "wrong webinar": (e: ReturnType<typeof proof>) => { e.scope.eventId = "other"; },
    "wrong occurrence": (e: ReturnType<typeof proof>) => { e.scope.sessionIds = ["other"]; },
    "wrong deliverable": (e: ReturnType<typeof proof>) => { e.scope.deliverableIds = ["other"]; },
    "wrong artifact version": (e: ReturnType<typeof proof>) => { e.binding.artifactVersion = "old"; },
    "stale input snapshot": (e: ReturnType<typeof proof>) => { e.binding.inputSnapshotVersion = "old"; },
    "expired review": (e: ReturnType<typeof proof>) => { e.expiresAtEpochMs = now; },
    "claimed verified identity": (e: ReturnType<typeof proof>) => { e.suppliedBy.identityVerified = true as never; },
    "review before version existed": (e: ReturnType<typeof proof>) => { e.binding.reviewedAtEpochMs = now - 2000; e.validFromEpochMs = now - 2000; },
    "recorded before reviewed": (e: ReturnType<typeof proof>) => { e.suppliedAtEpochMs = now - 200; },
    "future review": (e: ReturnType<typeof proof>) => { e.binding.reviewedAtEpochMs = now + 1; },
    "missing source reference": (e: ReturnType<typeof proof>) => { e.sourceReference = null; },
    "blank review description": (e: ReturnType<typeof proof>) => { e.evidenceDescription = ""; },
  };
  for (const [label, mutate] of Object.entries(invalidEvidenceCases)) {
    test(`${id}: rejects ${label}`, () => {
      const c = fixture(id); mutate(proof(c, id));
      assert.equal(registry.evaluate(id, c).reason, "invalid_context");
    });
  }
  for (const key of ["standardId", "standardVersion", "eventId"] as const) {
    test(`${id}: rejects wrong snapshot ${key}`, () => {
      const c = fixture(id); c.deliverables![key] = "wrong" as never;
      assert.equal(registry.evaluate(id, c).reason, "invalid_context");
    });
  }
  test(`${id}: malformed prerequisite cannot be laundered by valid reviews`, () => {
    const c = fixture(id);
    c.deliverables!.prerequisites.push({ result: {} as never, evidence: { ...proof(c, id), evidenceId: "malformed-prerequisite" } });
    assert.equal(registry.evaluate(id, c).reason, "invalid_context");
  });
  for (const scenario of ["failure", "missing", "invalid"] as const) {
    test(`${id}: ${scenario} remains distinct from an exception record`, () => {
      const c = fixture(id), e = proof(c, id);
      if (scenario === "invalid") e.scope.eventId = "wrong";
      else e.evidenceStatus = scenario === "failure" ? "rejected" : "unavailable";
      const original = registry.evaluate(id, c), record = exception(original.rule);
      const report = aggregateWebinarReadiness(catalog, registry, input({
        results: [original], exceptions: [record], exceptionClaims: [{ ruleId: id, exceptionId: record.exceptionId }],
      }));
      const resolved = report.stages.flatMap(s => s.exceptionResolvedBlockers);
      const eligible = scenario === "failure" && original.rule.exceptionEligible;
      assert.equal(resolved.length, eligible ? 1 : 0);
      if (eligible) assert.deepEqual(resolved[0]!.originalFailure, original);
      if (scenario === "missing") {
        const blocker = original.rule.primaryRuleType === "Mandatory blocker" || original.rule.primaryRuleType === "Conditional blocker";
        const actual = report.stages.flatMap(s => blocker ? s.unassessedBlockers : s.unassessedAdvisories);
        assert.ok(actual.some(r => r.ruleId === id));
      }
    });
  }
}