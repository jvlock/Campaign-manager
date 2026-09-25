import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyError, describeTiming, touchState, orderTimeline, stageLabel, recruitmentCounts, overdueLabel, overdueAuthorityFromPreview, executionLabel, simulationReadinessText, EXECUTION_EVIDENCE_AVAILABLE, exceptionEligibility,
  evidenceSourceChoices, capabilityState, isDirty, changedFields, touchesTiming, summarizeDateImpact, freshness, stepForField, ANALYTICS_EVENTS,
} from '../lib/webinar-workspace/adapters';

const now = new Date('2026-03-01T00:00:00Z');
const H = 'a'.repeat(64);

test('classifies structured conflict as non-retryable, draft-preserving', () => {
  const c = classifyError({ status: 409, data: { error: { code: 'CONFLICT', message: 'stale' } } });
  assert.equal(c.kind, 'conflict'); assert.equal(c.retrySafe, false); assert.match(c.nextAction, /kept/);
  assert.equal(classifyError({ status: 400, data: { error: { code: 'VALIDATION_ERROR', field: 'startTime', message: 'x' } } }).field, 'startTime');
  assert.equal(classifyError(new TypeError('fetch')).kind, 'network');
});

test('timing text comes from engine descriptor, never hardcoded', () => {
  assert.equal(describeTiming({ timing: { kind: 'relative', direction: 'before', offset: 21, unit: 'days' } } as never), '21 days before event');
  assert.equal(describeTiming({ timing: { kind: 'relative', direction: 'after', offset: 1, unit: 'hours' } } as never), '1 hour after event');
});

test('touch state never fabricates sent or overdue from local clock or status text', () => {
  assert.equal(touchState({ status: 'planned', scheduled: { status: 'scheduled', effectiveAt: '2020-01-01T00:00:00Z' } } as never), 'planned', 'past instant is not locally overdue');
  assert.equal(touchState({ status: 'executed', scheduled: { status: 'sent', effectiveAt: '2020-01-01T00:00:00Z' } } as never), 'planned', 'status text never implies execution');
  assert.equal(touchState({ status: 'planned', scheduled: { status: 'suppressed' } } as never), 'suppressed');
  assert.equal(touchState({ status: 'planned', scheduled: { status: 'scheduled' } } as never), 'unscheduled');
  assert.equal(EXECUTION_EVIDENCE_AVAILABLE, false);
  assert.equal(executionLabel(), 'Execution unknown');
});

test('overdue only from backend preview authority; otherwise unknown', () => {
  assert.equal(overdueLabel('recruitment_1', null), 'Overdue unknown');
  const auth = overdueAuthorityFromPreview({ calculatedAt: '2026-03-01T00:00:00Z', touches: [
    { key: 'recruitment_1', previous: { overdue: true }, proposed: { overdue: true }, shortenedWindow: false },
    { key: 'recruitment_2', previous: { overdue: false }, proposed: { overdue: true }, shortenedWindow: true },
  ] } as never);
  assert.equal(overdueLabel('recruitment_1', auth), 'Overdue');
  assert.equal(overdueLabel('recruitment_2', auth), 'Not overdue', 'current state uses previous (current values), not proposed');
  assert.equal(overdueLabel('recruitment_3', auth), 'Overdue unknown');
});

test('recruitment counts: no complete claim, overdue unknown without authority', () => {
  const c = (key: string, ok: boolean) => ({ key, sortOrder: 1, scheduled: { status: 'scheduled', effectiveAt: '2020-01-01T00:00:00Z' }, ctas: ok ? [{ destinationUrl: 'https://x.test' }] : [], variants: [{ validation: { valid: ok } }] });
  const items = [c('recruitment_1', true), c('recruitment_2', false)] as never[];
  const none = recruitmentCounts(items, null);
  assert.equal(none.overdue, null); assert.equal(none.withContentAndDestination, 1);
  assert.ok(!('complete' in none) && !('executed' in none));
  const auth = { calculatedAt: 'x', byKey: { recruitment_1: { overdue: true, shortenedWindow: false }, recruitment_2: { overdue: false, shortenedWindow: false } } };
  assert.equal(recruitmentCounts(items, auth).overdue, 1);
  assert.equal(recruitmentCounts(items, { calculatedAt: 'x', byKey: { recruitment_1: auth.byKey.recruitment_1 } }).overdue, null, 'partial authority is unknown');
});

