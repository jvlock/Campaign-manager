import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { READINESS_STAGES } from "../../src/lib/webinar-standard-catalog/types";
import type { WebinarException } from "../../src/lib/webinar-standard-exceptions/types";
import { aggregateWebinarReadiness } from "../../src/lib/webinar-standard-readiness/index";
import { COMPLETE_OBLIGATIONS } from "../../src/lib/webinar-standard-readiness/types";
import {
  assertDeepFrozen, catalog, claimed, exception, finding, input, makeContext, referenceTime,
  registry, select, stage, withFinding,
} from "./fixtures";

const aggregate = (value: unknown = input()) => aggregateWebinarReadiness(catalog, registry, value);
const mandatory = select((r) => r.primaryRuleType === "Mandatory blocker" && r.readinessStage === "Ready to recruit");
const eligibleMandatory = select((r) => r.primaryRuleType === "Mandatory blocker" && r.exceptionEligible);
const conditional = select((r) => r.primaryRuleType === "Conditional blocker");
const eligible = select((r) => r.exceptionEligible && /blocker/.test(r.primaryRuleType));
const nonblocking = select((r) => r.exceptionEligible && r.primaryRuleType === "Recommended default");
const runRule = select((r) => r.readinessStage === "Ready to run" && r.primaryRuleType === "Mandatory blocker");
const completeRule = select((r) => r.readinessStage === "Complete");

test("full synthetic passes are ready without misrepresenting actual implementation coverage", () => {
  const report = aggregate();
  assert.equal(report.mode, "descriptive_only");
  assert.equal(report.evaluationTimeEpochMs, referenceTime);
  assert.equal(report.coverage.totalRuleCount, 106);
  assert.equal(report.coverage.implementedRuleCount, 15);
  assert.equal(report.coverage.missingEvaluatorCount, 91);
  assert.deepEqual(new Set(report.coverage.implementedRuleIds), new Set(registry.implementedRuleIds));
  assert.deepEqual(new Set(report.coverage.missingEvaluatorRuleIds), new Set(registry.unimplementedRuleIds));
  assert.deepEqual(READINESS_STAGES.map((name) => catalog.rules.filter((r) => r.readinessStage === name).length), [57, 19, 24, 6]);
  for (const name of READINESS_STAGES) {
    const result = stage(report, name);
    const ids = catalog.rules.filter((r) => r.readinessStage === name).map((r) => r.ruleId);
    assert.equal(result.status, "ready");
    assert.equal(result.fullyEvaluated, true);
    for (const actual of [result.assignedRuleIds, result.applicableRuleIds, result.evaluatedRuleIds]) assert.deepEqual(new Set(actual), new Set(ids));
    assert.equal(result.passes.length, ids.length);
    assert.equal(result.missingRuleIds.length, 0);
    assert.equal(result.diagnosticCoveragePercent, 100);
  }
});

test("real registry findings never turn 15 implemented and 91 unimplemented into false readiness", () => {
  const results = catalog.rules.map((r) => registry.evaluate(r.ruleId, makeContext()));
  assert.equal(results.filter((r) => r.status === "unimplemented").length, 91);
  const report = aggregate(input({ results }));
  for (const result of report.stages) {
    assert.notEqual(result.status, "ready");
    assert.equal(result.fullyEvaluated, false);
    for (const id of result.assignedRuleIds.filter((id) => registry.unimplementedRuleIds.includes(id))) {
      assert.ok(result.missingRuleIds.includes(id));
      assert.ok(!result.evaluatedRuleIds.includes(id));
      assert.ok(!result.passes.some((r) => r.ruleId === id));
    }
  }
});

test("empty results are missing and conservatively applicable", () => {
  for (const result of aggregate(input({ results: [] })).stages) {
    assert.equal(result.status, "incomplete");
    assert.equal(result.fullyEvaluated, false);
    assert.deepEqual(result.missingRuleIds, result.assignedRuleIds);
    assert.deepEqual(result.applicableRuleIds, result.assignedRuleIds);
    assert.equal(result.diagnosticCoveragePercent, 0);
  }
});

