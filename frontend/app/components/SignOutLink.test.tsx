import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { stubBrowser } from '@/app/lib/test-browser';

type LinkProps = { onClick: (event: { preventDefault: () => void }) => void };
let browser: ReturnType<typeof stubBrowser>;

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** Click a SignOutLink on `pathname` and return where it sends the browser. */
async function signOut(signInHref?: string) {
  const { default: SignOutLink } = await import('./SignOutLink');
  const link = SignOutLink({ signInHref }) as ReactElement<LinkProps>;
  link.props.onClick({ preventDefault: () => {} });
  return browser.replace.mock.calls.at(-1)?.[0];
}

describe('SignOutLink', () => {
  it('opens the tenant sign-in after a tenant session expired in this tab', async () => {
    browser = stubBrowser({ pathname: '/' });
    const api = await import('@/app/lib/api');
    api.setAuthSession('expired-access', 'Client');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))));
    await expect(api.apiFetch('/me/conversations')).rejects.toMatchObject({ status: 401 });
    expect(api.getAuthToken()).toBeNull();
    expect(await signOut()).toBe('/login?role=tenant');
  });

  it('falls back to the workspace in view when no role is stored', async () => {
    browser = stubBrowser({ pathname: '/owner/properties' });
    expect(await signOut()).toBe('/login?role=landlord');
    browser = stubBrowser({ pathname: '/tenant/bookings' });
    expect(await signOut()).toBe('/login?role=tenant');
  });

  it('covers the page with a signing-out status while sign-in loads, never a blank window', async () => {
    browser = stubBrowser({ pathname: '/owner/properties' });
    expect(await signOut()).toBe('/login?role=landlord');
    expect(browser.body.style.visibility).toBe('hidden');
    expect(browser.body.children).toHaveLength(1);
    const [cover] = browser.body.children;
    expect(cover.className.split(' ')).toEqual(expect.arrayContaining(['visible', 'fixed', 'inset-0']));
    const [status, link] = cover.children;
    expect(status.attributes.role).toBe('status');
    expect(status.textContent).toBe('Signing out…');
    expect(link.tagName).toBe('A');
    expect(link.href).toBe('/login?role=landlord');
    expect(link.className).toContain('min-h-11');
    expect(link.focus).toHaveBeenCalled();
  });

  it('opens the sign-in it is given, such as another account type\'s with a form to return to', async () => {
    browser = stubBrowser({ pathname: '/' });
    browser.cookies.set('tv_token', 'live-access');
    browser.cookies.set('tv_role', 'Client');
    const landlordSignIn = `/login?role=landlord&next=${encodeURIComponent('/owner/properties/create')}`;
    expect(await signOut(landlordSignIn)).toBe(landlordSignIn);
    expect(browser.cookies.has('tv_token')).toBe(false);
    expect(browser.body.children[0].children[1].href).toBe(landlordSignIn);
  });

  it('prefers the live session role over the page being viewed', async () => {
    browser = stubBrowser({ pathname: '/providers/amelia' });
    browser.cookies.set('tv_token', 'live-access');
    browser.cookies.set('tv_role', 'Owner');
    expect(await signOut()).toBe('/login?role=landlord');
    expect(browser.cookies.has('tv_token')).toBe(false);
    expect(browser.storage.get('tv_explicit_logout')).toBeTruthy();
  });
});
