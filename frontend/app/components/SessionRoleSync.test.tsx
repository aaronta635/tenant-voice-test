import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { jwtExpiringIn, stubBrowser } from '@/app/lib/test-browser';

// Vitest runs in node without a DOM, so these tests call SessionSync directly.
// This stand-in for React's hooks keeps state between calls and runs an effect
// only when its dependencies change, as they would in a mounted component.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  effects: [] as { deps?: unknown[]; cleanup?: void | (() => void) }[],
  slot: 0,
  effect: 0,
  queue: [] as (() => void)[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const claim = <T,>(create: () => T) => {
    const index = hooks.slot++;
    if (!(index in hooks.slots)) hooks.slots[index] = create();
    return index;
  };
  return {
    ...actual,
    useId: () => 'session-sync',
    useRef: <T,>(initial: T) => hooks.slots[claim(() => ({ current: initial }))],
    useState: <T,>(initial: T) => {
      const index = claim(() => initial);
      return [hooks.slots[index], (next: T) => { hooks.slots[index] = next; }];
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const index = hooks.effect++;
      const previous = hooks.effects[index];
      if (previous && deps?.every((dep, position) => Object.is(dep, previous.deps?.[position]))) return;
      hooks.queue.push(() => {
        if (typeof previous?.cleanup === 'function') previous.cleanup();
        hooks.effects[index] = { deps, cleanup: effect() };
      });
    },
  };
});

const nav = vi.hoisted(() => ({ pathname: '/', search: '', router: { refresh: vi.fn(), push: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

let browser: ReturnType<typeof stubBrowser>;

beforeEach(() => {
  vi.resetModules();
  hooks.slots = [];
  hooks.effects = [];
  nav.search = '';
  nav.router.refresh.mockClear();
  browser = stubBrowser();
});

afterEach(() => { vi.unstubAllGlobals(); });

/** Render SessionSync at `pathname` and run the effects that render schedules. */
async function render(pathname: string) {
  nav.pathname = pathname;
  const { default: SessionRoleSync } = await import('./SessionRoleSync');
  const boundary = SessionRoleSync() as ReactElement<{ children: ReactElement }>;
  const SessionSync = boundary.props.children.type as () => ReactElement | null;
  hooks.slot = 0;
  hooks.effect = 0;
  hooks.queue = [];
  const output = SessionSync();
  hooks.queue.splice(0).forEach((run) => run());
  return output;
}

describe('mount sync', () => {
  it('drops an expired localStorage session once the cookie is gone', async () => {
    browser.storage.set('tv_token', jwtExpiringIn(-8 * 24 * 60 * 60));
    browser.storage.set('tv_refresh_token', 'refresh-a');
    browser.storage.set('tv_role', 'Client');
    await render('/login');
    expect(browser.storage.has('tv_token')).toBe(false);
    expect(browser.storage.has('tv_refresh_token')).toBe(false);
    expect(browser.storage.has('tv_role')).toBe(false);
  });

  it('still moves an unexpired legacy session onto cookies', async () => {
    const token = jwtExpiringIn(3600);
    browser.storage.set('tv_token', token);
    browser.storage.set('tv_role', 'Owner');
    await render('/');
    expect(browser.cookies.get('tv_token')).toBe(token);
    expect(browser.cookies.get('tv_role')).toBe('Owner');
    expect(nav.router.refresh).toHaveBeenCalledTimes(1);
  });

  it('clears a role cookie left without a token using the Secure attribute', async () => {
    browser.cookies.set('tv_role', 'Provider');
    await render('/');
    expect(browser.cookies.has('tv_role')).toBe(false);
    expect(browser.cookieWrites).toEqual(['tv_role=; path=/; max-age=0; SameSite=Lax; Secure']);
    expect(nav.router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('after an explicit sign-out', () => {
  // Written a minute before this page was requested, so it rendered signed out.
  const signedOutBeforeLoad = () => String(Math.floor(performance.timeOrigin) - 60_000);
  const signOutElsewhere = () => {
    browser.cookies.delete('tv_token');
    const marker = String(Date.now());
    browser.storage.set('tv_explicit_logout', marker);
    return marker;
  };

  it('does not re-render public pages that were loaded after the sign-out', async () => {
    browser.storage.set('tv_explicit_logout', signedOutBeforeLoad());
    for (const page of ['/', '/categories', '/providers/amelia']) await render(page);
    expect(nav.router.refresh).not.toHaveBeenCalled();
  });

  it('refreshes once when another tab signs out, not again on every later page', async () => {
    browser.cookies.set('tv_token', 'live-access');
    await render('/');
    const marker = signOutElsewhere();
    browser.window.dispatchEvent(Object.assign(new Event('storage'), { key: 'tv_explicit_logout', newValue: marker }));
    expect(nav.router.refresh).toHaveBeenCalledTimes(1);
    await render('/categories');
    await render('/providers/amelia');
    expect(nav.router.refresh).toHaveBeenCalledTimes(1);
  });

  it('still refreshes a public page restored from the back-forward cache', async () => {
    browser.cookies.set('tv_token', 'live-access');
    await render('/providers/amelia');
    signOutElsewhere();
    browser.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(nav.router.refresh).toHaveBeenCalledTimes(1);
  });

  it('still sends a cached private page back to sign-in', async () => {
    browser.storage.set('tv_explicit_logout', signedOutBeforeLoad());
    await render('/tenant/bookings');
    expect(browser.body.style.visibility).toBe('hidden');
    expect(browser.replace).toHaveBeenCalledWith('/login?role=tenant');
    expect(nav.router.refresh).not.toHaveBeenCalled();
  });
});