test("mandatory failures block regardless of exception eligibility, as do triggered conditional failures", () => {
  assert.equal(mandatory.exceptionEligible, false);
  assert.equal(eligibleMandatory.exceptionEligible, true);
  for (const rule of [mandatory, eligibleMandatory, conditional]) {
    const result = stage(aggregate(withFinding(rule)), rule.readinessStage);
    assert.equal(result.status, "blocked");
    assert.ok(result.failedBlockers.some((r) => r.ruleId === rule.ruleId && r.status === "fail"));
    assert.ok(result.unresolvedRuleIds.includes(rule.ruleId));
  }
});

test("conditional trigger not met is not a failure and reduces applicable count only", () => {
  const result = stage(aggregate(withFinding(conditional, "not_applicable")), conditional.readinessStage);
  assert.equal(result.status, "ready");
  assert.equal(result.notApplicable.length, 1);
  assert.ok(!result.applicableRuleIds.includes(conditional.ruleId));
  assert.ok(result.evaluatedRuleIds.includes(conditional.ruleId));
  assert.equal(result.missingRuleIds.length, 0);
});

test("exception-eligible recommended failures are nonblocking", () => {
  const result = stage(aggregate(withFinding(nonblocking)), nonblocking.readinessStage);
  assert.equal(result.status, "ready");
  assert.ok(result.failedNonBlocking.some((r) => r.ruleId === nonblocking.ruleId));
  assert.equal(result.warnings.length, 0);
  assert.ok(!result.passes.some((r) => r.ruleId === nonblocking.ruleId));
});

test("non-exception-eligible warning, optional and recommended failures are nonblocking", () => {
  for (const type of ["Warning", "Optional", "Recommended default"]) {
    const rule = select((r) => r.primaryRuleType === type && !r.exceptionEligible);
    const result = stage(aggregate(withFinding(rule)), rule.readinessStage);
    assert.equal(result.status, "ready", type);
    assert.ok(result.failedNonBlocking.some((r) => r.ruleId === rule.ruleId));
    assert.ok(!result.failedBlockers.some((r) => r.ruleId === rule.ruleId));
    assert.equal(result.warnings.some((r) => r.ruleId === rule.ruleId), type === "Warning");
  }
});

test("blockers and warnings are separately reported without warnings changing blocked status", () => {
  const warning = select((r) => r.primaryRuleType === "Warning");
  const blocker = select((r) => /blocker/.test(r.primaryRuleType) && r.readinessStage === warning.readinessStage);
  const report = aggregate(input({
    results: catalog.rules.map((r) => finding(r, [blocker.ruleId, warning.ruleId].includes(r.ruleId) ? "fail" : "pass")),
  }));
  const result = stage(report, warning.readinessStage);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.failedBlockers.map((r) => r.ruleId), [blocker.ruleId]);
  assert.deepEqual(result.failedNonBlocking.map((r) => r.ruleId), [warning.ruleId]);
  assert.deepEqual(result.warnings.map((r) => r.ruleId), [warning.ruleId]);
});

test("all canonical nonblocking failures are ready with full coverage, but missing coverage is incomplete", () => {
  const nonblockingIds = new Set(catalog.rules
    .filter((r) => ["Warning", "Optional", "Recommended default"].includes(r.primaryRuleType))
    .map((r) => r.ruleId));
  const results = catalog.rules.map((r) => finding(r, nonblockingIds.has(r.ruleId) ? "fail" : "pass"));
  const complete = aggregate(input({ results }));
  for (const result of complete.stages) {
    assert.equal(result.status, "ready");
    assert.equal(result.fullyEvaluated, true);
    assert.ok(result.failedNonBlocking.every((finding) => nonblockingIds.has(finding.ruleId)));
    assert.ok(result.warnings.every((warning) =>
      result.failedNonBlocking.some((finding) => finding.ruleId === warning.ruleId)));
  }

  const omitted = select((r) => nonblockingIds.has(r.ruleId));
  const incomplete = stage(aggregate(input({
    results: results.filter((r) => r.ruleId !== omitted.ruleId),
  })), omitted.readinessStage);
  assert.equal(incomplete.status, "incomplete");
  assert.ok(incomplete.missingRuleIds.includes(omitted.ruleId));
});

