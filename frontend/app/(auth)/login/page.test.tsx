import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIST_OPTIONS, listOptionSignInHref } from '@/app/lib/list-options';
import LoginPage from './page';

const mocks = vi.hoisted(() => ({ login: vi.fn(), setAuthSession: vi.fn(), push: vi.fn(), search: '' }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { auth: { login: mocks.login } },
  setAuthSession: mocks.setAuthSession,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const bookingPath = '/providers/amelia?service=svc-1&slot=2026-10-27%7C10%3A00%3A00&suburb=Newtown#booking';
const byId = (view: FakeElement, id: string) => descendants(view).find((element) => element.id === id) as FakeElement;

async function signIn(view: FakeElement) {
  await typeInto(byId(view, 'login-email'), 'lee@example.com');
  await typeInto(byId(view, 'login-password'), 'correct-horse');
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
}

/** The body the login request sends, as JSON drops undefined fields. */
const sentBody = () => JSON.parse(JSON.stringify(mocks.login.mock.calls[0][0]));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search = `next=${encodeURIComponent(bookingPath)}`;
  mocks.login.mockResolvedValue({ access_token: 'access', refresh_token: 'refresh', profile: { id: 'lee', role: 'landlord' } });
});
afterEach(cleanup);

describe('signing in with no account type chosen', () => {
  it('sends no role, so a landlord who came to book is signed in as a landlord', async () => {
    const view = await render(<LoginPage />);
    await signIn(view);

    expect(sentBody()).toEqual({ email: 'lee@example.com', password: 'correct-horse' });
    expect(mocks.setAuthSession).toHaveBeenCalledWith('access', 'Owner', 'refresh');
    expect(mocks.push).toHaveBeenCalledWith(bookingPath);
  });

  it('lands on the home of the role the account holds when there is no return path', async () => {
    mocks.search = '';
    const view = await render(<LoginPage />);
    await signIn(view);

    expect(mocks.push).toHaveBeenCalledWith('/owner');
  });

  it('refuses an account type the website has no workspace for', async () => {
    // Officers have the Housing Portal (staff-sign-in.test.tsx); a role the website does not know has nowhere to go.
    mocks.login.mockResolvedValue({ access_token: 'access', refresh_token: 'refresh', profile: { id: 'ivy', role: 'inspector' } });
    const view = await render(<LoginPage />);
    await signIn(view);

    expect(textOf(view)).toContain('This account type cannot sign in to the TenantVoice website.');
    expect(mocks.setAuthSession).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('still sends the account type a visitor picks', async () => {
    const view = await render(<LoginPage />);
    await click(getByName(view, 'button', /^Landlord/));
    await signIn(view);

    expect(sentBody()).toEqual({ email: 'lee@example.com', password: 'correct-horse', role: 'landlord' });
  });
});

describe('signing in from the header\'s "List" menu', () => {
  it.each(LIST_OPTIONS.map((option) => [option.label, option] as const))('lands on the form after "%s"', async (_label, option) => {
    const role = option.role === 'Owner' ? 'landlord' : 'service_provider';
    mocks.search = listOptionSignInHref(option).split('?')[1];
    mocks.login.mockResolvedValue({ access_token: 'access', refresh_token: 'refresh', profile: { id: 'lee', role } });
    const view = await render(<LoginPage />);
    await signIn(view);

    expect(sentBody().role).toBe(role);
    expect(mocks.push).toHaveBeenCalledWith(option.form);
  });

  it('keeps the account type and the form on the link to sign up instead', async () => {
    const [, property] = LIST_OPTIONS;
    mocks.search = listOptionSignInHref(property).split('?')[1];
    const view = await render(<LoginPage />);
    expect(getByName(view, 'a', 'Create an account').getAttribute('href')).toBe(`/register?${mocks.search}`);
  });
});