test('timeline order preserves engine sortOrder, never reorders by instant', () => {
  const items = [{ key: 'b', sortOrder: 2, scheduled: { effectiveAt: '2020-01-01T00:00:00Z' } }, { key: 'a', sortOrder: 1, scheduled: { effectiveAt: '2030-01-01T00:00:00Z' } }] as never[];
  assert.deepEqual(orderTimeline(items).map((i: { key: string }) => i.key), ['a', 'b']);
});

test('readiness label is projected, not computed', () => {
  assert.equal(stageLabel(undefined), 'Not evaluated');
  assert.equal(stageLabel({ status: 'ready', fullyEvaluated: true } as never), 'Ready');
  assert.equal(stageLabel({ status: 'blocked', fullyEvaluated: true } as never), 'Blocked');
  assert.equal(simulationReadinessText({ status: 'ready', fullyEvaluated: true } as never), 'Simulation readiness (non-operational): Ready');
});

test('exception eligibility only for failed eligible blockers', () => {
  const f = (o: object) => ({ status: 'fail', ruleId: 'WEB-1', rule: { exceptionEligible: true }, ...o }) as never;
  assert.equal(exceptionEligibility(f({}), true).eligible, true);
  assert.equal(exceptionEligibility(f({}), false).eligible, false);
  assert.equal(exceptionEligibility(f({ status: 'pass' }), true).eligible, false);
  assert.equal(exceptionEligibility(f({ rule: { exceptionEligible: false } }), true).eligible, false);
  assert.equal(exceptionEligibility(f({ ruleId: 'WEB-EXC-001' }), true).eligible, false);
});

test('evidence sources require exact version and hash', () => {
  const refs = [
    { sourceType: 'content', sourceId: 'c1', sourceVersion: '3', sourceHash: H , usable: true, unavailableReason: null },
    { sourceType: 'content', sourceId: 'c2', sourceVersion: '', sourceHash: H , usable: true, unavailableReason: null },
    { sourceType: 'content', sourceId: 'c3', sourceVersion: '1', sourceHash: 'nothex' , usable: true, unavailableReason: null },
    { sourceType: 'delivery', sourceId: 'd1', sourceVersion: '1', sourceHash: H , usable: true, unavailableReason: null },
  ] as never[];
  assert.deepEqual(evidenceSourceChoices(refs, 'manual-review').map((c) => c.sourceId), ['c1']);
  assert.equal(evidenceSourceChoices(refs, 'source-observation').length, 2);
});

test('capability states never show unsupported as available', () => {
  assert.equal(capabilityState(undefined), 'unsupported');
  assert.equal(capabilityState({ status: 'available-synthetic', availableFromRealProvider: false } as never), 'available-synthetic');
  assert.equal(capabilityState({ status: 'not_configured' } as never), 'not_configured');
  assert.equal(capabilityState({ status: 'failed', error: 'invalid payload' } as never), 'invalid_response');
  assert.equal(capabilityState(undefined, { refreshing: true }), 'refreshing');
});

test('dirty tracking is key-order independent and minimal', () => {
  assert.equal(isDirty({ a: 1, b: [1] }, { b: [1], a: 1 }), false);
  assert.equal(isDirty({ a: 1 }, { a: 2 }), true);
  assert.deepEqual(changedFields({ a: 1, b: 2 }, { a: 1, b: 3 }), { b: 3 });
  assert.equal(touchesTiming({ name: 'x' }), false);
  assert.equal(touchesTiming({ startTime: '10:00' }), true);
});

test('date impact summary flags newly overdue and shortened', () => {
  const t = (o: object) => ({ key: 'k', name: 'n', timing: {}, previous: { overdue: false }, proposed: { overdue: false }, changed: false, shortenedWindow: false, ...o });
  const s = summarizeDateImpact({ touches: [t({ changed: true, proposed: { overdue: true } }), t({ key: 'u' })], warnings: [], blockers: [] } as never);
  assert.equal(s.changed.length, 1); assert.equal(s.newlyOverdue.length, 1); assert.equal(s.requiresConfirmation, true);
  const none = summarizeDateImpact({ touches: [t({})], warnings: [], blockers: [] } as never);
  assert.equal(none.requiresConfirmation, false);
});

test('freshness marks local changes stale; field-step mapping; analytics documented only', () => {
  assert.equal(freshness('current', true), 'stale_pending_save');
  assert.equal(freshness(undefined, false), 'not_evaluated');
  assert.equal(stepForField('sessionDate'), 'when');
  assert.equal(stepForField('platform'), 'where');
  assert.ok(ANALYTICS_EVENTS.includes('webinar_setup_started'));
});