test("a blocker remains blocked when a separate result is missing", () => {
  const missing = select((r) => r.readinessStage === mandatory.readinessStage && r.ruleId !== mandatory.ruleId);
  const report = aggregate(input({
    results: catalog.rules
      .filter((r) => r.ruleId !== missing.ruleId)
      .map((r) => finding(r, r.ruleId === mandatory.ruleId ? "fail" : "pass")),
  }));
  const result = stage(report, mandatory.readinessStage);
  assert.equal(result.status, "blocked");
  assert.ok(result.failedBlockers.some((r) => r.ruleId === mandatory.ruleId));
  assert.ok(result.missingRuleIds.includes(missing.ruleId));
});

test("an explicit valid exception resolves a blocker but never converts its failure to a pass", () => {
  const result = stage(aggregate(claimed(eligible)), eligible.readinessStage);
  assert.equal(result.status, "ready");
  assert.equal(result.exceptionResolvedBlockers.length, 1);
  assert.equal(result.exceptionResolvedBlockers[0].classification, "resolvedByException");
  assert.deepEqual(result.exceptionResolvedBlockers[0].originalFailure, finding(eligible, "fail"));
  assert.deepEqual(result.exceptionResolvedBlockers[0].exception, exception(eligible));
  assert.ok(result.failedBlockers.some((r) => r.ruleId === eligible.ruleId));
  assert.ok(!result.passes.some((r) => r.ruleId === eligible.ruleId));
  assert.ok(!result.unresolvedRuleIds.includes(eligible.ruleId));
});

test("unclaimed exceptions never implicitly resolve failures", () => {
  const result = stage(aggregate({ ...withFinding(eligible), exceptions: [exception(eligible)] }), eligible.readinessStage);
  assert.equal(result.status, "blocked");
  assert.equal(result.exceptionResolvedBlockers.length, 0);
});

test("non-eligible failure cannot be resolved even with an otherwise valid exception", () => {
  const rule = select((r) => !r.exceptionEligible);
  const result = stage(aggregate(claimed(rule)), rule.readinessStage);
  assert.equal(result.status, "blocked");
  assert.equal(result.exceptionResolvedBlockers.length, 0);
});

test("every non-approved decision leaves a claimed blocker unresolved", () => {
  for (const decision of ["pending", "rejected", "returned", "expired", "revoked"] as const) {
    const report = aggregate(claimed(eligible, exception(eligible, { decision })));
    const result = stage(report, eligible.readinessStage);
    assert.equal(result.status, "blocked", decision);
    assert.equal(result.exceptionResolvedBlockers.length, 0);
    assert.ok(report.issues.length + result.issues.length > 0);
  }
});

test("exception identity, exact requirement, documentary and required control fields are validated", () => {
  const patches: Record<string, unknown>[] = [
    { standardId: "other" }, { standardVersion: "other" }, { ruleId: mandatory.ruleId === eligible.ruleId ? completeRule.ruleId : mandatory.ruleId },
    { requirementOverridden: `${eligible.expectedBehavior} changed` }, { businessJustification: "too short" },
    { requestor: "" }, { reviewer: "" }, { reviewerVerificationStatus: "not_recorded" },
    { pilotAudit: { pilotReference: "", auditReference: "audit" } },
    { pilotAudit: { pilotReference: "pilot", auditReference: "" } },
    { expiresAtEpochMs: null }, { compensatingAction: null }, { compensatingAction: "   " },
  ];
  for (const patch of patches) {
    const report = aggregate(claimed(eligible, { ...exception(eligible), ...patch }));
    const result = stage(report, eligible.readinessStage);
    assert.equal(result.status, "blocked", JSON.stringify(patch));
    assert.equal(result.exceptionResolvedBlockers.length, 0);
    assert.ok(report.issues.length + result.issues.length > 0);
  }
});

