import { cleanup, click, descendants, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { isPageRoute } from '@/app/test-utils/app-routes';
import HousingShell, { HOUSING_NAV } from './HousingShell';

const mocks = vi.hoisted(() => ({ me: vi.fn(), pathname: '/housing/referrals', navigate: vi.fn() }));
vi.mock('@/app/lib/housing-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/housing-api')>()),
  housingApi: { me: mocks.me },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => mocks.navigate(href)),
}));

const NOT_AN_OFFICER = 'The Housing Portal is for authorised housing officers.';
const shell = () => render(<HousingShell><p>Portal page content</p></HousingShell>);
const nav = (view: Awaited<ReturnType<typeof shell>>) => descendants(view).find((element) => element.getAttribute('aria-label') === 'Housing Portal')!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = '/housing/referrals';
  document.cookie = 'tv_token=header.payload.signature';
  localStorage.clear();
  mocks.me.mockResolvedValue({ id: 'ola', full_name: 'Olive Officer', email: 'olive@example.test' });
});
afterEach(async () => {
  await cleanup();
  document.cookie = '';
});

describe('who sees the Housing Portal', () => {
  it('shows the portal to an officer the server confirms, with every section a page', async () => {
    const view = await shell();

    expect(mocks.me).toHaveBeenCalledTimes(1);
    expect(textOf(view)).toContain('Portal page content');
    expect(textOf(view)).toContain('Olive Officer');
    expect(getByName(nav(view), 'a', 'Referrals').getAttribute('aria-current')).toBe('page');
    expect(getByName(nav(view), 'a', 'Overview').getAttribute('aria-current')).toBeNull();
    expect(HOUSING_NAV.map((item) => item.label)).toEqual([
      'Overview', 'Referrals', 'Red-flag alerts', 'Complaints and outcomes', 'Data requests', 'Surveys', 'Aggregates',
    ]);
    expect(HOUSING_NAV.filter((item) => !isPageRoute(item.href))).toEqual([]);
  });

  it('turns an admin away and sends them to the admin console, where referrals are prepared', async () => {
    mocks.me.mockRejectedValue(new ApiError(403, NOT_AN_OFFICER));
    document.cookie = 'tv_token=header.payload.signature; tv_role=Admin';

    const view = await shell();

    expect(textOf(view)).toContain("You can't open the Housing Portal");
    expect(textOf(view)).toContain(NOT_AN_OFFICER);
    expect(textOf(view)).toContain('Admins prepare referrals for the portal in the admin console.');
    expect(getByName(view, 'a', 'Go to the admin console').getAttribute('href')).toBe('/admin');
    expect(textOf(view)).not.toContain('Portal page content');
    expect(descendants(view).some((element) => element.getAttribute('aria-label') === 'Housing Portal')).toBe(false);
  });

  it('turns a member away and sends them back to their workspace', async () => {
    mocks.me.mockRejectedValue(new ApiError(403, NOT_AN_OFFICER));
    document.cookie = 'tv_token=header.payload.signature; tv_role=Owner';

    const view = await shell();

    expect(textOf(view)).toContain(NOT_AN_OFFICER);
    expect(getByName(view, 'a', 'Go to your workspace').getAttribute('href')).toBe('/owner');
    expect(textOf(view)).not.toContain('Portal page content');
  });

  it('passes on the server\'s reason to an officer account that is not active', async () => {
    mocks.me.mockRejectedValue(new ApiError(403, 'This officer account is not active. Ask the TenantVoice team to restore it.'));

    const view = await shell();

    expect(textOf(view)).toContain('This officer account is not active.');
    expect(textOf(view)).not.toContain('Portal page content');
  });

  it('asks a signed-out visitor to sign in with a staff account, and returns them here', async () => {
    document.cookie = '';

    const view = await shell();

    expect(mocks.me).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Sign in to the Housing Portal');
    expect(getByName(view, 'a', 'Staff sign in').getAttribute('href')).toBe(`/login?account=staff&next=${encodeURIComponent('/housing/referrals')}`);
  });

  it('treats an expired session as signed out', async () => {
    mocks.me.mockRejectedValue(new ApiError(401, 'Your session has expired.'));

    expect(textOf(await shell())).toContain('Sign in to the Housing Portal');
  });

  it('offers a retry when the check itself fails', async () => {
    mocks.me.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));

    const view = await shell();
    expect(textOf(view)).toContain("Couldn't open the Housing Portal");
    await click(getByName(view, 'button', 'Try again'));

    expect(textOf(view)).toContain('Portal page content');
  });

  it('keeps the portal and the refusal at AA contrast, also under the pointer', async () => {
    const view = await shell();
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);

    await cleanup();
    mocks.me.mockRejectedValue(new ApiError(403, NOT_AN_OFFICER));
    const refused = await shell();
    expect(lowContrastText(refused)).toEqual([]);
    expect(lowContrastText(hovered(refused))).toEqual([]);
  });
});
