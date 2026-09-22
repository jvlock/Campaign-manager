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
  not_applicable: false,
  unimplemented: false,
} as const satisfies Record<EvaluationStatus, boolean>;

test("failure classifier covers every canonical type, eligibility value and evaluation status", () => {
  assert.deepEqual(Object.keys(blockingByType).sort(), [...PRIMARY_RULE_TYPES].sort());

  for (const primaryRuleType of PRIMARY_RULE_TYPES) {
    const authenticRule = select((rule) => rule.primaryRuleType === primaryRuleType);
    for (const exceptionEligible of [false, true] as const) {
      for (const status of Object.keys(failureByStatus) as EvaluationStatus[]) {
        const result = finding(authenticRule, status);
        const classified = {
          ...result,
          rule: { ...result.rule, primaryRuleType, exceptionEligible },
        };
        assert.equal(
          isBlockingFailure(classified),
          blockingByType[primaryRuleType] && failureByStatus[status],
          `${primaryRuleType}; exceptionEligible=${exceptionEligible}; status=${status}`,
        );
      }
    }
  }
});