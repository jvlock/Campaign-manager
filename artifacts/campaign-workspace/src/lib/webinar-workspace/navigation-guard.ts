// Unsaved-changes guard for browser Back/Forward under wouter's history semantics.
// While dirty, a sentinel entry duplicating the current URL is pushed. Pressing Back
// pops only the sentinel (URL unchanged, so wouter keeps the route mounted); we then
// restore the sentinel and ask for confirmation. Confirming releases the guard and
// performs the original Back.
export interface GuardHistory {
  state: unknown;
  pushState(data: unknown, unused: string, url?: string | null): void;
  go(delta: number): void;
}
export interface GuardWindow {
  history: GuardHistory;
  location: { href: string };
  addEventListener(type: 'popstate', fn: () => void): void;
  removeEventListener(type: 'popstate', fn: () => void): void;
}

export const GUARD_KEY = '__wwUnsavedGuard';

export interface BackGuard {
  /** Leave for real (after the user confirmed discard). */
  release(): void;
  /** Stop listening but keep history untouched (an in-app navigation follows). */
  abandon(): void;
  /** Stop guarding without navigating (e.g. after a successful save). */
  dispose(): void;
}

export function isGuardState(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as Record<string, unknown>)[GUARD_KEY] === true;
}

export function installBackGuard(win: GuardWindow, onBlocked: () => void): BackGuard {
  let active = true;
  let ignoreNext = false;
  const push = () => win.history.pushState({ ...(typeof win.history.state === 'object' && win.history.state ? win.history.state as object : {}), [GUARD_KEY]: true }, '', win.location.href);
  if (!isGuardState(win.history.state)) push();
  const onPop = () => {
    if (ignoreNext) { ignoreNext = false; return; }
    if (!active) return;
    if (isGuardState(win.history.state)) return; // forward into sentinel
    push(); // restore the entry we just lost
    onBlocked();
  };
  win.addEventListener('popstate', onPop);
  return {
    release() {
      if (!active) return;
      active = false;
      win.removeEventListener('popstate', onPop);
      // Skip the sentinel and the page's own entry: the user's original Back.
      win.history.go(-2);
    },
    abandon() {
      if (!active) return;
      active = false;
      win.removeEventListener('popstate', onPop);
    },
    dispose() {
      if (!active) return;
      active = false;
      if (isGuardState(win.history.state)) {
        ignoreNext = true;
        const cleanup = () => { win.removeEventListener('popstate', onPop); win.removeEventListener('popstate', cleanup); };
        win.addEventListener('popstate', cleanup);
        win.history.go(-1); // drop the sentinel; URL stays the same
      } else {
        win.removeEventListener('popstate', onPop);
      }
    },
  };
}
