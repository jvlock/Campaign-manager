import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '../components/ui/tooltip';
import { StatusChip, CapabilityStatus } from '../components/webinar-workspace/status';
import { validateStep } from '../components/webinar-workspace/setup';

const wrap = (el: ReturnType<typeof h>) => renderToStaticMarkup(h(TooltipProvider, null, el));

test('status chip pairs icon with text (not color alone)', () => {
  const html = wrap(h(StatusChip, { label: 'Blocked' }));
  assert.match(html, /Blocked/); assert.match(html, /<svg/); assert.match(html, /data-tone="blocked"/);
});

test('unsupported capability renders as unavailable, never blank success', () => {
  const html = wrap(h(CapabilityStatus, { type: 'objective_membership' }));
  assert.match(html, /Unsupported/); assert.match(html, /Not Foundation governed/); assert.doesNotMatch(html, /Available/);
});

test('synthetic capability carries simulation label', () => {
  const html = wrap(h(CapabilityStatus, { type: 'taxonomy', output: { status: 'available-synthetic', availableFromRealProvider: false, error: null, taxonomyVersion: 'v1', createdAt: null } as never }));
  assert.match(html, /Simulation/);
});

test('when-step validation requires explicit timezone and valid duration', () => {
  const d = { name: 'x', sessionDate: '2026-05-01', startTime: '25:00', durationMinutes: '0', timezone: '', platform: 'zoom', speakers: [], recruitmentLaunchLocal: '' };
  const e = validateStep('when', d, []);
  assert.ok(e.startTime); assert.ok(e.durationMinutes); assert.ok(e.timezone); assert.equal(e.sessionDate, undefined);
});
