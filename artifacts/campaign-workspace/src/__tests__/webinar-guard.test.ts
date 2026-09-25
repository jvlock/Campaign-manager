import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installBackGuard, isGuardState, type GuardWindow } from '../lib/webinar-workspace/navigation-guard';
import { RULE_ROUTE, ruleRoute } from '../lib/webinar-workspace/rule-routes';

/** Minimal browser-history model: entries + index, popstate fired async like browsers. */
function fakeWindow(urls: string[]) {
  const entries = urls.map((url) => ({ url, state: null as unknown }));
  let index = entries.length - 1;
  const listeners = new Set<() => void>();
  const win: GuardWindow & { flush(): void; index(): number; length(): number; url(): string } = {
    history: {
      get state() { return entries[index].state; },
      pushState(data, _u, url) { entries.splice(index + 1); entries.push({ url: url ?? entries[index].url, state: data }); index += 1; },
      go(delta) { queue.push(() => { index = Math.max(0, Math.min(entries.length - 1, index + delta)); for (const l of [...listeners]) l(); }); },
    },
    get location() { return { href: entries[index].url }; },
    addEventListener: (_t, fn) => { listeners.add(fn); },
    removeEventListener: (_t, fn) => { listeners.delete(fn); },
    flush() { while (queue.length) queue.shift()!(); },
    index: () => index, length: () => entries.length, url: () => entries[index].url,
  };
  const queue: (() => void)[] = [];
  return win;
}

test('browser Back while dirty is blocked, URL kept, confirmation requested', () => {
  const w = fakeWindow(['/campaigns/c', '/campaigns/c/webinars/s/setup']);
  let blocked = 0;
  installBackGuard(w, () => { blocked += 1; });
  assert.equal(w.length(), 3); assert.ok(isGuardState(w.history.state));
  w.history.go(-1); w.flush();
  assert.equal(blocked, 1);
  assert.equal(w.url(), '/campaigns/c/webinars/s/setup');
  assert.ok(isGuardState(w.history.state), 'sentinel restored so the next Back is guarded too');
  w.history.go(-1); w.flush();
  assert.equal(blocked, 2);
});

test('confirming discard performs the original Back', () => {
  const w = fakeWindow(['/campaigns/c', '/campaigns/c/webinars/s/setup']);
  const g = installBackGuard(w, () => {});
  w.history.go(-1); w.flush();
  g.release(); w.flush();
  assert.equal(w.url(), '/campaigns/c');
});

test('dispose after save removes the sentinel without leaving the page', () => {
  const w = fakeWindow(['/campaigns/c', '/campaigns/c/webinars/s/setup']);
  let blocked = 0;
  const g = installBackGuard(w, () => { blocked += 1; });
  g.dispose(); w.flush();
  assert.equal(w.url(), '/campaigns/c/webinars/s/setup');
  assert.ok(!isGuardState(w.history.state));
  w.history.go(-1); w.flush();
  assert.equal(blocked, 0); assert.equal(w.url(), '/campaigns/c');
});

test('abandon stops blocking without touching history (in-app link follows)', () => {
  const w = fakeWindow(['/a', '/b']);
  let blocked = 0;
  const g = installBackGuard(w, () => { blocked += 1; });
  g.abandon();
  w.history.go(-1); w.flush();
  assert.equal(blocked, 0);
});

test('every routed rule ID exists in the canonical catalog', () => {
  const path = fileURLToPath(new URL('../../../../docs/standards/webinar/WEB-STANDARD-001.rules.json', import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const rules = (Array.isArray(raw) ? raw : (raw as { rules?: unknown[] }).rules ?? Object.values(raw as object).find(Array.isArray)) as { ruleId: string }[];
  const ids = new Set(rules.map((r) => r.ruleId));
  for (const id of Object.keys(RULE_ROUTE)) assert.ok(ids.has(id), `${id} is not in the catalog`);
  assert.equal(ruleRoute('WEB-SETUP-008'), 'when');
  assert.equal(ruleRoute('WEB-SETUP-010'), 'where');
  assert.equal(ruleRoute('WEB-REC-005'), 'recruitment');
  assert.equal(ruleRoute('WEB-FU-ATT-001'), 'review');
  assert.equal(ruleRoute('WEB-UNKNOWN-999'), 'review');
});
