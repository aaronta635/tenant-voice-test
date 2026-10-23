import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const bookingPath = '/providers/amelia?service=svc-1&slot=2026-10-27%7C10%3A00%3A00&suburb=Newtown#booking';

function linkTo(html: string, label: string): URL {
  const anchor = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].find((match) => match[2] === label);
  if (!anchor) throw new Error(`No "${label}" link rendered`);
  return new URL(anchor[1].replaceAll('&amp;', '&'), 'https://tenantvoice.invalid');
}

describe('switching between sign-in and sign-up', () => {
  it('keeps a guest booking return path on the "Create an account" link', async () => {
    nav.search = `role=tenant&next=${encodeURIComponent(bookingPath)}`;
    const { default: LoginPage } = await import('./login/page');
    const link = linkTo(renderToStaticMarkup(<LoginPage />), 'Create an account');
    expect(link.pathname).toBe('/register');
    expect(link.searchParams.get('role')).toBe('tenant');
    expect(link.searchParams.get('next')).toBe(bookingPath);
  });

  it('drops an unsafe return path instead of forwarding it', async () => {
    nav.search = `role=tenant&next=${encodeURIComponent('//evil.example/phish')}`;
    const { default: LoginPage } = await import('./login/page');
    const link = linkTo(renderToStaticMarkup(<LoginPage />), 'Create an account');
    expect(link.searchParams.get('role')).toBe('tenant');
    expect(link.searchParams.has('next')).toBe(false);
  });

  it('keeps the return path on the register page "Sign in" link', async () => {
    nav.search = `role=tenant&next=${encodeURIComponent(bookingPath)}`;
    const { default: RegisterPage } = await import('./register/page');
    const link = linkTo(renderToStaticMarkup(<RegisterPage />), 'Sign in');
    expect(link.pathname).toBe('/login');
    expect(link.searchParams.get('role')).toBe('tenant');
    expect(link.searchParams.get('next')).toBe(bookingPath);
  });
});

/** The label of the account-type tab shown as chosen, or null when none is. */
function chosenTab(html: string): string | null {
  const pressed = /<button[^>]*aria-pressed="true"[^>]*><span[^>]*>([^<]*)<\/span>/.exec(html);
  return pressed ? pressed[1] : null;
}

describe('sign-in links that name no account type', () => {
  it.each([
    ['the header "Sign in" link', ''],
    ['a guest booking', `next=${encodeURIComponent(bookingPath)}`],
  ])('choose no tab for %s, so any account can sign in', async (_link, search) => {
    nav.search = search;
    const { default: LoginPage } = await import('./login/page');
    expect(chosenTab(renderToStaticMarkup(<LoginPage />))).toBeNull();
  });

  it('still choose the tab a workspace return path names', async () => {
    nav.search = `next=${encodeURIComponent('/owner/properties')}`;
    const { default: LoginPage } = await import('./login/page');
    expect(chosenTab(renderToStaticMarkup(<LoginPage />))).toBe('Landlord');
  });

  it('link to sign-up without a role, which then offers the Tenant tab for the booking', async () => {
    nav.search = `next=${encodeURIComponent(bookingPath)}`;
    const { default: LoginPage } = await import('./login/page');
    const link = linkTo(renderToStaticMarkup(<LoginPage />), 'Create an account');
    expect(link.pathname).toBe('/register');
    expect(link.searchParams.has('role')).toBe(false);
    expect(link.searchParams.get('next')).toBe(bookingPath);

    nav.search = link.search.slice(1);
    const { default: RegisterPage } = await import('./register/page');
    const html = renderToStaticMarkup(<RegisterPage />);
    expect(chosenTab(html)).toBe('Tenant');
    // That tab is only a default, so going back to sign-in still names no account type.
    expect(linkTo(html, 'Sign in').searchParams.has('role')).toBe(false);
  });
});

describe('tab titles', () => {
  it('names the password reset page like sign-in and sign-up', async () => {
    expect((await import('./login/layout')).metadata.title).toBe('Sign in');
    expect((await import('./register/layout')).metadata.title).toBe('Create an account');
    expect((await import('./forgot-password/page')).metadata.title).toBe('Reset your password');
  });
});
