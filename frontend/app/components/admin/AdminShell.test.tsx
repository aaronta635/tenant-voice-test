import { cleanup, click, descendants, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import AdminShell from './AdminShell';

const mocks = vi.hoisted(() => ({ me: vi.fn(), pathname: '/admin/users', navigate: vi.fn() }));
vi.mock('@/app/lib/admin-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-api')>()),
  adminApi: { me: mocks.me },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => mocks.navigate(href)),
}));

const shell = () => render(<AdminShell><p>Admin page content</p></AdminShell>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = '/admin/users';
  document.cookie = 'tv_token=header.payload.signature';
  localStorage.clear();
  mocks.me.mockResolvedValue({ id: 'ada', full_name: 'Ada Admin', email: 'ada@example.test' });
});
afterEach(async () => {
  await cleanup();
  document.cookie = '';
});

describe('who sees the admin console', () => {
  it('shows the console to an admin the server confirms', async () => {
    const view = await shell();

    expect(mocks.me).toHaveBeenCalledTimes(1);
    expect(textOf(view)).toContain('Admin page content');
    expect(textOf(view)).toContain('Ada Admin');
    const nav = descendants(view).find((element) => element.getAttribute('aria-label') === 'Admin console')!;
    expect(getByName(nav, 'a', 'Users').getAttribute('aria-current')).toBe('page');
    expect(getByName(nav, 'a', 'Overview').getAttribute('aria-current')).toBeNull();
  });

  it('opens the verification queue from the navigation, marked on its own page', async () => {
    mocks.pathname = '/admin/verification';
    const view = await shell();
    const nav = descendants(view).find((element) => element.getAttribute('aria-label') === 'Admin console')!;

    const link = getByName(nav, 'a', 'Verification');
    expect(link.getAttribute('href')).toBe('/admin/verification');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(getByName(nav, 'a', 'Users').getAttribute('aria-current')).toBeNull();
  });

  it('opens the moderation and oversight pages, marking the one open below its section', async () => {
    mocks.pathname = '/admin/complaints/categories';
    const view = await shell();
    const nav = descendants(view).find((element) => element.getAttribute('aria-label') === 'Admin console')!;

    expect(['Reviews', 'Listings', 'Complaints', 'Repairs', 'Activity log', 'Analytics'].map((label) => getByName(nav, 'a', label).getAttribute('href'))).toEqual([
      '/admin/reviews', '/admin/listings', '/admin/complaints', '/admin/repairs', '/admin/activity', '/admin/analytics',
    ]);
    expect(getByName(nav, 'a', 'Complaints').getAttribute('aria-current')).toBe('page');
    expect(getByName(nav, 'a', 'Reviews').getAttribute('aria-current')).toBeNull();
  });

  it('links the red flags and alerts pages, with nothing left marked as coming soon', async () => {
    const view = await shell();
    const nav = descendants(view).find((element) => element.getAttribute('aria-label') === 'Admin console')!;

    expect(getByName(nav, 'a', 'Red flags').getAttribute('href')).toBe('/admin/red-flags');
    expect(getByName(nav, 'a', 'Alerts').getAttribute('href')).toBe('/admin/alerts');
    expect(textOf(nav)).not.toContain('Coming soon');
  });

  it('tells a member who is not an admin why, and never shows the console', async () => {
    mocks.me.mockRejectedValue(new ApiError(403, 'This area is for TenantVoice administrators.'));
    document.cookie = 'tv_token=header.payload.signature; tv_role=Client';

    const view = await shell();

    expect(textOf(view)).toContain("You can't open the admin console");
    expect(textOf(view)).toContain('This area is for TenantVoice administrators.');
    expect(textOf(view)).not.toContain('Admin page content');
    expect(textOf(view)).not.toContain('Users');
    expect(getByName(view, 'a', 'Go to your workspace').getAttribute('href')).toBe('/tenant/dashboard');
  });

  it('opens the officers\' data category requests from the navigation', async () => {
    mocks.pathname = '/admin/data-requests';
    const view = await shell();
    const nav = descendants(view).find((element) => element.getAttribute('aria-label') === 'Admin console')!;

    expect(getByName(nav, 'a', 'Data requests').getAttribute('href')).toBe('/admin/data-requests');
    expect(getByName(nav, 'a', 'Data requests').getAttribute('aria-current')).toBe('page');
  });

  it('sends a Housing Portal officer back to the portal', async () => {
    mocks.me.mockRejectedValue(new ApiError(403, 'This area is for TenantVoice administrators.'));
    document.cookie = 'tv_token=header.payload.signature; tv_role=Officer';

    const view = await shell();

    expect(textOf(view)).toContain("You can't open the admin console");
    expect(getByName(view, 'a', 'Go to the Housing Portal').getAttribute('href')).toBe('/housing');
    expect(textOf(view)).not.toContain('Admin page content');
  });

  it('passes on the server\'s reason to an admin account that is not active', async () => {
    mocks.me.mockRejectedValue(new ApiError(403, 'This admin account is not active. Ask the TenantVoice team to restore it.'));

    const view = await shell();

    expect(textOf(view)).toContain('This admin account is not active.');
    expect(textOf(view)).not.toContain('Admin page content');
  });

  it('asks a signed-out visitor to sign in with a staff account, and returns them here', async () => {
    document.cookie = '';

    const view = await shell();

    expect(mocks.me).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Sign in to the admin console');
    expect(getByName(view, 'a', 'Staff sign in').getAttribute('href')).toBe(`/login?account=staff&next=${encodeURIComponent('/admin/users')}`);
    expect(textOf(view)).not.toContain('Admin page content');
  });

  it('treats an expired session as signed out', async () => {
    mocks.me.mockRejectedValue(new ApiError(401, 'Your session has expired.'));

    const view = await shell();

    expect(textOf(view)).toContain('Sign in to the admin console');
  });

  it('offers a retry when the check itself fails', async () => {
    mocks.me.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));

    const view = await shell();
    expect(textOf(view)).toContain("Couldn't open the admin console");
    await click(getByName(view, 'button', 'Try again'));

    expect(textOf(view)).toContain('Admin page content');
  });

  it('keeps the console and the refusal at AA contrast, also under the pointer', async () => {
    const view = await shell();
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);

    await cleanup();
    mocks.me.mockRejectedValue(new ApiError(403, 'This area is for TenantVoice administrators.'));
    const refused = await shell();
    expect(lowContrastText(refused)).toEqual([]);
    expect(lowContrastText(hovered(refused))).toEqual([]);
  });
});
