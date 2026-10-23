import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { StrictMode, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import ResetPasswordPage, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  resetPassword: vi.fn(),
  forgotPassword: vi.fn(),
  clearAuthSession: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { auth: { resetPassword: mocks.resetPassword, forgotPassword: mocks.forgotPassword } },
  clearAuthSession: mocks.clearAuthSession,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: mocks.refresh }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsZWUiLCJhbXIiOlt7Im1ldGhvZCI6Im90cCJ9XX0.signature';
const RECOVERY_LINK = `/reset-password#access_token=${TOKEN}&expires_at=4102444800&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery`;
const EXPIRED_LINK = '/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

const byId = (view: FakeElement, id: string) => descendants(view).find((element) => element.id === id) as FakeElement;
const form = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'FORM') as FakeElement;
const alertText = (view: FakeElement) => descendants(view).filter((element) => element.getAttribute('role') === 'alert').map(textOf);

let page: FakeHistory;
let uninstall = () => {};

/** Opens the page as the emailed link's redirect would. */
async function openLink(url: string, ui = <ResetPasswordPage />) {
  page = createFakeHistory(url);
  uninstall = page.install(window);
  return render(ui);
}

async function choosePassword(view: FakeElement, password: string, confirm = password) {
  await typeInto(byId(view, 'reset-password'), password);
  await typeInto(byId(view, 'reset-confirm'), confirm);
  await dispatch(form(view), 'submit');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resetPassword.mockResolvedValue({ message: 'Password updated. Sign in with your new password.' });
  mocks.forgotPassword.mockResolvedValue({ message: 'If an account exists for that email, a link is on its way.' });
});
afterEach(async () => {
  await cleanup();
  uninstall();
  vi.restoreAllMocks();
});

describe('opening a reset link', () => {
  it('names the tab like the other auth pages', () => {
    expect(metadata.title).toBe('Choose a new password');
  });

  it('shows a loading state until the browser has read the link', () => {
    const html = renderToStaticMarkup(<ResetPasswordPage />);
    expect(html).toContain('Checking your reset link…');
    expect(html).not.toContain('<form');
  });

  it('asks for the new password and takes the token out of the address bar and storage', async () => {
    const stored = vi.spyOn(window.localStorage, 'setItem');
    const view = await openLink(RECOVERY_LINK);

    expect(textOf(view)).toContain('Choose a new password');
    expect(byId(view, 'reset-password').type).toBe('password');
    expect(byId(view, 'reset-confirm').type).toBe('password');
    expect(page.history.replaceState).toHaveBeenCalledWith(null, '', '/reset-password');
    expect(page.location.href).toBe('https://tenantvoice.test/reset-password');
    expect(stored).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain(TOKEN);
  });

  it('keeps the form when development runs its effects twice', async () => {
    const view = await openLink(RECOVERY_LINK, <StrictMode><ResetPasswordPage /></StrictMode>);

    expect(textOf(view)).toContain('Choose a new password');
    expect(page.history.replaceState).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an expired or used link', EXPIRED_LINK],
    ['a link without a token', '/reset-password'],
    ['a link that is not for a reset', `/reset-password#access_token=${TOKEN}&type=signup`],
    ['an error in the query', '/reset-password?error=access_denied&error_code=otp_expired'],
  ])('offers a new link for %s', async (_case, url) => {
    const view = await openLink(url);

    expect(getByName(view, 'h1', 'This link has expired or was already used')).toBeTruthy();
    expect(getByName(view, 'button', 'Send reset link')).toBeTruthy();
    expect(descendants(view).some((element) => element.id === 'reset-password')).toBe(false);
    expect(page.location.href).toBe('https://tenantvoice.test/reset-password');
  });

  it('reads a link opened again in the same tab, where only the fragment changes', async () => {
    const view = await openLink(EXPIRED_LINK);

    page.navigate(RECOVERY_LINK);
    await dispatch(window, 'hashchange');
    expect(textOf(view)).toContain('Choose a new password');
    expect(page.location.href).toBe('https://tenantvoice.test/reset-password');

    page.navigate('/reset-password#top');
    await dispatch(window, 'hashchange');
    expect(textOf(view)).toContain('Choose a new password');
  });

  it('sends a new link from the expired link page', async () => {
    const view = await openLink(EXPIRED_LINK);
    await typeInto(byId(view, 'reset-email'), 'lee@example.com');
    await dispatch(form(view), 'submit');

    expect(mocks.forgotPassword).toHaveBeenCalledWith('lee@example.com');
    expect(textOf(view)).toContain('Check your email');
  });
});

