import assert from "node:assert/strict";
import { test } from "node:test";
import { planWebinarRecruitment } from "../../src/lib/webinar-standard-scheduling";
import { validateWebinarException } from "../../src/lib/webinar-standard-exceptions";
import { aggregateWebinarReadiness } from "../../src/lib/webinar-standard-readiness";
import { exception, input, stage } from "../readiness/fixtures";
import { catalog, registry } from "./fixtures";
import { evidence, fixture, now, touches } from "./governed-fixtures";
import type { EvaluationContext, RuleEvaluationResult } from "../../src/lib/webinar-standard-evaluation";
import type { RuleId } from "../../src/lib/webinar-standard-catalog/types";

function dependent(result: RuleEvaluationResult): EvaluationContext {
  const base = fixture("WEB-REC-010");
  const p = planWebinarRecruitment(catalog, { calculationInstantEpochMs: now,
    webinarStartEpochMs: base.event.startsAtEpochMs!, timeZone: "UTC", eventStatus: "scheduled",
    standardId: catalog.standardId, standardVersion: catalog.standardVersion, touches });
  const configured = { snapshotId: "configured-1", occurrenceId: "occurrence-1", eventId: "event-1",
    standardId: catalog.standardId, standardVersion: catalog.standardVersion, complete: true,
    touches: p.touches.map(t => ({ identity: t.identity, communicationId: t.communicationId,
      disposition: t.disposition, scheduledAtEpochMs: t.scheduledAtEpochMs })), surfacedWarnings: p.warnings };
  const ids: RuleId[] = ["WEB-REC-005", "WEB-REC-006", "WEB-REC-007", "WEB-REC-008", "WEB-REC-009", "WEB-REC-010"];
  return { ...base, scheduling: { evaluationStage: "Ready to recruit", occurrenceId: "occurrence-1",
    timeZone: "UTC", recruitmentPlan: p, configuredPlan: configured, creationSnapshot: null, omissionDisplay: null,
    suppression: { snapshotId: "input-1", occurrenceId: "occurrence-1", eventId: "event-1",
      standardId: catalog.standardId, standardVersion: catalog.standardVersion, observedAtEpochMs: now,
      completePopulation: true, recruitmentCommunicationIds: touches.map(t => t.communicationId),
      audiencePlan: base.governed!.exclusion!.audiencePlan, observations: [],
      controls: ids.map(ruleId => ({ ruleId, active: true, evidence: {
        ...evidence("WEB-REC-010"), ruleId, evidenceId: `control-${ruleId}`,
      } })),
      // Existing unrelated prerequisite fixture findings; REC010 is always the ACTUAL new evaluator result.
      prerequisiteResults: ids.map(ruleId => ruleId === "WEB-REC-010" ? result : {
        mode: "descriptive_only", standardId: catalog.standardId, standardVersion: catalog.standardVersion,
        ruleId, rule: catalog.rules.find(r => r.ruleId === ruleId)!, status: "pass", reason: "satisfied",
        participantId: null, evidence: ["Independent prerequisite fixture"],
      }),
    } } };
}
for (const status of ["pass", "fail", "unavailable", "invalid"] as const) {
  test(`actual REC010 ${status} propagates through unchanged RDY-REC-006 controls`, () => {
    const c: any = structuredClone(fixture("WEB-REC-010"));
    if (status === "fail") c.governed.exclusion.operational[0].recipientObservations[0].included = true;
    if (status === "unavailable") c.governed.exclusion.observations = [];
    if (status === "invalid") c.governed.exclusion.observations[0].source = "manual";
    const actual = registry.evaluate("WEB-REC-010", c);
    const result = registry.evaluate("WEB-RDY-REC-006", dependent(actual));
    assert.equal(result.status, status === "unavailable" ? "evidence_unavailable" : status === "invalid" ? "fail" : status, JSON.stringify(result.evidence));
    assert.equal(result.reason, status === "invalid" ? "invalid_context" : status === "unavailable" ? "missing_evidence" : status === "fail" ? "violation" : "satisfied");
  });
}
for (const ruleId of ["WEB-SETUP-003", "WEB-REC-010"] as const) {
  for (const status of ["fail", "unavailable", "invalid"] as const) {
    test(`${ruleId}: real exception validation/readiness cannot resolve ${status}`, () => {
      const c: any = structuredClone(fixture(ruleId));
      const value = c.governed[ruleId === "WEB-SETUP-003" ? "objective" : "exclusion"];
      if (status === "unavailable") value.observations = [];
      if (status === "invalid") value.observations[0].source = "manual";
      if (status === "fail" && ruleId === "WEB-SETUP-003") value.observations[0].decision = false;
      if (status === "fail" && ruleId === "WEB-REC-010") value.operational[0].recipientObservations[0].included = true;
      const actual = registry.evaluate(ruleId, c);
      const rule = catalog.rules.find(r => r.ruleId === ruleId)!;
      const record = exception(rule);
      assert.equal(validateWebinarException(record, catalog, now, ruleId).ok, false);
      const readiness = stage(aggregateWebinarReadiness(catalog, registry, input({
        results: [actual], exceptions: [record], exceptionClaims: [{ ruleId, exceptionId: record.exceptionId }],
      })), rule.readinessStage);
      assert.equal(readiness.exceptionResolvedBlockers.length, 0);
      assert.notEqual(readiness.status, "ready");
      assert.equal(actual.reason, status === "invalid" ? "invalid_context" : status === "unavailable" ? "missing_evidence" : "violation");
    });
  }
}