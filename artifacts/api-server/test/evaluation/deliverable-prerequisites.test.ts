import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateWebinarReadiness } from "../../src/lib/webinar-standard-readiness";
import { exception, input } from "../readiness/fixtures";
import { catalog, makeCommunication, registry } from "./fixtures";
import { fixture, now, pre, type Mutable } from "./deliverable-fixtures";
import type { DeliverablePrerequisite } from "../../src/lib/webinar-standard-evaluation/deliverable-types";

const requirements = [
  ["WEB-RDY-REC-003", "WEB-SETUP-011"], ["WEB-RDY-RUN-002", "WEB-SETUP-012"],
  ["WEB-FU-ATT-003", "WEB-SETUP-019"], ["WEB-FU-ABS-003", "WEB-SETUP-019"],
  ["WEB-QA-009", "WEB-QA-001"], ["WEB-QA-009", "WEB-QA-002"], ["WEB-QA-009", "WEB-QA-003"],
  ["WEB-QA-009", "WEB-QA-004"], ["WEB-QA-009", "WEB-QA-005"], ["WEB-QA-009", "WEB-QA-006"],
  ["WEB-QA-009", "WEB-QA-007"], ["WEB-QA-009", "WEB-QA-008"],
] as const;
for (const [id, required] of requirements) {
  test(`${id}: current canonical ${required} prerequisite passes`, () => {
    assert.equal(registry.evaluate(id, fixture(id)).status, "pass");
  });
  test(`${id}: absent ${required} prerequisite cannot silently pass`, () => {
    const c = fixture(id); c.deliverables!.prerequisites = c.deliverables!.prerequisites.filter(p => p.result.ruleId !== required);
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
  for (const status of ["fail", "evidence_unavailable", "unimplemented", "not_applicable"] as const) {
    test(`${id}: ${required} ${status} remains distinct`, () => {
      const c = fixture(id), p = c.deliverables!.prerequisites.find(p => p.result.ruleId === required)!;
      p.result.status = status; p.result.reason = status === "fail" ? "violation" : status === "unimplemented" ? "not_implemented" : status === "not_applicable" ? "condition_not_met" : "missing_evidence";
      const expected = status === "evidence_unavailable" || status === "unimplemented" ? "evidence_unavailable" : "fail";
      assert.equal(registry.evaluate(id, c).status, expected);
    });
  }
  test(`${id}: invalid-context ${required} prerequisite stays malformed`, () => {
    const c = fixture(id), p = c.deliverables!.prerequisites.find(p => p.result.ruleId === required)!;
    p.result.status = "fail"; p.result.reason = "invalid_context";
    assert.equal(registry.evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: duplicate ${required} prerequisite is rejected`, () => {
    const c = fixture(id), p = structuredClone(c.deliverables!.prerequisites.find(p => p.result.ruleId === required)!);
    p.evidence.evidenceId += "-duplicate"; c.deliverables!.prerequisites.push(p);
    assert.equal(registry.evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: stale ${required} prerequisite evidence is rejected`, () => {
    const c = fixture(id), p = c.deliverables!.prerequisites.find(p => p.result.ruleId === required)!;
    p.evidence.binding.inputSnapshotVersion = "old";
    assert.equal(registry.evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: participant-scoped ${required} is not an activity prerequisite`, () => {
    const c = fixture(id), p = c.deliverables!.prerequisites.find(p => p.result.ruleId === required)!;
    p.result.participantId = "someone";
    assert.equal(registry.evaluate(id, c).reason, "invalid_context");
  });
}
for (const required of ["WEB-QA-001", "WEB-QA-002", "WEB-QA-003", "WEB-QA-004", "WEB-QA-005", "WEB-QA-006", "WEB-QA-007", "WEB-QA-008"] as const) {
  for (const offset of [-1, 0, 1]) {
    test(`WEB-QA-009: ${required} confirmation at event-start ${offset} milliseconds`, () => {
      const c = fixture("WEB-QA-009"); c.event.startsAtEpochMs = now - 50;
      const p = c.deliverables!.prerequisites.find(p => p.result.ruleId === required)!;
      p.evidence.binding.reviewedAtEpochMs = now - 50 + offset; p.evidence.suppliedAtEpochMs = now - 50 + offset;
      const final = c.deliverables!.artifacts[0]!.reviews[0]!.evidence;
      // Final review is before the event. A later component cannot be retrospectively approved.
      final.binding.reviewedAtEpochMs = now - 51; final.suppliedAtEpochMs = now - 51;
      assert.equal(registry.evaluate("WEB-QA-009", c).status, offset === -1 ? "pass" : "evidence_unavailable");
    });
  }
}
for (const offset of [-1, 0, 1]) {
  test(`WEB-QA-009: final confirmation at event-start ${offset} milliseconds`, () => {
    const c = fixture("WEB-QA-009"); c.event.startsAtEpochMs = now - 50;
    const final = c.deliverables!.artifacts[0]!.reviews[0]!.evidence;
    final.binding.reviewedAtEpochMs = now - 50 + offset; final.suppliedAtEpochMs = now - 50 + offset;
    assert.equal(registry.evaluate("WEB-QA-009", c).status, offset === -1 ? "pass" : "fail");
  });
}
test("WEB-QA-009: event start is required, never implicitly read from the clock", () => {
  const c = fixture("WEB-QA-009"); c.event.startsAtEpochMs = null;
  assert.equal(registry.evaluate("WEB-QA-009", c).status, "evidence_unavailable");
});
test("WEB-QA-009: a partial checklist cannot claim all applicable QA", () => {
  const c = fixture("WEB-QA-009"); c.deliverables!.complete = false;
  assert.equal(registry.evaluate("WEB-QA-009", c).status, "evidence_unavailable");
});
test("WEB-QA-009: inapplicable waitlist QA is accepted only with explicit waitlist non-use", () => {
  const c = fixture("WEB-QA-009"), p = c.deliverables!.prerequisites.find(p => p.result.ruleId === "WEB-QA-007")!;
  p.result.status = "not_applicable"; p.result.reason = "condition_not_met"; c.deliverables!.facts.waitlistInUse = false;
  assert.equal(registry.evaluate("WEB-QA-009", c).status, "pass");
});
test("WEB-QA-009: unavailable governed UTM prerequisite cannot be replaced by final manual approval or exception", () => {
  const c = fixture("WEB-QA-009"), p = c.deliverables!.prerequisites.find(p => p.result.ruleId === "WEB-QA-005")!;
  p.result.status = "evidence_unavailable"; p.result.reason = "missing_evidence";
  const result = registry.evaluate("WEB-QA-009", c), record = exception(result.rule);
  const report = aggregateWebinarReadiness(catalog, registry, input({
    results: [result], exceptions: [record], exceptionClaims: [{ ruleId: result.ruleId, exceptionId: record.exceptionId }],
  }));
  assert.equal(result.status, "evidence_unavailable");
  assert.equal(report.stages.flatMap(s => s.exceptionResolvedBlockers).length, 0);
});
test("WEB-QA-009: available QA does not silently implement the remaining governed services", () => {
  const c = fixture("WEB-QA-009");
  assert.equal(registry.evaluate("WEB-QA-009", c).status, "pass");
  assert.equal(registry.evaluate("WEB-REC-010", c).status, "unimplemented");
  assert.equal(registry.evaluate("WEB-SETUP-003", c).status, "unimplemented");
});
test("WEB-QA-009: unrelated completion finding is not invented as a QA dependency", () => {
  const c = fixture("WEB-QA-009"), p = structuredClone(pre("WEB-DONE-001")) as Mutable<DeliverablePrerequisite>;
  p.result.status = "unimplemented"; p.result.reason = "not_implemented"; c.deliverables!.prerequisites.push(p);
  assert.equal(registry.evaluate("WEB-QA-009", c).status, "pass");
});
test("WEB-QA-009: empty deliverable communications cannot waive QA-005 for a real communication missing UTM evidence", () => {
  const c = fixture("WEB-QA-009");
  c.communications = [structuredClone(makeCommunication({ utmRequired: true, utm: null })) as Mutable<ReturnType<typeof makeCommunication>>];
  assert.equal(c.deliverables!.communications.length, 0);
  assert.equal(registry.evaluate("WEB-QA-005", c).status, "evidence_unavailable");
  const p = c.deliverables!.prerequisites.find(p => p.result.ruleId === "WEB-QA-005")!;
  p.result.status = "not_applicable"; p.result.reason = "condition_not_met";
  assert.equal(registry.evaluate("WEB-QA-009", c).reason, "violation");
});
test("WEB-QA-009: QA-005 must pass even when both communication inventories are empty", () => {
  const c = fixture("WEB-QA-009");
  assert.equal(registry.evaluate("WEB-QA-005", c).status, "pass");
  const p = c.deliverables!.prerequisites.find(p => p.result.ruleId === "WEB-QA-005")!;
  p.result.status = "not_applicable"; p.result.reason = "condition_not_met";
  assert.equal(registry.evaluate("WEB-QA-009", c).reason, "violation");
});
test("WEB-QA-009: positive generic observation cannot renew final review after a newer component confirmation", () => {
  const c = fixture("WEB-QA-009"), checklist = c.deliverables!.artifacts[0]!;
  const p = c.deliverables!.prerequisites.find(p => p.result.ruleId === "WEB-QA-001")!;
  p.evidence.binding.reviewedAtEpochMs = now - 75; p.evidence.suppliedAtEpochMs = now - 75;
  assert.equal(registry.evaluate("WEB-QA-009", c).status, "evidence_unavailable");
  const observation = structuredClone(checklist.reviews[0]!);
  observation.kind = "observation"; observation.evidence.evidenceId += "-later-observation";
  observation.evidence.binding.reviewedAtEpochMs = now - 50; observation.evidence.suppliedAtEpochMs = now - 50;
  checklist.reviews.push(observation);
  assert.equal(registry.evaluate("WEB-QA-009", c).status, "evidence_unavailable");
});
test("WEB-QA-009: actual renewed final review can confirm a newer component observation", () => {
  const c = fixture("WEB-QA-009"), checklist = c.deliverables!.artifacts[0]!;
  const p = c.deliverables!.prerequisites.find(p => p.result.ruleId === "WEB-QA-001")!;
  p.evidence.binding.reviewedAtEpochMs = now - 75; p.evidence.suppliedAtEpochMs = now - 75;
  const renewed = structuredClone(checklist.reviews[0]!);
  renewed.evidence.evidenceId += "-renewed-review";
  renewed.evidence.binding.reviewedAtEpochMs = now - 50; renewed.evidence.suppliedAtEpochMs = now - 50;
  checklist.reviews.push(renewed);
  assert.equal(registry.evaluate("WEB-QA-009", c).status, "pass");
});
test("WEB-RDY-RUN-002: consumes the actual registered SETUP-012 evaluator result", () => {
  const source = fixture("WEB-SETUP-012"); source.participant = null;
  const actual = registry.evaluate("WEB-SETUP-012", source);
  assert.equal(actual.status, "pass");
  const c = fixture("WEB-RDY-RUN-002");
  c.deliverables!.prerequisites[0]!.result = structuredClone(actual) as Mutable<typeof actual>;
  assert.equal(registry.evaluate("WEB-RDY-RUN-002", c).status, "pass");
});
test("WEB-RDY-REC-003: consumes the actual registered SETUP-011 evaluator result for the matching page", () => {
  const c = fixture("WEB-RDY-REC-003"); c.participant = null;
  const actual = registry.evaluate("WEB-SETUP-011", c);
  assert.equal(actual.status, "pass");
  c.deliverables!.prerequisites[0]!.result = structuredClone(actual) as Mutable<typeof actual>;
  assert.equal(registry.evaluate("WEB-RDY-REC-003", c).status, "pass");
});