describe('choosing the new password', () => {
  it('updates it, signs this browser out and opens sign-in with a notice', async () => {
    const view = await openLink(RECOVERY_LINK);
    await choosePassword(view, 'new-password-1');

    expect(mocks.resetPassword).toHaveBeenCalledWith({ access_token: TOKEN, password: 'new-password-1' });
    expect(mocks.clearAuthSession).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/login?reason=password-updated');
    expect(textOf(view)).toContain('Password updated. Taking you to sign in…');
  });

  it('refuses passwords that do not match', async () => {
    const view = await openLink(RECOVERY_LINK);
    await choosePassword(view, 'new-password-1', 'new-password-2');

    expect(alertText(view)).toEqual(['The passwords do not match.']);
    expect(byId(view, 'reset-confirm').getAttribute('aria-invalid')).toBe('true');
    expect(byId(view, 'reset-confirm').getAttribute('aria-describedby')).toBe('reset-error');
    expect(document.activeElement).toBe(byId(view, 'reset-confirm'));
    expect(mocks.resetPassword).not.toHaveBeenCalled();
  });

  it('applies the sign-up length rule', async () => {
    const view = await openLink(RECOVERY_LINK);
    await choosePassword(view, 'short');

    expect(alertText(view)).toEqual(['Password must be at least 8 characters.']);
    expect(byId(view, 'reset-password').getAttribute('aria-invalid')).toBe('true');
    expect(byId(view, 'reset-password').getAttribute('minLength')).toBe('8');
    expect(mocks.resetPassword).not.toHaveBeenCalled();
  });

  it('offers a new link when the API says the token expired', async () => {
    mocks.resetPassword.mockRejectedValue(new ApiError(400, 'This reset link has expired or was already used. Request a new link.'));
    const view = await openLink(RECOVERY_LINK);
    await choosePassword(view, 'new-password-1');

    const heading = getByName(view, 'h1', 'This link has expired or was already used');
    expect(document.activeElement).toBe(heading);
    expect(getByName(view, 'button', 'Send reset link')).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(422, 'Password does not meet the minimum requirements. Choose a longer or less common password.')],
    [new ApiError(0, 'Could not connect. Check your connection and try again.')],
  ])('keeps the form and explains %s', async (error) => {
    mocks.resetPassword.mockRejectedValue(error);
    const view = await openLink(RECOVERY_LINK);
    await choosePassword(view, 'new-password-1');

    expect(alertText(view)).toEqual([error.message]);
    expect(getByName(view, 'button', 'Update password').hasAttribute('disabled')).toBe(false);
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
  });

  it('shows and hides each password with a labelled button', async () => {
    const view = await openLink(RECOVERY_LINK);

    await click(getByName(view, 'button', 'Show new password'));
    expect(byId(view, 'reset-password').type).toBe('text');
    expect(byId(view, 'reset-confirm').type).toBe('password');
    expect(getByName(view, 'button', 'Hide new password').getAttribute('aria-controls')).toBe('reset-password');

    await click(getByName(view, 'button', 'Hide new password'));
    expect(byId(view, 'reset-password').type).toBe('password');
    await click(getByName(view, 'button', 'Show confirm new password'));
    expect(byId(view, 'reset-confirm').type).toBe('text');
  });

  it.each([
    ['the new password form', RECOVERY_LINK],
    ['the expired link page', EXPIRED_LINK],
  ])('keeps %s at AA contrast, also under the pointer', async (_page, url) => {
    const view = await openLink(url);

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
