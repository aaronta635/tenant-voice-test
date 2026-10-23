// window.location and window.history for vitest's node environment, plus the
// sync Next adds on top: its router patches pushState and replaceState, and
// listens for Back and Forward, so usePathname and useSearchParams follow the
// URL. The browser changes the URL at once but Next applies it in a
// transition, so the hooks keep reporting the old URL until a test calls
// land(). A test's next/navigation mock reads `search` and calls subscribe().
import { vi } from 'vitest';

const ORIGIN = 'https://tenantvoice.test';

export type FakeHistory = ReturnType<typeof createFakeHistory>;

export function createFakeHistory(start = '/') {
  const entries = [new URL(start, ORIGIN)];
  let index = 0;
  let seen = entries[0];
  const listeners = new Set<() => void>();
  const write = (url: string | URL | null | undefined, push: boolean) => {
    const next = new URL(String(url ?? entries[index]), entries[index]);
    if (push) entries.splice(++index, entries.length, next);
    else entries[index] = next;
  };
  const location = {
    get href() { return entries[index].href; },
    get origin() { return ORIGIN; },
    get pathname() { return entries[index].pathname; },
    get search() { return entries[index].search; },
    get hash() { return entries[index].hash; },
  };
  const history = {
    state: null,
    get length() { return entries.length; },
    pushState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => write(url, true)),
    replaceState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => write(url, false)),
    go(delta: number) { index = Math.min(entries.length - 1, Math.max(0, index + delta)); },
    back() { history.go(-1); },
    forward() { history.go(1); },
  };
  const page = {
    location,
    history,
    /** The query the hooks report: the URL as it was at the last land(). */
    get search() { return seen.search; },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Lets the hooks see the current URL, as Next's router does once its update commits. */
    land() {
      seen = entries[index];
      for (const listener of [...listeners]) listener();
    },
    /** A navigation the router made itself, such as a link: opens href and lands it. */
    navigate(href: string) {
      write(href, true);
      page.land();
    },
    /** The stack as path and query, the current entry marked with '>'. */
    stack() {
      return entries.map((url, position) => `${position === index ? '>' : ''}${url.pathname}${url.search}`);
    },
    /** Puts location and history on `target` (the test window); returns the undo. */
    install(target: object) {
      Object.defineProperties(target, { location: { value: location, configurable: true }, history: { value: history, configurable: true } });
      return () => {
        delete (target as { location?: unknown }).location;
        delete (target as { history?: unknown }).history;
      };
    },
  };
  return page;
}