test("exception temporal ordering and exclusive expiry boundary fail closed", () => {
  for (const patch of [
    { createdAtEpochMs: referenceTime }, { decisionAtEpochMs: referenceTime + 1 },
    { expiresAtEpochMs: referenceTime }, { expiresAtEpochMs: referenceTime - 1 },
    { decisionAtEpochMs: referenceTime - 201 },
  ]) assert.equal(stage(aggregate(claimed(eligible, exception(eligible, patch))), eligible.readinessStage).status, "blocked");
});

test("optional expiration and action may be absent and decision may equal observation", () => {
  const record = exception(eligible, {
    createdAtEpochMs: referenceTime, decisionAtEpochMs: referenceTime,
    expirationRequired: false, expiresAtEpochMs: null,
    compensatingActionRequired: false, compensatingAction: null,
  });
  assert.equal(stage(aggregate(claimed(eligible, record)), eligible.readinessStage).status, "ready");
});

test("duplicate exception IDs and duplicate claims cannot resolve a blocker", () => {
  const value = claimed(eligible);
  for (const patch of [{ exceptions: [...value.exceptions, ...value.exceptions] }, { exceptionClaims: [...value.exceptionClaims, ...value.exceptionClaims] }]) {
    const result = stage(aggregate({ ...value, ...patch }), eligible.readinessStage);
    assert.equal(result.status, "blocked");
    assert.equal(result.exceptionResolvedBlockers.length, 0);
  }
});

test("one exception cannot be claimed for two failing rules", () => {
  const other = select((r) => r.ruleId !== eligible.ruleId && r.exceptionEligible && /blocker/.test(r.primaryRuleType));
  const value = claimed(eligible);
  const report = aggregate({
    ...value, results: catalog.rules.map((r) => finding(r, [eligible.ruleId, other.ruleId].includes(r.ruleId) ? "fail" : "pass")),
    exceptionClaims: [...value.exceptionClaims, { ruleId: other.ruleId, exceptionId: exception(eligible).exceptionId }],
  });
  for (const rule of [eligible, other]) {
    const result = stage(report, rule.readinessStage);
    assert.equal(result.status, "blocked");
    assert.ok(!result.exceptionResolvedBlockers.some((r) => r.ruleId === rule.ruleId));
  }
});

test("invalid claimed exception for a pass or missing finding makes origin incomplete", () => {
  for (const kind of ["pass", "missing"]) {
    const rule = eligible;
    const base = claimed(rule, { ...exception(rule), reviewer: "" });
    const results = kind === "pass" ? input().results : kind === "missing"
      ? catalog.rules.filter((r) => r.ruleId !== rule.ruleId).map((r) => finding(r)) : base.results;
    const report = aggregate({ ...base, results });
    const result = stage(report, rule.readinessStage);
    assert.equal(result.status, "incomplete", kind);
    assert.ok(report.issues.length + result.issues.length > 0);
  }
});

test("claims targeting canonical nonblocking rules leave the report unchanged even with invalid documentary fields", () => {
  for (const type of ["Warning", "Optional", "Recommended default"] as const) {
    const rule = select((r) => r.primaryRuleType === type);
    const baseline = aggregate(withFinding(rule));
    const record = {
      ...exception(rule),
      businessJustification: "",
      reviewer: "",
      reviewerVerificationStatus: "not_recorded",
      pilotAudit: { pilotReference: "", auditReference: "" },
    };
    assert.deepEqual(aggregate({
      ...withFinding(rule),
      exceptions: [record],
      exceptionClaims: [{ ruleId: rule.ruleId, exceptionId: record.exceptionId }],
    }), baseline, type);
  }
});

test("WEB-SETUP-C06 remains a visible nonblocking warning", () => {
  const rule = select((r) => r.ruleId === "WEB-SETUP-C06");
  const result = stage(aggregate(withFinding(rule)), rule.readinessStage);
  assert.equal(result.status, "ready");
  assert.ok(result.failedNonBlocking.some((r) => r.ruleId === rule.ruleId));
  assert.ok(result.warnings.some((r) => r.ruleId === rule.ruleId));
  assert.ok(!result.failedBlockers.some((r) => r.ruleId === rule.ruleId));
});

