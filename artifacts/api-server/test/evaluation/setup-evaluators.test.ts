import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { RuleId } from "../../src/lib/webinar-standard-catalog/types";
import type { EvaluationContext, RuleEvaluationResult } from "../../src/lib/webinar-standard-evaluation/types";
import type { SetupContext } from "../../src/lib/webinar-standard-evaluation/setup-types";
import { SETUP_BATCH_RULE_IDS } from "../../src/lib/webinar-standard-evaluation/setup-evaluators";
import { validateWebinarException } from "../../src/lib/webinar-standard-exceptions";
import { exception } from "../readiness/fixtures";
import { catalog, makeContext, registry } from "./fixtures";

const setupIds = catalog.rules.filter(r => r.ruleId.startsWith("WEB-SETUP-")).map(r => r.ruleId);
const ownerIds: readonly RuleId[] = ["WEB-SETUP-013", "WEB-SETUP-014", "WEB-SETUP-015"];
function suppliedResults(ids: readonly RuleId[]): RuleEvaluationResult[] {
  return ids.map(id => ({
    mode: "descriptive_only", standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    ruleId: id, rule: catalog.rules.find(r => r.ruleId === id)!, participantId: null,
    status: "pass", reason: "satisfied", evidence: [`Current scoped review of ${id}.`],
  }));
}
function context(): EvaluationContext {
  const base = makeContext();
  return {
    ...base, participant: null,
    setup: {
      eventId: base.event.eventId, snapshotId: "snapshot-1", complete: true,
      activityType: "Webinar", evaluationStage: "Ready to recruit",
      title: "Practical attribution", topic: "Attribution", description: "",
      intendedAudience: "Marketing operations leaders", eventLocalDate: "2030-01-01",
      localStartTime: "13:00", timeZone: "UTC", durationMinutes: 45, format: "live",
      platform: "Video platform", physicalLocation: null, registrationDestination: "page:registration-1",
      owner: "Owner One", recruitmentOwner: "Owner Two", followUpOwner: "Owner Three",
      primaryCta: "Register", followUpCta: "Book a consultation",
      measurementTargets: ["registrations"], registrationOpeningRule: "Open upon approval",
      registrationClosingRule: "Close at event start", platformEnforcesCapacity: true,
      capacity: 100, audienceNonDefaultLanguage: true, language: "French",
    },
    measurementPlan: {
      eventId: base.event.eventId, snapshotId: "snapshot-1", complete: true,
      description: "Measure registration conversion against campaign plan",
      targets: [{ targetId: "registrations", metric: "Registrations", target: 50, unit: "people" }],
    },
    findingEvidence: {
      eventId: base.event.eventId, snapshotId: "snapshot-1", standardId: catalog.standardId,
      standardVersion: catalog.standardVersion, observedAtEpochMs: base.observedAtEpochMs, complete: true,
      setupResults: suppliedResults(setupIds), ownerResults: suppliedResults(ownerIds),
    },
  };
}
function withSetup(patch: Partial<SetupContext>): EvaluationContext {
  const c = context();
  return { ...c, setup: { ...c.setup!, ...patch } };
}
const failing: Readonly<Record<typeof SETUP_BATCH_RULE_IDS[number], () => EvaluationContext>> = {
  "WEB-SETUP-001": () => withSetup({ title: "  " }),
  "WEB-SETUP-002": () => withSetup({ topic: "", description: " " }),
  "WEB-SETUP-004": () => withSetup({ intendedAudience: "" }),
  "WEB-SETUP-005": () => withSetup({ eventLocalDate: "2029-12-31" }),
  "WEB-SETUP-006": () => withSetup({ localStartTime: "" }),
  "WEB-SETUP-007": () => withSetup({ durationMinutes: 0 }),
  "WEB-SETUP-008": () => withSetup({ timeZone: "" }),
  "WEB-SETUP-009": () => withSetup({ format: null }),
  "WEB-SETUP-010": () => withSetup({ platform: "", physicalLocation: "" }),
  "WEB-SETUP-011": () => withSetup({ registrationDestination: "" }),
  "WEB-SETUP-013": () => withSetup({ owner: "" }),
  "WEB-SETUP-014": () => withSetup({ recruitmentOwner: "" }),
  "WEB-SETUP-015": () => withSetup({ followUpOwner: "" }),
  "WEB-SETUP-016": () => withSetup({ primaryCta: "" }),
  "WEB-SETUP-017": () => withSetup({ followUpCta: "" }),
  "WEB-SETUP-018": () => withSetup({ measurementTargets: [] }),
  "WEB-SETUP-020": () => withSetup({ registrationClosingRule: "" }),
  "WEB-SETUP-C01": () => withSetup({ capacity: 0 }),
  "WEB-SETUP-C05": () => withSetup({ language: "" }),
  "WEB-QA-008": () => withSetup({ recruitmentOwner: "" }),
  "WEB-MEAS-001": () => { const c = context(); return { ...c, measurementPlan: { ...c.measurementPlan!, targets: [] } }; },
  "WEB-RDY-REC-001": () => failedPrerequisite("setupResults"),
  "WEB-RDY-REC-007": () => failedPrerequisite("ownerResults"),
};
function failedPrerequisite(key: "setupResults" | "ownerResults"): EvaluationContext {
  const c = context();
  const findings = c.findingEvidence![key]!.map((f, i) => i === 0
    ? { ...f, status: "fail" as const, reason: "violation" as const } : f);
  return { ...c, findingEvidence: { ...c.findingEvidence!, [key]: findings } };
}
for (const id of SETUP_BATCH_RULE_IDS) {
  test(`${id}: positive rule-specific setup evidence passes`, () => {
    assert.equal(registry.evaluate(id, context()).status, "pass");
  });
  test(`${id}: confirmed canonical obligation violation fails with exact metadata`, () => {
    const result = registry.evaluate(id, failing[id]());
    const canonical = catalog.rules.find(r => r.ruleId === id)!;
    assert.equal(result.status, "fail");
    assert.equal(result.reason, "violation");
    assert.deepEqual(result.rule, canonical);
    assert.equal(result.rule.failureMessage, canonical.failureMessage);
    assert.equal(result.rule.resolutionGuidance, canonical.resolutionGuidance);
    assert.equal(result.standardVersion, catalog.standardVersion);
    assert.equal(result.rule.exceptionEligible, canonical.exceptionEligible);
  });
  test(`${id}: explicit non-Webinar activity is not applicable`, () => {
    assert.equal(registry.evaluate(id, withSetup({ activityType: "Conference" })).status, "not_applicable");
  });
  test(`${id}: old context without new evidence remains evidence unavailable`, () => {
    const r = registry.evaluate(id, makeContext());
    assert.equal(r.status, "evidence_unavailable");
    assert.equal(r.reason, "missing_evidence");
  });
  test(`${id}: mismatched event snapshot is invalid context`, () => {
    const r = registry.evaluate(id, withSetup({ eventId: "another-event" }));
    assert.equal(r.status, "fail");
    assert.equal(r.reason, "invalid_context");
  });
  test(`${id}: deterministic immutable evaluation and canonical result`, () => {
    const c = freeze(context());
    const before = structuredClone(c);
    const result = registry.evaluate(id, c);
    assert.deepEqual(registry.evaluate(id, c), result);
    assert.deepEqual(c, before);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.evidence));
    assert.ok(Object.isFrozen(result.rule));
  });
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}
test("Batch 1 membership independently reconciles exact proposed-batch column, not a prefix", async () => {
  const plan = await readFile(new URL("../../../../docs/verification/phase-2a-5-evaluator-coverage-plan.md", import.meta.url), "utf8");
  const rows = plan.split("\n").filter(line => line.startsWith("| WEB-"))
    .map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
  const ids = rows.filter(row => row[17] === "1").map(row => row[0]);
  assert.equal(ids.length, 23);
  assert.deepEqual([...SETUP_BATCH_RULE_IDS].sort(), ids.sort());
});

