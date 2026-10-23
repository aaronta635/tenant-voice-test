import { cleanup, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

const mocks = vi.hoisted(() => ({
  login: vi.fn(), setAuthSession: vi.fn(), startStaffSession: vi.fn(), push: vi.fn(), search: '',
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { auth: { login: mocks.login } },
  setAuthSession: mocks.setAuthSession,
}));
vi.mock('@/app/lib/staff-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/staff-session')>()),
  startStaffSession: mocks.startStaffSession,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const byId = (view: FakeElement, id: string) => descendants(view).find((element) => element.id === id) as FakeElement;
const sentBody = () => JSON.parse(JSON.stringify(mocks.login.mock.calls[0][0]));

async function signIn(view: FakeElement) {
  await typeInto(byId(view, 'login-email'), 'ada@example.test');
  await typeInto(byId(view, 'login-password'), 'correct-horse');
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
}

const admin = { access_token: 'access', refresh_token: 'refresh', profile: { id: 'ada', role: 'admin' } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search = 'account=staff';
  mocks.login.mockResolvedValue(admin);
});
afterEach(cleanup);

describe('staff sign-in', () => {
  it('asks for no account type and offers no sign-up', async () => {
    const view = await render(<LoginPage />);

    expect(textOf(view)).toContain('Staff sign in');
    expect(descendants(view).some((element) => element.getAttribute('aria-label') === 'Account type')).toBe(false);
    expect(textOf(view)).not.toContain('Create an account');
    expect(getByName(view, 'a', 'Sign in to your account').getAttribute('href')).toBe('/login');
  });

  it('signs an admin in without a role and lands on the admin console', async () => {
    const view = await render(<LoginPage />);
    await signIn(view);

    expect(sentBody()).toEqual({ email: 'ada@example.test', password: 'correct-horse' });
    expect(mocks.startStaffSession).toHaveBeenCalledWith('access', 'refresh', 'Admin');
    expect(mocks.setAuthSession).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/admin');
  });

  it('signs an officer in without a role and lands on the Housing Portal', async () => {
    mocks.login.mockResolvedValue({ ...admin, profile: { id: 'ola', role: 'officer' } });
    const view = await render(<LoginPage />);
    await signIn(view);

    expect(sentBody()).toEqual({ email: 'ada@example.test', password: 'correct-horse' });
    expect(mocks.startStaffSession).toHaveBeenCalledWith('access', 'refresh', 'Officer');
    expect(mocks.setAuthSession).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/housing');
  });

  it('returns an officer to the portal page that sent them, and never into the admin console', async () => {
    mocks.login.mockResolvedValue({ ...admin, profile: { id: 'ola', role: 'officer' } });
    mocks.search = `next=${encodeURIComponent('/housing/referrals')}`;
    const view = await render(<LoginPage />);
    expect(textOf(view)).toContain('Staff sign in');
    await signIn(view);
    expect(mocks.push).toHaveBeenCalledWith('/housing/referrals');

    await cleanup();
    vi.clearAllMocks();
    mocks.search = `next=${encodeURIComponent('/admin/users')}`;
    await signIn(await render(<LoginPage />));
    expect(mocks.push).toHaveBeenCalledWith('/housing');
  });

  it('returns an admin to the admin page that sent them to sign in', async () => {
    mocks.search = `next=${encodeURIComponent('/admin/users?status=SUSPENDED')}`;
    const view = await render(<LoginPage />);
    expect(textOf(view)).toContain('Staff sign in');
    await signIn(view);

    expect(mocks.push).toHaveBeenCalledWith('/admin/users?status=SUSPENDED');
  });

  it('keeps a member out and keeps no session', async () => {
    mocks.login.mockResolvedValue({ ...admin, profile: { id: 'mia', role: 'tenant' } });
    const view = await render(<LoginPage />);
    await signIn(view);

    expect(textOf(view)).toContain('This sign-in is for TenantVoice staff: administrators and Housing Portal officers.');
    expect(mocks.startStaffSession).not.toHaveBeenCalled();
    expect(mocks.setAuthSession).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('keeps the staff sign-in at AA contrast, also under the pointer', async () => {
    const view = await render(<LoginPage />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe('the regular sign-in', () => {
  beforeEach(() => { mocks.search = ''; });

  it('links to the staff sign-in', async () => {
    const view = await render(<LoginPage />);
    expect(getByName(view, 'a', 'Staff sign in').getAttribute('href')).toBe('/login?account=staff');
  });

  it('takes an admin who chose no account type to the admin console too', async () => {
    const view = await render(<LoginPage />);
    await signIn(view);

    expect(mocks.startStaffSession).toHaveBeenCalledWith('access', 'refresh', 'Admin');
    expect(mocks.push).toHaveBeenCalledWith('/admin');
  });

  it('takes an officer who chose no account type to the Housing Portal', async () => {
    mocks.login.mockResolvedValue({ ...admin, profile: { id: 'ola', role: 'officer' } });
    const view = await render(<LoginPage />);
    await signIn(view);

    expect(textOf(view)).not.toContain('This account type cannot sign in to the TenantVoice website.');
    expect(mocks.startStaffSession).toHaveBeenCalledWith('access', 'refresh', 'Officer');
    expect(mocks.push).toHaveBeenCalledWith('/housing');
  });
});