test("WEB-EXC-001 cannot exempt its own failure", () => {
  const rule = select((r) => r.ruleId === "WEB-EXC-001");
  const report = aggregate(claimed(rule));
  const result = stage(report, rule.readinessStage);
  assert.equal(result.status, "blocked");
  assert.equal(result.exceptionResolvedBlockers.length, 0);
  assert.ok(result.failedBlockers.some((r) => r.ruleId === rule.ruleId));
  assert.ok(report.issues.concat(result.issues).some((issue) => /self|itself/i.test(issue.message)));
});

test("a valid exception resolves only its own blocker and the other failure remains blocked", () => {
  const other = select((r) =>
    r.ruleId !== eligible.ruleId
    && r.readinessStage === eligible.readinessStage
    && /blocker/.test(r.primaryRuleType));
  const base = claimed(eligible);
  const report = aggregate({
    ...base,
    results: catalog.rules.map((r) =>
      finding(r, [eligible.ruleId, other.ruleId].includes(r.ruleId) ? "fail" : "pass")),
  });
  const result = stage(report, eligible.readinessStage);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.exceptionResolvedBlockers.map((r) => r.ruleId), [eligible.ruleId]);
  assert.ok(result.failedBlockers.some((r) => r.ruleId === eligible.ruleId));
  assert.ok(result.failedBlockers.some((r) => r.ruleId === other.ruleId));
  assert.ok(!result.unresolvedRuleIds.includes(eligible.ruleId));
  assert.ok(result.unresolvedRuleIds.includes(other.ruleId));
});

test("missing claimed record leaves a failing blocker blocked with an explicit issue", () => {
  const report = aggregate({ ...claimed(eligible), exceptions: [] });
  const result = stage(report, eligible.readinessStage);
  assert.equal(result.status, "blocked");
  assert.ok(report.issues.length + result.issues.length > 0);
});

test("recruitment failure does not contaminate run or Complete", () => {
  const report = aggregate(withFinding(mandatory));
  assert.equal(stage(report, "Ready to recruit").status, "blocked");
  assert.equal(stage(report, "Ready to run").status, "ready");
  assert.equal(stage(report, "Ready to follow up").status, "ready");
  assert.equal(stage(report, "Complete").status, "ready");
  const historical = aggregate(input({
    results: catalog.rules.map((r) => finding(r, [mandatory.ruleId, runRule.ruleId].includes(r.ruleId) ? "fail" : "pass")),
  }));
  assert.equal(stage(historical, "Ready to recruit").status, "blocked");
  assert.equal(stage(historical, "Ready to run").status, "blocked");
  assert.equal(stage(historical, "Complete").status, "ready");
});

test("follow-up depends on run blocked or incomplete, while Complete does not", () => {
  for (const status of ["fail", "unimplemented"] as const) {
    const report = aggregate(withFinding(runRule, status));
    const expected = status === "fail" ? "blocked" : "incomplete";
    assert.equal(stage(report, "Ready to run").status, expected);
    const followup = stage(report, "Ready to follow up");
    assert.equal(followup.status, expected);
    assert.ok(followup.prerequisiteIssues.some((issue) => issue.prerequisite === "Ready to run" && issue.status === expected));
    assert.equal(stage(report, "Complete").status, "ready");
    assert.equal(stage(report, "Ready to recruit").status, "ready");
  }
});

test("follow-up own blocker still blocks when run is ready", () => {
  const rule = select((r) => r.readinessStage === "Ready to follow up" && r.primaryRuleType === "Mandatory blocker");
  const report = aggregate(withFinding(rule));
  assert.equal(stage(report, "Ready to run").status, "ready");
  assert.equal(stage(report, "Ready to follow up").status, "blocked");
  assert.equal(stage(report, "Complete").status, "ready");
});