const textCases = [
  ["WEB-SETUP-001", "title"], ["WEB-SETUP-004", "intendedAudience"],
  ["WEB-SETUP-011", "registrationDestination"], ["WEB-SETUP-013", "owner"],
  ["WEB-SETUP-014", "recruitmentOwner"], ["WEB-SETUP-015", "followUpOwner"],
  ["WEB-SETUP-016", "primaryCta"], ["WEB-SETUP-017", "followUpCta"],
  ["WEB-SETUP-C05", "language"], ["WEB-SETUP-020", "registrationOpeningRule"],
] as const;
for (const [id, field] of textCases) {
  test(`${id}: unknown ${field} versus complete absence versus malformed value`, () => {
    assert.equal(registry.evaluate(id, withSetup({ complete: false, [field]: undefined })).status, "evidence_unavailable");
    assert.equal(registry.evaluate(id, withSetup({ [field]: null })).reason, "violation");
    assert.equal(registry.evaluate(id, withSetup({ [field]: {} } as Partial<SetupContext>)).reason, "invalid_context");
  });
}
for (const [id, trigger] of [
  ["WEB-SETUP-C01", "platformEnforcesCapacity"], ["WEB-SETUP-C05", "audienceNonDefaultLanguage"],
] as const) {
  test(`${id}: conditional trigger false, unknown, malformed and exception eligibility remain distinct`, () => {
    assert.equal(registry.evaluate(id, withSetup({ [trigger]: false })).status, "not_applicable");
    assert.equal(registry.evaluate(id, withSetup({ [trigger]: null })).status, "evidence_unavailable");
    assert.equal(registry.evaluate(id, withSetup({ [trigger]: "yes" } as unknown as Partial<SetupContext>)).reason, "invalid_context");
    const result = registry.evaluate(id, failing[id]());
    assert.equal(result.rule.exceptionEligible, true);
    assert.equal(result.status, "fail"); // Eligibility never excuses a violation or grants a pass.
  });
  test(`${id}: a valid documentary exception does not rewrite failure or supply missing evidence`, () => {
    const rule = catalog.rules.find(r => r.ruleId === id)!;
    const c = failing[id]();
    const original = registry.evaluate(id, c);
    const validation = validateWebinarException(exception(rule), catalog, c.observedAtEpochMs, id);
    assert.equal(validation.ok, true);
    assert.deepEqual(registry.evaluate(id, c), original);
    assert.equal(original.status, "fail");
    assert.equal(registry.evaluate(id, makeContext()).status, "evidence_unavailable");
  });
}
test("WEB-SETUP-002 and WEB-SETUP-010 require one real alternative and reject malformed alternatives", () => {
  assert.equal(registry.evaluate("WEB-SETUP-002", withSetup({ topic: null, description: "Defined topic" })).status, "pass");
  assert.equal(registry.evaluate("WEB-SETUP-010", withSetup({ platform: null, physicalLocation: "Room 1" })).status, "pass");
  assert.equal(registry.evaluate("WEB-SETUP-002", withSetup({ complete: false, topic: null, description: null })).status, "evidence_unavailable");
  assert.equal(registry.evaluate("WEB-SETUP-010", withSetup({ platform: {} } as Partial<SetupContext>)).reason, "invalid_context");
});
test("WEB-SETUP-005 compares local dates, permits elapsed same-day starts and rejects impossible dates", () => {
  const c = context();
  const pastSameDay = { ...c, event: { ...c.event, startsAtEpochMs: c.observedAtEpochMs - 60_000 } };
  assert.equal(registry.evaluate("WEB-SETUP-005", pastSameDay).status, "pass");
  assert.equal(registry.evaluate("WEB-SETUP-005", withSetup({ eventLocalDate: "2030-02-30" })).reason, "invalid_context");
  const boundary = withSetup({ eventLocalDate: "2029-12-31", timeZone: "America/Los_Angeles" });
  assert.equal(registry.evaluate("WEB-SETUP-005", { ...boundary, observedAtEpochMs: Date.parse("2030-01-01T01:00:00Z") }).status, "pass");
  assert.equal(registry.evaluate("WEB-SETUP-005", withSetup({ complete: false, eventLocalDate: null })).status, "evidence_unavailable");
});
test("WEB-SETUP-006 requires valid entered time consistent with resolved instant but not a future instant", () => {
  const c = withSetup({ localStartTime: "11:00" });
  assert.equal(registry.evaluate("WEB-SETUP-006", { ...c, event: { ...c.event, startsAtEpochMs: c.observedAtEpochMs - 3_600_000 } }).status, "pass");
  for (const localStartTime of ["25:00", "13:99", "13:00Z", "12:00"]) {
    assert.equal(registry.evaluate("WEB-SETUP-006", withSetup({ localStartTime })).reason, "invalid_context");
  }
  assert.equal(registry.evaluate("WEB-SETUP-006", { ...c, event: { ...c.event, startsAtEpochMs: null } }).status, "evidence_unavailable");
});
test("WEB-SETUP-005 and WEB-SETUP-006 honor DST dates and resolve repeated times from supplied instants", () => {
  const c = withSetup({ eventLocalDate: "2030-11-03", localStartTime: "01:30", timeZone: "America/New_York" });
  for (const startsAtEpochMs of [Date.parse("2030-11-03T05:30:00Z"), Date.parse("2030-11-03T06:30:00Z")]) {
    const current = { ...c, observedAtEpochMs: Date.parse("2030-11-03T04:00:00Z"), event: { ...c.event, startsAtEpochMs } };
    assert.equal(registry.evaluate("WEB-SETUP-005", current).status, "pass");
    assert.equal(registry.evaluate("WEB-SETUP-006", current).status, "pass");
  }
  const gap = withSetup({ eventLocalDate: "2030-03-10", localStartTime: "02:30", timeZone: "America/New_York" });
  assert.equal(registry.evaluate("WEB-SETUP-006", {
    ...gap, event: { ...gap.event, startsAtEpochMs: Date.parse("2030-03-10T07:30:00Z") },
  }).reason, "invalid_context");
});
test("WEB-SETUP-013/014/015 and WEB-QA-008 do not substitute one owner role for another", () => {
  assert.equal(registry.evaluate("WEB-SETUP-013", withSetup({ owner: null })).reason, "violation");
  assert.equal(registry.evaluate("WEB-SETUP-014", withSetup({ recruitmentOwner: null })).reason, "violation");
  assert.equal(registry.evaluate("WEB-SETUP-015", withSetup({ followUpOwner: null })).reason, "violation");
  assert.equal(registry.evaluate("WEB-QA-008", withSetup({ followUpOwner: null })).reason, "violation");
  assert.equal(registry.evaluate("WEB-QA-008", withSetup({ owner: null })).status, "pass");
});
test("WEB-SETUP-007 and WEB-SETUP-C01 reject malformed numeric evidence without coercion", () => {
  for (const bad of [NaN, Infinity, "1", {}]) {
    assert.equal(registry.evaluate("WEB-SETUP-007", withSetup({ durationMinutes: bad } as Partial<SetupContext>)).reason, "invalid_context");
    assert.equal(registry.evaluate("WEB-SETUP-C01", withSetup({ capacity: bad } as Partial<SetupContext>)).reason, "invalid_context");
  }
  assert.equal(registry.evaluate("WEB-SETUP-007", withSetup({ durationMinutes: -1 })).reason, "violation");
  assert.equal(registry.evaluate("WEB-SETUP-C01", withSetup({ capacity: 1.5 })).reason, "invalid_context");
});
test("WEB-SETUP-008 reuses named IANA-zone validation without host-zone fallback", () => {
  for (const timeZone of ["+01:00", "not/a-zone", " UTC "]) {
    assert.equal(registry.evaluate("WEB-SETUP-008", withSetup({ timeZone })).reason, "invalid_context");
  }
  assert.equal(registry.evaluate("WEB-SETUP-008", withSetup({ complete: false, timeZone: null })).status, "evidence_unavailable");
});
test("WEB-SETUP-009 accepts exactly the canonical four formats", () => {
  for (const format of ["live", "hybrid", "simulated live", "on-demand"] as const) {
    assert.equal(registry.evaluate("WEB-SETUP-009", withSetup({ format })).status, "pass");
  }
  assert.equal(registry.evaluate("WEB-SETUP-009", withSetup({ format: "recorded" } as unknown as Partial<SetupContext>)).reason, "invalid_context");
});
test("WEB-SETUP-018 selection is distinct from WEB-MEAS-001 substantive plan and targets", () => {
  const c = context();
  assert.equal(registry.evaluate("WEB-SETUP-018", { ...c, measurementPlan: undefined }).status, "pass");
  assert.equal(registry.evaluate("WEB-MEAS-001", { ...c, measurementPlan: undefined }).status, "evidence_unavailable");
  assert.equal(registry.evaluate("WEB-SETUP-018", withSetup({ measurementTargets: [" "] })).reason, "invalid_context");
  assert.equal(registry.evaluate("WEB-SETUP-018", withSetup({ measurementTargets: ["x", "x"] })).reason, "invalid_context");
  for (const targets of [[{ targetId: "x", metric: "", target: 1, unit: "people" }], [{ targetId: "x", metric: "Count", target: NaN, unit: "people" }]]) {
    assert.equal(registry.evaluate("WEB-MEAS-001", { ...c, measurementPlan: { ...c.measurementPlan!, targets } }).reason, "invalid_context");
  }
});
for (const id of ["WEB-QA-008", "WEB-MEAS-001", "WEB-RDY-REC-001", "WEB-RDY-REC-007"] as const) {
  test(`${id}: recruitment evaluation stage is explicit, not inferred from operational status`, () => {
    assert.equal(registry.evaluate(id, withSetup({ evaluationStage: null })).status, "evidence_unavailable");
    assert.equal(registry.evaluate(id, withSetup({ evaluationStage: "Ready to run" })).status, "not_applicable");
    assert.equal(registry.evaluate(id, withSetup({ evaluationStage: "unknown" })).reason, "invalid_context");
  });
}
for (const [id, key] of [["WEB-RDY-REC-001", "setupResults"], ["WEB-RDY-REC-007", "ownerResults"]] as const) {
  test(`${id}: wrappers reject vacuous, partial, unknown and unimplemented prerequisite coverage`, () => {
    const c = context();
    for (const findings of [[], c.findingEvidence![key]!.slice(1), c.findingEvidence![key]!.map((f, i) =>
      i ? f : { ...f, status: "unimplemented" as const, reason: "not_implemented" as const })]) {
      assert.equal(registry.evaluate(id, { ...c, findingEvidence: { ...c.findingEvidence!, [key]: findings } }).status, "evidence_unavailable");
    }
    assert.equal(registry.evaluate(id, { ...c, findingEvidence: { ...c.findingEvidence!, complete: false } }).status, "evidence_unavailable");
    assert.equal(registry.evaluate(id, { ...c, findingEvidence: undefined }).status, "evidence_unavailable");
    const unknown = c.findingEvidence![key]!.map((f, i) => i ? f
      : { ...f, status: "evidence_unavailable" as const, reason: "missing_evidence" as const });
    assert.equal(registry.evaluate(id, { ...c, findingEvidence: { ...c.findingEvidence!, [key]: unknown } }).status, "evidence_unavailable");
    const malformed = c.findingEvidence![key]!.map((f, i) => i ? f
      : { ...f, status: "fail" as const, reason: "invalid_context" as const });
    assert.equal(registry.evaluate(id, { ...c, findingEvidence: { ...c.findingEvidence!, [key]: malformed } }).reason, "invalid_context");
  });
  test(`${id}: external findings require exact canonical identity, metadata, status, scope and observation`, () => {
    const c = context();
    const originals = c.findingEvidence![key]!;
    const first = originals[0];
    for (const bad of [
      { ...first, ruleId: "WEB-UNKNOWN" }, { ...first, standardVersion: "old" },
      { ...first, standardId: "OTHER" }, { ...first, rule: { ...first.rule, exceptionEligible: !first.rule.exceptionEligible } },
      { ...first, rule: { ...first.rule, failureMessage: "forged" } }, { ...first, participantId: "person-1" },
      { ...first, status: "pass", reason: "missing_evidence" }, { ...first, status: "not_applicable", reason: "condition_not_met" },
      { ...first, evidence: [] },
    ]) {
      const findings = [bad, ...originals.slice(1)] as readonly RuleEvaluationResult[];
      assert.equal(registry.evaluate(id, { ...c, findingEvidence: { ...c.findingEvidence!, [key]: findings } }).reason, "invalid_context");
    }
    for (const patch of [
      { eventId: "other" }, { snapshotId: "old" }, { observedAtEpochMs: c.observedAtEpochMs - 1 },
      { standardVersion: "old" }, { standardId: "OTHER" },
    ]) {
      assert.equal(registry.evaluate(id, { ...c, findingEvidence: { ...c.findingEvidence!, ...patch } } as EvaluationContext).reason, "invalid_context");
    }
    assert.equal(registry.evaluate(id, { ...c, findingEvidence: { ...c.findingEvidence!, [key]: [...originals, first] } }).reason, "invalid_context");
  });
}
test("WEB-RDY-REC-001 accepts explicit conditional NA but never recursive readiness or missing later-batch leaves", () => {
  const c = context();
  const findings = c.findingEvidence!.setupResults!.map(f => f.ruleId === "WEB-SETUP-C01"
    ? { ...f, status: "not_applicable" as const, reason: "condition_not_met" as const } : f);
  assert.equal(registry.evaluate("WEB-RDY-REC-001", { ...c, findingEvidence: { ...c.findingEvidence!, setupResults: findings } }).status, "pass");
  const recursive = [...findings, registry.evaluate("WEB-RDY-REC-007", c)];
  assert.equal(registry.evaluate("WEB-RDY-REC-001", { ...c, findingEvidence: { ...c.findingEvidence!, setupResults: recursive } }).reason, "invalid_context");
  const actualRegistryResults = setupIds.map(id => registry.evaluate(id, c));
  assert.equal(registry.evaluate("WEB-RDY-REC-001", { ...c, findingEvidence: { ...c.findingEvidence!, setupResults: actualRegistryResults } }).status, "evidence_unavailable");
});