import assert from "node:assert/strict";
import { test } from "node:test";
import { DELIVERABLE_BATCH_RULE_IDS } from "../../src/lib/webinar-standard-evaluation";
import { registry } from "./fixtures";
import { fixture, manual, now, proof, roles, type Mutable } from "./deliverable-fixtures";
import type { ManualEvidence } from "../../src/lib/webinar-standard-evidence";

for (const id of DELIVERABLE_BATCH_RULE_IDS.filter(id => roles[id] !== null)) {
  test(`${id}: absent current required deliverable cannot pass`, () => {
    const c = fixture(id); c.deliverables!.artifacts = [];
    // A reviewed complete inventory may legitimately contain no applicable supporting assets.
    assert.equal(registry.evaluate(id, c).status, id === "WEB-RDY-RUN-004" ? "pass" : "fail");
  });
  test(`${id}: planned production is not a produced artifact`, () => {
    const c = fixture(id); c.deliverables!.artifacts[0]!.lifecycle = "planned";
    assert.equal(registry.evaluate(id, c).reason, "violation");
  });
  test(`${id}: produced content without review does not prove QA`, () => {
    const c = fixture(id); c.deliverables!.artifacts[0]!.reviews = [];
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: incomplete inventory with absent artifact is unavailable`, () => {
    const c = fixture(id); c.deliverables!.artifacts = []; c.deliverables!.complete = false;
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: duplicate deliverable identity is invalid`, () => {
    const c = fixture(id); c.deliverables!.artifacts.push(structuredClone(c.deliverables!.artifacts[0]!));
    assert.equal(registry.evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: duplicate evidence identity is invalid`, () => {
    const c = fixture(id), a = c.deliverables!.artifacts[0]!;
    a.reviews.push(structuredClone(a.reviews[0]!));
    assert.equal(registry.evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: advancing current version invalidates old positive QA`, () => {
    const c = fixture(id); c.deliverables!.artifacts[0]!.contentVersion = "content-2";
    assert.equal(registry.evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: later contradictory authoritative observation wins`, () => {
    const c = fixture(id), a = c.deliverables!.artifacts[0]!, e = structuredClone(proof(c, id));
    e.evidenceId += "-later"; e.binding.reviewedAtEpochMs = now - 50; e.suppliedAtEpochMs = now - 50; e.evidenceStatus = "rejected";
    a.reviews.push({ ruleId: id, kind: "observation", evidence: e });
    assert.equal(registry.evaluate(id, c).reason, "violation");
  });
  test(`${id}: later incomplete observation cannot reuse earlier approval`, () => {
    const c = fixture(id), a = c.deliverables!.artifacts[0]!, e = structuredClone(proof(c, id));
    e.evidenceId += "-later"; e.binding.reviewedAtEpochMs = now - 50; e.suppliedAtEpochMs = now - 50; e.evidenceStatus = "incomplete";
    a.reviews.push({ ruleId: id, kind: "observation", evidence: e });
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: wrong artifact occurrence is invalid`, () => {
    const c = fixture(id); c.deliverables!.artifacts[0]!.occurrenceId = "other";
    assert.equal(registry.evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: owner and deadline are not invented requirements for this rule`, () => {
    const c = fixture(id); c.deliverables!.artifacts[0]!.owner = null; c.deliverables!.artifacts[0]!.dueAtEpochMs = null;
    assert.equal(registry.evaluate(id, c).status, "pass");
  });
}

const triggers = [
  ["WEB-SETUP-C02", "capacitySet"], ["WEB-SETUP-C02", "capacityReachable"],
  ["WEB-SETUP-C03", "objectiveCallsForHandraiser"], ["WEB-SETUP-C04", "supportingChannelsUsed"],
  ["WEB-SETUP-C06", "accessibilityRequired"], ["WEB-SETUP-C08", "salesAdjacent"],
  ["WEB-FU-ATT-005", "objectiveCallsForHandraiser"], ["WEB-FU-ABS-005", "absentHandraiserAppropriate"],
  ["WEB-FU-WL-004", "waitlistInUse"], ["WEB-QA-007", "waitlistInUse"], ["WEB-FU-INT-002", "qaSendRequested"],
] as const;
for (const [id, fact] of triggers) {
  test(`${id}: explicitly false ${fact} is not applicable`, () => {
    const c = fixture(id); c.deliverables!.facts[fact] = false;
    assert.equal(registry.evaluate(id, c).status, "not_applicable");
  });
  test(`${id}: unknown ${fact} is unavailable, not inapplicable`, () => {
    const c = fixture(id); c.deliverables!.facts[fact] = null;
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
}
for (const [capacitySet, capacityReachable] of [[null, false], [false, null]] as const) {
  test(`WEB-SETUP-C02: capacity set ${capacitySet} and reachable ${capacityReachable} definitively excludes the conjunction`, () => {
    const c = fixture("WEB-SETUP-C02");
    c.deliverables!.facts.capacitySet = capacitySet;
    c.deliverables!.facts.capacityReachable = capacityReachable;
    assert.equal(registry.evaluate("WEB-SETUP-C02", c).status, "not_applicable");
  });
}
for (const id of ["WEB-RDY-REC-003", "WEB-RDY-RUN-002", "WEB-RDY-RUN-003", "WEB-RDY-RUN-004", "WEB-RDY-RUN-006", "WEB-QA-001", "WEB-QA-002", "WEB-QA-007", "WEB-QA-009"] as const) {
  test(`${id}: unrelated readiness stage does not broaden the trigger`, () => {
    const c = fixture(id); c.deliverables!.evaluationStage = "Complete";
    assert.equal(registry.evaluate(id, c).status, "not_applicable");
  });
  test(`${id}: unknown readiness stage cannot pass`, () => {
    const c = fixture(id); c.deliverables!.evaluationStage = null;
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
}
for (const id of ["WEB-FU-ATT-002", "WEB-FU-ATT-003", "WEB-FU-ATT-004", "WEB-FU-ATT-005", "WEB-FU-ABS-002", "WEB-FU-ABS-003", "WEB-FU-ABS-004", "WEB-FU-ABS-005"] as const) {
  test(`${id}: attendance unknown does not select either message variant`, () => {
    const c = fixture(id); c.participant!.attendanceState = "unknown";
    assert.equal(registry.evaluate(id, c).status, "not_applicable");
  });
  test(`${id}: customer variant cannot be applied to internal or test audience`, () => {
    const c = fixture(id); c.participant!.audienceClass = "internal";
    assert.equal(registry.evaluate(id, c).status, "not_applicable");
  });
  test(`${id}: missing selected participant does not establish applicability`, () => {
    const c = fixture(id); c.participant = null;
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
}
for (const id of ["WEB-FU-ATT-003", "WEB-FU-ABS-003"] as const) {
  for (const availability of ["expected", "not_expected"] as const) {
    test(`${id}: recording ${availability} is not presently available`, () => {
      const c = fixture(id); c.deliverables!.facts.recordingAvailability = availability;
      assert.equal(registry.evaluate(id, c).status, "not_applicable");
    });
  }
  test(`${id}: recording availability unknown does not pass`, () => {
    const c = fixture(id); c.deliverables!.facts.recordingAvailability = null;
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: available recording must actually be referenced by this message`, () => {
    const c = fixture(id), a = c.deliverables!.artifacts[0]!; a.assetId = null; a.destinationId = null;
    assert.equal(registry.evaluate(id, c).reason, "violation");
  });
}
test("WEB-SETUP-019: explicitly not expected is a valid reviewed recording statement", () => {
  const c = fixture("WEB-SETUP-019"); c.deliverables!.facts.recordingAvailability = "not_expected";
  assert.equal(registry.evaluate("WEB-SETUP-019", c).status, "pass");
});
test("WEB-SETUP-019: unknown availability is not a statement", () => {
  const c = fixture("WEB-SETUP-019"); c.deliverables!.facts.recordingAvailability = null;
  assert.equal(registry.evaluate("WEB-SETUP-019", c).status, "evidence_unavailable");
});
test("WEB-SETUP-012: a name without confirmed participation fails", () => {
  const c = fixture("WEB-SETUP-012"); c.deliverables!.artifacts[0]!.speakerConfirmed = false;
  assert.equal(registry.evaluate("WEB-SETUP-012", c).reason, "violation");
});
test("WEB-QA-001: confirmed speaker must actually receive materials, not just be sent them", () => {
  const c = fixture("WEB-QA-001"); c.deliverables!.artifacts[0]!.reviews[0]!.kind = "review";
  assert.equal(registry.evaluate("WEB-QA-001", c).status, "evidence_unavailable");
});
test("WEB-QA-001: different speakers cannot separately satisfy confirmation and receipt", () => {
  const c = fixture("WEB-QA-001"), first = c.deliverables!.artifacts[0]!;
  const second = structuredClone(first); second.deliverableId = "speaker-2"; second.speakerConfirmed = false;
  second.reviews[0]!.evidence.scope.deliverableIds = ["speaker-2"]; second.reviews[0]!.evidence.evidenceId += "-2";
  first.reviews = []; c.deliverables!.artifacts.push(second);
  assert.equal(registry.evaluate("WEB-QA-001", c).status, "evidence_unavailable");
});
test("WEB-QA-002: mere brief presence approval under RUN-003 cannot prove ready content", () => {
  const c = fixture("WEB-QA-002"), r = c.deliverables!.artifacts[0]!.reviews[0]!;
  r.ruleId = "WEB-RDY-RUN-003"; r.evidence.ruleId = r.ruleId;
  assert.equal(registry.evaluate("WEB-QA-002", c).status, "evidence_unavailable");
});
for (const kind of ["test", "approval"] as const) {
  test(`WEB-RDY-REC-003: requires actual exact-page ${kind}, not the other review`, () => {
    const c = fixture("WEB-RDY-REC-003"); c.deliverables!.artifacts[0]!.reviews = c.deliverables!.artifacts[0]!.reviews.filter(r => r.kind !== kind);
    assert.equal(registry.evaluate("WEB-RDY-REC-003", c).status, "evidence_unavailable");
  });
}
test("WEB-RDY-REC-003: tested page must match setup registration destination", () => {
  const c = fixture("WEB-RDY-REC-003"); c.setup!.registrationDestination = "https://example.org/wrong";
  assert.equal(registry.evaluate("WEB-RDY-REC-003", c).reason, "invalid_context");
});
test("WEB-RDY-RUN-004: an incomplete required-content inventory cannot pass", () => {
  const c = fixture("WEB-RDY-RUN-004"); c.deliverables!.complete = false;
  assert.equal(registry.evaluate("WEB-RDY-RUN-004", c).status, "evidence_unavailable");
});
test("WEB-RDY-RUN-004: complete inventory still requires reviewer confirmation", () => {
  const c = fixture("WEB-RDY-RUN-004"); c.deliverables!.supportingContentInventoryEvidence = null;
  assert.equal(registry.evaluate("WEB-RDY-RUN-004", c).status, "evidence_unavailable");
});
test("WEB-RDY-RUN-004: every supporting asset needs current readiness review", () => {
  const c = fixture("WEB-RDY-RUN-004"), second = structuredClone(c.deliverables!.artifacts[0]!);
  second.deliverableId = "second"; second.reviews = []; c.deliverables!.artifacts.push(second);
  assert.equal(registry.evaluate("WEB-RDY-RUN-004", c).status, "evidence_unavailable");
});
test("WEB-RDY-RUN-006: explicit documented capture absence is permitted", () => {
  const c = fixture("WEB-RDY-RUN-006"); c.deliverables!.facts.captureInUse = false; c.deliverables!.artifacts[0]!.reviews[0]!.kind = "review";
  assert.equal(registry.evaluate("WEB-RDY-RUN-006", c).status, "pass");
});
test("WEB-RDY-RUN-006: capture configured but untested is unavailable", () => {
  const c = fixture("WEB-RDY-RUN-006"); c.deliverables!.artifacts[0]!.reviews[0]!.kind = "review";
  assert.equal(registry.evaluate("WEB-RDY-RUN-006", c).status, "evidence_unavailable");
});
test("WEB-RDY-RUN-006: unknown capture cannot become documented absence", () => {
  const c = fixture("WEB-RDY-RUN-006"); c.deliverables!.facts.captureInUse = null;
  assert.equal(registry.evaluate("WEB-RDY-RUN-006", c).status, "evidence_unavailable");
});
test("WEB-RDY-RUN-006: a later positive observation cannot replace a failed actual capture test", () => {
  const c = fixture("WEB-RDY-RUN-006"), e = proof(c, "WEB-RDY-RUN-006");
  const observation = structuredClone(e); observation.evidenceId += "-later"; observation.binding.reviewedAtEpochMs = now - 50; observation.suppliedAtEpochMs = now - 50;
  e.evidenceStatus = "rejected";
  c.deliverables!.artifacts[0]!.reviews.push({ ruleId: "WEB-RDY-RUN-006", kind: "observation", evidence: observation });
  assert.equal(registry.evaluate("WEB-RDY-RUN-006", c).reason, "violation");
});
for (const id of ["WEB-FU-WL-004", "WEB-QA-007"] as const) {
  test(`${id}: waitlist data in a plan without visual review is unavailable`, () => {
    const c = fixture(id); c.deliverables!.artifacts[0]!.reviews = [];
    assert.equal(registry.evaluate(id, c).status, "evidence_unavailable");
  });
}
test("WEB-FU-INT-002: qa type tag without visible label review does not authorize a test", () => {
  const c = fixture("WEB-FU-INT-002"); c.deliverables!.artifacts[0]!.reviews = [];
  assert.equal(registry.evaluate("WEB-FU-INT-002", c).status, "evidence_unavailable");
});
test("shared recording and destination are permitted for distinct attended and absent variants", () => {
  const c = fixture("WEB-FU-ATT-003"), d = c.deliverables!;
  const other = fixture("WEB-FU-ABS-003");
  const communication = other.deliverables!.communications[0]!; communication.communicationId = "absent";
  const a = other.deliverables!.artifacts[0]!; a.deliverableId = "absent-message"; a.communicationId = "absent"; a.content = "Absent acknowledgment";
  a.reviews[0]!.evidence = structuredClone(manual("WEB-FU-ABS-003", a)) as Mutable<ManualEvidence>;
  d.communications.push(communication); d.artifacts.push(a);
  assert.equal(d.artifacts[0]!.assetId, a.assetId); assert.equal(d.artifacts[0]!.destinationId, a.destinationId);
  assert.equal(registry.evaluate("WEB-FU-ATT-003", c).status, "pass");
  c.participant!.attendanceState = "absent";
  assert.equal(registry.evaluate("WEB-FU-ABS-003", c).status, "pass");
});
for (const [label, mutate] of Object.entries({
  "collapsed communication identity": (c: ReturnType<typeof fixture>) => c.deliverables!.communications.push(structuredClone(c.deliverables!.communications[0]!)),
  "missing message communication relationship": (c: ReturnType<typeof fixture>) => { c.deliverables!.artifacts[0]!.communicationId = null; },
  "unknown message communication": (c: ReturnType<typeof fixture>) => { c.deliverables!.artifacts[0]!.communicationId = "unknown"; },
  "wrong audience variant": (c: ReturnType<typeof fixture>) => { c.deliverables!.communications[0]!.audienceState = "absent"; },
  "wrong communication occurrence": (c: ReturnType<typeof fixture>) => { c.deliverables!.communications[0]!.occurrenceId = "other"; },
  "conflicting current message version": (c: ReturnType<typeof fixture>) => { const a = structuredClone(c.deliverables!.artifacts[0]!); a.deliverableId = "second"; a.reviews = []; c.deliverables!.artifacts.push(a); },
})) {
  test(`deliverable integrity rejects ${label}`, () => {
    const c = fixture("WEB-FU-ATT-002"); mutate(c);
    assert.equal(registry.evaluate("WEB-FU-ATT-002", c).reason, "invalid_context");
  });
}