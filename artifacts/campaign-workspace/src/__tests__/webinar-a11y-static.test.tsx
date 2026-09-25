import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { Layout } from '../components/layout';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('viewport meta allows zoom (no maximum-scale / user-scalable=no)', () => {
  const meta = read('../../index.html').match(/<meta name="viewport"[^>]*>/)?.[0] ?? '';
  assert.match(meta, /width=device-width/);
  assert.ok(!/maximum-scale|user-scalable\s*=\s*no/i.test(meta), meta);
});

test('shell renders exactly one main; open-development banner is a div status, not a landmark', () => {
  const html = renderToStaticMarkup(h(Router, { ssrPath: '/campaigns' }, h(Layout, null, h('p', null, 'x'))));
  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  assert.match(html, /<div role="status" data-testid="open-development-banner"/);
  assert.ok(!/<aside[^>]*role="status"/.test(html));
});

test('webinar workspace never renders its own main landmark', () => {
  const src = read('../pages/campaigns/WebinarWorkspace.tsx');
  assert.ok(!/<main\b/.test(src));
  assert.match(src, /<section className="min-w-0 overflow-x-hidden" aria-labelledby="ww-title"/);
});

test('ribbon and header use flat backgrounds (no gradients) for resolvable contrast', () => {
  const css = read('../index.css');
  for (const cls of ['.ww-sim-ribbon', '.ww-hero']) {
    const rule = css.match(new RegExp(`\\${cls} \\{[^}]*\\}`))?.[0] ?? '';
    assert.ok(rule && !/gradient/.test(rule), `${cls}: ${rule}`);
  }
});
