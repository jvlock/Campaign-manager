// Presentation routing only: which workspace location lets a user address a
// canonical WEB-STANDARD-001 rule. This never evaluates rules or changes results.
// IDs come from docs/standards/webinar/WEB-STANDARD-001.rules.json.
import type { SetupStepId } from './adapters';

export type RuleRoute = Exclude<SetupStepId, 'review'> | 'recruitment';

const GROUPS: Record<RuleRoute, readonly string[]> = {
  why: ['WEB-SETUP-003', 'WEB-SETUP-018', 'WEB-MEAS-001'],
  who: ['WEB-SETUP-004', 'WEB-SETUP-020', 'WEB-SETUP-C02', 'WEB-SETUP-C05', 'WEB-SETUP-C07', 'WEB-QA-007'],
  what: ['WEB-SETUP-001', 'WEB-SETUP-002', 'WEB-SETUP-012', 'WEB-SETUP-016', 'WEB-SETUP-017', 'WEB-SETUP-019', 'WEB-QA-001', 'WEB-QA-002', 'WEB-QA-006', 'WEB-RDY-RUN-002', 'WEB-RDY-RUN-003', 'WEB-RDY-RUN-004'],
  when: ['WEB-SETUP-005', 'WEB-SETUP-006', 'WEB-SETUP-007', 'WEB-SETUP-008', 'WEB-REG-007'],
  where: ['WEB-SETUP-009', 'WEB-SETUP-010', 'WEB-SETUP-011', 'WEB-QA-004', 'WEB-QA-005', 'WEB-RDY-REC-003', 'WEB-RDY-REC-008', 'WEB-RDY-RUN-001'],
  how: ['WEB-SETUP-013', 'WEB-SETUP-014', 'WEB-SETUP-015', 'WEB-SETUP-C01', 'WEB-SETUP-C04', 'WEB-SETUP-C06', 'WEB-QA-003', 'WEB-QA-008', 'WEB-QA-009',
    'WEB-RDY-REC-001', 'WEB-RDY-REC-002', 'WEB-RDY-REC-004', 'WEB-RDY-REC-007', 'WEB-RDY-RUN-005', 'WEB-RDY-RUN-006',
    'WEB-REG-001', 'WEB-REG-002', 'WEB-REG-003', 'WEB-REG-004', 'WEB-REG-005', 'WEB-REG-006', 'WEB-REG-008'],
  recruitment: ['WEB-REC-001', 'WEB-REC-002', 'WEB-REC-003', 'WEB-REC-004', 'WEB-REC-005', 'WEB-REC-006', 'WEB-REC-007', 'WEB-REC-008', 'WEB-REC-009', 'WEB-REC-010', 'WEB-REC-011',
    'WEB-WIN-001', 'WEB-WIN-002', 'WEB-WIN-003', 'WEB-WIN-004', 'WEB-WIN-005', 'WEB-WIN-006', 'WEB-WIN-007', 'WEB-RDY-REC-005', 'WEB-RDY-REC-006'],
};

export const RULE_ROUTE: Readonly<Record<string, RuleRoute>> = Object.freeze(
  Object.fromEntries((Object.entries(GROUPS) as [RuleRoute, readonly string[]][]).flatMap(([route, ids]) => ids.map((id) => [id, route]))),
);

/** Unmapped rule IDs route to Review rather than guessing. */
export function ruleRoute(ruleId: string): RuleRoute | 'review' {
  return RULE_ROUTE[ruleId] ?? 'review';
}