test("Complete own failure blocks despite all obligations resolved", () => {
  assert.equal(stage(aggregate(withFinding(completeRule)), "Complete").status, "blocked");
});

test("each Complete obligation supports resolved, not applicable, unresolved and unknown", () => {
  for (const name of COMPLETE_OBLIGATIONS) for (const status of ["resolved", "not_applicable", "unresolved", "unknown"] as const) {
    const result = stage(aggregate(input({ completeObligations: { ...input().completeObligations, [name]: status } })), "Complete");
    const expected = status === "unresolved" ? "blocked" : status === "unknown" ? "incomplete" : "ready";
    assert.equal(result.status, expected, `${name}:${status}`);
    if (expected !== "ready") assert.ok(result.prerequisiteIssues.some((issue) => issue.prerequisite === name && issue.status === expected));
  }
});

test("missing Complete obligations and fields are unknown, never implicitly resolved", () => {
  const { completeObligations: omitted, ...without } = input();
  assert.equal(stage(aggregate(without), "Complete").status, "incomplete");
  for (const name of COMPLETE_OBLIGATIONS) {
    const values: Record<string, unknown> = { ...omitted };
    delete values[name];
    assert.equal(stage(aggregate({ ...input(), completeObligations: values }), "Complete").status, "incomplete");
  }
});

test("Complete unresolved obligation or own blocker dominates unknown obligation", () => {
  for (const value of [
    { ...input(), completeObligations: { ...input().completeObligations, attendanceReconciliation: "unresolved", measurementCapture: "unknown" } },
    { ...withFinding(completeRule), completeObligations: { ...input().completeObligations, measurementCapture: "unknown" } },
  ]) assert.equal(stage(aggregate(value), "Complete").status, "blocked");
});

test("global malformed structure and unknown result rules make otherwise ready stages incomplete", () => {
  for (const value of [null, [], {}, { ...input(), results: {} }, { ...input(), exceptions: {} },
    { ...input(), exceptionClaims: {} }, { ...input(), results: [...input().results, null] },
    { ...input(), results: [...input().results, { ...finding(mandatory), ruleId: "UNKNOWN" }] }]) {
    const report = aggregate(value);
    assert.ok(report.issues.length > 0);
    for (const result of report.stages) assert.equal(result.status, "incomplete");
  }
});

test("unknown result does not erase confirmed own blocker or blocked run prerequisite", () => {
  const report = aggregate({ ...withFinding(runRule), results: [...withFinding(runRule).results, { ruleId: "UNKNOWN" }] });
  assert.equal(stage(report, "Ready to run").status, "blocked");
  assert.equal(stage(report, "Ready to follow up").status, "blocked");
  assert.equal(stage(report, "Complete").status, "incomplete");
});

test("known result identity and canonical metadata mismatches invalidate only its origin stage", () => {
  const good = finding(mandatory);
  const bad = [
    { ...good, standardId: "other" }, { ...good, standardVersion: "other" },
    ...[{ primaryRuleType: "Optional" }, { readinessStage: "Complete" }, { exceptionEligible: !mandatory.exceptionEligible }]
      .map((patch) => ({ ...good, rule: { ...good.rule, ...patch } })),
  ];
  for (const result of bad) {
    const report = aggregate(input({ results: [...catalog.rules.filter((r) => r.ruleId !== mandatory.ruleId).map((r) => finding(r)), result] }));
    const origin = stage(report, mandatory.readinessStage);
    assert.equal(origin.status, "incomplete");
    assert.equal(origin.fullyEvaluated, false);
    assert.ok(origin.missingRuleIds.includes(mandatory.ruleId));
    assert.ok(!origin.evaluatedRuleIds.includes(mandatory.ruleId));
    assert.equal(stage(report, "Complete").status, "ready");
  }
});

