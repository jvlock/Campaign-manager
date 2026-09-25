import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWebinarUpdate, sessionToDraft } from '../pages/campaigns/WebinarWorkspace';
import { classifyError, isDirty, touchesTiming } from '../lib/webinar-workspace/adapters';

const session = {
  id: 's', name: 'Spring clinic briefing', sessionDate: '2026-05-12', startTime: '14:00', durationMinutes: 60, timezone: 'America/New_York',
  platform: 'zoom', speakers: [{ name: 'Mara Ilves' }], registrationRule: { suppressRecruitmentAfterRegistration: true },
  recruitmentLaunchAt: '2026-04-20T13:00:00.000Z', editVersion: 'e'.repeat(64),
} as never;

test('untouched draft is clean and produces an empty patch', () => {
  const base = sessionToDraft(session);
  assert.equal(isDirty(base, sessionToDraft(session)), false);
  for (const step of ['who', 'what', 'when', 'where'] as const) assert.deepEqual(buildWebinarUpdate(step, base, { ...base }), {});
});

test('patch contains only the current step fields that changed', () => {
  const base = sessionToDraft(session);
  const draft = { ...base, name: 'Renamed ', platform: 'teams', durationMinutes: '90' };
  assert.deepEqual(buildWebinarUpdate('what', base, draft), {}, 'governed name is never sent');
  const sp = buildWebinarUpdate('what', base, { ...draft, speakers: [{ name: 'Ines Okafor', role: 'Host', organization: '' }] });
  assert.deepEqual(sp, { speakers: [{ name: 'Ines Okafor', role: 'Host' }] });
  assert.deepEqual(buildWebinarUpdate('where', base, draft), { platform: 'teams' });
  const when = buildWebinarUpdate('when', base, draft);
  assert.deepEqual(when, { durationMinutes: 90 });
  assert.equal(touchesTiming(when as Record<string, unknown>), true);
});

test('timezone change re-anchors recruitment launch; suppression is never editable', () => {
  const base = sessionToDraft(session);
  const when = buildWebinarUpdate('when', base, { ...base, timezone: 'UTC' });
  assert.equal(when.timezone, 'UTC');
  assert.equal(when.recruitmentLaunchAt, '2026-04-20T09:00:00.000Z');
  // Suppression is canonical/read-only: no draft field and never in any patch.
  assert.ok(!('suppress' in base));
  for (const step of ['why', 'who', 'what', 'when', 'where', 'how', 'review'] as const) {
    assert.ok(!('registrationRule' in buildWebinarUpdate(step, base, { ...base, name: 'x', platform: 'teams', timezone: 'UTC' })), `${step} must not send registrationRule`);
  }
});

test('save failure and conflict classification keep the draft and never auto-retry', () => {
  const conflict = classifyError({ status: 409, data: { error: { code: 'CONFLICT', message: 'Version mismatch' } } });
  assert.equal(conflict.kind, 'conflict'); assert.equal(conflict.retrySafe, false);
  const validation = classifyError({ status: 400, data: { error: { code: 'VALIDATION_ERROR', field: 'durationMinutes', message: 'too long' } } });
  assert.equal(validation.retrySafe, false); assert.equal(validation.field, 'durationMinutes');
  assert.equal(classifyError({ status: 500, data: {} }).retrySafe, true);
});

test('regression: no step ever sends name (400 name policy), including date saves', () => {
  const base = sessionToDraft(session);
  const draft = { ...base, name: 'Hand typed title', sessionDate: '2026-06-02', startTime: '15:30', timezone: 'UTC', platform: 'teams' };
  for (const step of ['why', 'who', 'what', 'when', 'where', 'how', 'review'] as const) {
    const out = buildWebinarUpdate(step, base, draft);
    assert.ok(!('name' in out) && !('namingInput' in out) && !('generatedName' in out), `${step} leaked a name field`);
  }
  const when = buildWebinarUpdate('when', base, draft);
  assert.equal(when.sessionDate, '2026-06-02'); assert.equal(when.startTime, '15:30');
});
