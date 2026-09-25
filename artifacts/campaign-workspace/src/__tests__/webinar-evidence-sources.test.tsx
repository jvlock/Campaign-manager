import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WebinarApiEvidenceList, WebinarApiEvidenceListAvailableSourcesItem } from '@workspace/api-client-react';
import { TooltipProvider } from '../components/ui/tooltip';
import { EvidencePanel } from '../components/webinar-workspace/evidence';
import { availableSourcesOf, evidenceSourceChoices } from '../lib/webinar-workspace/adapters';

const H = 'b'.repeat(64);
const C = 'c'.repeat(64);
const ok = (sourceId: string, sourceType: WebinarApiEvidenceListAvailableSourcesItem['sourceType'], sourceVersion: string, sourceHash: string): WebinarApiEvidenceListAvailableSourcesItem =>
  ({ sourceId, sourceType, sourceVersion, sourceHash, usable: true, unavailableReason: null });
const sources: WebinarApiEvidenceListAvailableSourcesItem[] = [
  ok('occ-7f3a', 'occurrence', '3', H),
  ok('comm-19c2', 'content', '12', C),
  { ...ok('comm-expired', 'content', '9', H), usable: false, unavailableReason: 'Source version expired.' },
  { ...ok('occ-missing', 'occurrence', '2', C), usable: false, unavailableReason: 'Source row missing.' },
];
const evidence = { revision: 5, records: [], availableSources: sources } as unknown as WebinarApiEvidenceList;

test('picker offers usable availableSources with exact fields, even with zero records', () => {
  const qa = evidenceSourceChoices(availableSourcesOf(evidence)!, 'qa');
  assert.deepEqual(qa.map((c) => [c.sourceId, c.sourceType, c.sourceVersion, c.sourceHash]), [
    ['occ-7f3a', 'occurrence', '3', H], ['comm-19c2', 'content', '12', C],
  ]);
});

test('usable:false is excluded even with a valid version and hash (expired / missing)', () => {
  const ids = evidenceSourceChoices(sources, 'source-observation').map((c) => c.sourceId);
  assert.ok(!ids.includes('comm-expired') && !ids.includes('occ-missing'));
  assert.deepEqual(ids, ['occ-7f3a', 'comm-19c2']);
});

test('unsupported source types (snapshot / provenance) are excluded', () => {
  const odd = [{ ...ok('snap-1', 'occurrence', '1', H), sourceType: 'snapshot' }, { ...ok('prov-1', 'occurrence', '1', H), sourceType: 'provenance' }] as unknown as WebinarApiEvidenceListAvailableSourcesItem[];
  assert.equal(evidenceSourceChoices(odd, 'source-observation').length, 0);
});

test('loading evidence offers nothing; engine evaluation refs are never used', () => {
  assert.equal(availableSourcesOf(undefined), null);
  const src = readFileSync(new URL('../components/webinar-workspace/evidence.tsx', import.meta.url), 'utf8');
  assert.ok(!/sourceReferences|sourceRefs/.test(src));
});

const render = (ev: WebinarApiEvidenceList) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(TooltipProvider, null,
  h(EvidencePanel, { campaignId: 'c', sessionId: 's', evidence: ev, timezone: 'UTC', announce: () => {} }))));

test('panel renders a picker with no records; all-unusable shows no picker', () => {
  const withList = render(evidence);
  assert.match(withList, /No evidence recorded for this webinar yet/);
  assert.match(withList, /role="combobox"/);
  const none = render({ ...evidence, availableSources: sources.filter((s) => !s.usable) });
  assert.ok(!/role="combobox"/.test(none));
  assert.match(none, /No usable scoped source/);
});

test('task panel ids are unique per rendering (desktop aside + mobile sheet)', () => {
  const src = readFileSync(new URL('../pages/campaigns/WebinarWorkspace.tsx', import.meta.url), 'utf8');
  assert.ok(!/id="ww-(next|crit|fresh)-h"/.test(src));
  assert.match(src, /renderTaskPanel\('desktop'\)/); assert.match(src, /renderTaskPanel\('mobile'\)/);
});
