import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRIMARY_RULE_TYPES,
  type PrimaryRuleType,
} from "../../src/lib/webinar-standard-catalog/types";
import type { EvaluationStatus } from "../../src/lib/webinar-standard-evaluation/types";
import { isBlockingFailure } from "../../src/lib/webinar-standard-readiness/claims";
import { finding, select } from "./fixtures";

const blockingByType = {
  "Mandatory blocker": true,
  "Conditional blocker": true,
  "Optional": false,
  "Warning": false,
  "Recommended default": false,
} as const satisfies Record<PrimaryRuleType, boolean>;

const failureByStatus = {
  pass: false,
  fail: true,
  evidence_unavailable: false,
  not_applicable: false,
  unimplemented: false,
} as const satisfies Record<EvaluationStatus, boolean>;

test("classifier matrix covers every declared primary rule type", () => {
  assert.deepEqual(Object.keys(blockingByType).sort(), [...PRIMARY_RULE_TYPES].sort());
});

for (const primaryRuleType of PRIMARY_RULE_TYPES) {
  for (const exceptionEligible of [false, true] as const) {
    for (const status of Object.keys(failureByStatus) as EvaluationStatus[]) {
      const expectedBlocking = blockingByType[primaryRuleType] && failureByStatus[status];
      test(`${primaryRuleType}; status=${status}; exceptionEligible=${exceptionEligible}; expectedBlocking=${expectedBlocking}`, () => {
        const authenticRule = select((rule) => rule.primaryRuleType === primaryRuleType);
        const result = finding(authenticRule, status);
        const classified = {
          ...result,
          rule: { ...result.rule, primaryRuleType, exceptionEligible },
        };
        assert.equal(isBlockingFailure(classified), expectedBlocking);
      });
    }
  }
}

test("WEB-SETUP-C06; Warning; status=fail; exceptionEligible=false; expectedBlocking=false", () => {
  const rule = select((entry) => entry.ruleId === "WEB-SETUP-C06");
  assert.equal(rule.primaryRuleType, "Warning");
  assert.equal(rule.exceptionEligible, false);
  assert.equal(isBlockingFailure(finding(rule, "fail")), false);
});