test("malformed or inconsistent outcome, reason and mode are not evaluated passes", () => {
  for (const patch of [{ status: "ready" }, { reason: "unknown" }, { mode: "enforced" },
    { status: "pass", reason: "violation" }, { status: "fail", reason: "satisfied" },
    { status: "not_applicable", reason: "satisfied" }, { evidence: "not an array" }]) {
    const report = aggregate(input({ results: catalog.rules.map((r) => r.ruleId === mandatory.ruleId ? { ...finding(r), ...patch } : finding(r)) }));
    const result = stage(report, mandatory.readinessStage);
    assert.equal(result.status, "incomplete", JSON.stringify(patch));
    assert.ok(result.missingRuleIds.includes(mandatory.ruleId));
    assert.ok(!result.evaluatedRuleIds.includes(mandatory.ruleId));
  }
});

test("duplicate passes are missing rather than evaluated twice", () => {
  const result = stage(aggregate(input({ results: [...input().results, finding(mandatory)] })), mandatory.readinessStage);
  assert.equal(result.status, "incomplete");
  assert.equal(result.fullyEvaluated, false);
  assert.ok(result.missingRuleIds.includes(mandatory.ruleId));
  assert.ok(!result.evaluatedRuleIds.includes(mandatory.ruleId));
});

test("a valid blocker among duplicate findings remains blocked in either order", () => {
  const results = [...input().results, finding(mandatory, "fail")];
  for (const values of [results, [...results].reverse()]) {
    const result = stage(aggregate(input({ results: values })), mandatory.readinessStage);
    assert.equal(result.status, "blocked");
    assert.equal(result.fullyEvaluated, false);
    assert.ok(result.missingRuleIds.includes(mandatory.ruleId));
    assert.ok(!result.evaluatedRuleIds.includes(mandatory.ruleId));
    assert.ok(result.failedBlockers.some((r) => r.ruleId === mandatory.ruleId));
  }
});

test("invalid evaluation time is reported and cannot yield readiness", () => {
  for (const time of [undefined, null, "2030", NaN, Infinity, -Infinity]) {
    const report = aggregate({ ...input(), evaluationTimeEpochMs: time });
    assert.equal(report.evaluationTimeEpochMs, null);
    assert.ok(report.issues.length > 0);
    for (const result of report.stages) assert.equal(result.status, "incomplete");
  }
});

test("malformed and unknown claims fail closed with structured issues", () => {
  for (const claim of [null, {}, { ruleId: eligible.ruleId, exceptionId: 123 }, { ruleId: "UNKNOWN", exceptionId: "unknown" }]) {
    const report = aggregate({ ...input(), exceptionClaims: [claim] });
    assert.ok(report.issues.length > 0 || report.stages.some((r) => r.issues.length > 0));
    assert.ok(report.stages.some((r) => r.status === "incomplete"));
  }
});

test("order of results, exceptions and claims does not change report", () => {
  const other = select((r) => r.ruleId !== eligible.ruleId && r.exceptionEligible && /blocker/.test(r.primaryRuleType));
  const rules = [eligible, other];
  const value = input({
    results: catalog.rules.map((r) => finding(r, rules.some((entry) => entry.ruleId === r.ruleId) ? "fail" : "pass")),
    exceptions: rules.map((r) => exception(r)),
    exceptionClaims: rules.map((r) => ({ ruleId: r.ruleId, exceptionId: exception(r).exceptionId })),
  });
  assert.deepEqual(aggregate(value), aggregate({
    ...value, results: [...value.results].reverse(), exceptions: [...value.exceptions].reverse(),
    exceptionClaims: [...value.exceptionClaims].reverse(),
  }));
});

test("output is deeply frozen and aggregation neither mutates nor freezes caller data", () => {
  const value = structuredClone(claimed(eligible));
  const before = structuredClone(value);
  const report = aggregate(value);
  assert.deepEqual(value, before);
  assertDeepFrozen(report);
  function unfrozen(v: unknown): void {
    if (v === null || typeof v !== "object") return;
    assert.equal(Object.isFrozen(v), false);
    for (const child of Object.values(v)) unfrozen(child);
  }
  unfrozen(value);
  const record = value.exceptions[0] as WebinarException;
  (record.pilotAudit as { auditReference: string }).auditReference = "changed by caller";
  assert.equal(stage(report, eligible.readinessStage).exceptionResolvedBlockers[0].exception.pilotAudit.auditReference, "audit-1");
});

test("accessors, custom prototypes, functions and cycles are rejected without invoking getters", () => {
  let calls = 0;
  const accessor = Object.defineProperty({ ...input() }, "results", { enumerable: true, get() { calls++; throw new Error("must not execute"); } });
  const nested = Object.defineProperty({ ...finding(mandatory) }, "evidence", { enumerable: true, get() { calls++; throw new Error("must not execute"); } });
  const cyclic: Record<string, unknown> = { ...input() };
  cyclic.self = cyclic;
  const inherited = Object.create({ get results() { calls++; throw new Error("must not execute"); } });
  Object.assign(inherited, { evaluationTimeEpochMs: referenceTime });
  for (const value of [accessor, inherited, cyclic, { ...input(), results: [nested] }, { ...input(), unexpected: () => { calls++; } }]) {
    const report = aggregate(value);
    assert.ok(report.issues.length > 0);
    assert.ok(report.stages.every((r) => r.status !== "ready"));
  }
  assert.equal(calls, 0);
});

test("exception and readiness modules retain pure local dependencies without ambient execution capabilities", async () => {
  const modules = {
    "webinar-standard-exceptions": ["index.ts", "types.ts", "validate.ts"],
    "webinar-standard-readiness": ["aggregate.ts", "claims.ts", "coverage.ts", "index.ts", "result-validation.ts", "safe-data.ts", "types.ts"],
  };
  const allowedCrossImports = new Set([
    "../webinar-standard-catalog/types",
    "../webinar-standard-catalog/validate",
    "../webinar-standard-evaluation/types",
    "../webinar-standard-exceptions/types",
    "../webinar-standard-exceptions/validate",
  ]);
  const forbiddenGlobals = new Set([
    "require", "process", "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
    "Date", "Function", "eval", "globalThis", "global", "window", "document",
    "setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval",
    "clearImmediate", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
    "performance", "crypto", "navigator", "localStorage", "sessionStorage",
    "Worker", "SharedWorker", "Deno", "Bun",
  ]);
  for (const [moduleName, knownFiles] of Object.entries(modules)) {
    const directory = new URL(`../../src/lib/${moduleName}/`, import.meta.url);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".ts")).sort();
    assert.deepEqual(files, [...knownFiles].sort(), `${moduleName}: review new modules before expanding the pure boundary`);
    const localImports = new Set(knownFiles.map((name) => `./${name.slice(0, -3)}`));
    for (const filename of files) {
      const location = `${moduleName}/${filename}`;
      const source = ts.createSourceFile(location, await readFile(new URL(filename, directory), "utf8"), ts.ScriptTarget.Latest, true);
      const dependency = (target: string): void => {
        assert.ok(localImports.has(target) || allowedCrossImports.has(target), `${location}: forbidden dependency ${target}`);
      };
      const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
          assert.ok(ts.isStringLiteral(node.moduleSpecifier), `${location}: dependency must be a literal`);
          const target = node.moduleSpecifier.text;
          dependency(target);
          if (target === "../webinar-standard-evaluation/types" || target === "../webinar-standard-exceptions/types") {
            const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
            assert.equal(typeOnly, true, `${location}: ${target} must remain type-only`);
          }
        }
        assert.ok(!ts.isImportEqualsDeclaration(node), `${location}: import-equals is forbidden`);
        if (ts.isImportTypeNode(node)) {
          assert.ok(ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal), `${location}: import type must be literal`);
          dependency(node.argument.literal.text);
        }
        if (ts.isIdentifier(node)) assert.ok(!forbiddenGlobals.has(node.text), `${location}: forbidden global ${node.text}`);
        if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, `${location}: dynamic import is forbidden`);
        // Reject aliases/destructuring as well as direct or computed Math.random calls.
        if (ts.isIdentifier(node) && node.text === "Math") {
          const parent = node.parent;
          assert.ok(ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text !== "random",
            `${location}: Math may only expose deterministic named operations`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
});