import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { RESEND_COOLDOWN_SECONDS } from '@/app/lib/password-reset';
import ForgotPasswordPage from './page';

const mocks = vi.hoisted(() => ({ forgotPassword: vi.fn() }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { auth: { forgotPassword: mocks.forgotPassword } },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const byId = (view: FakeElement, id: string) => descendants(view).find((element) => element.id === id) as FakeElement;
const form = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'FORM') as FakeElement;
const alertText = (view: FakeElement) => descendants(view).filter((element) => element.getAttribute('role') === 'alert').map(textOf);
const resendButton = (view: FakeElement) => getByName(view, 'button', /^Send another link/);

async function requestLink(view: FakeElement, email = 'lee@example.com') {
  await typeInto(byId(view, 'reset-email'), email);
  await dispatch(form(view), 'submit');
}

beforeEach(() => {
  vi.clearAllMocks();
  // Only the cooldown's ticks are faked: render() settles on real timeouts.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  mocks.forgotPassword.mockResolvedValue({ message: 'If an account exists for that email, a link is on its way.' });
});
afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
});

describe('asking for a reset link', () => {
  it('offers an email form instead of the old "not available yet" text', async () => {
    const view = await render(<ForgotPasswordPage />);

    expect(textOf(view)).toContain('Reset your password');
    expect(textOf(view)).not.toMatch(/not available/i);
    expect(byId(view, 'reset-email').type).toBe('email');
    expect(getByName(view, 'button', 'Send reset link').getAttribute('type')).toBe('submit');
    expect(getByName(view, 'a', 'Sign in').getAttribute('href')).toBe('/login');
  });

  it('sends the address and says to check the inbox without saying whether it has an account', async () => {
    const view = await render(<ForgotPasswordPage />);
    await requestLink(view, '  lee@example.com ');

    expect(mocks.forgotPassword).toHaveBeenCalledWith('lee@example.com');
    const heading = getByName(view, 'h1', 'Check your email');
    expect(document.activeElement).toBe(heading);
    expect(textOf(view)).toContain('If lee@example.com has a TenantVoice account, we have sent it a link to reset the password.');
    expect(getByName(view, 'a', 'Back to sign in').getAttribute('href')).toBe('/login');
  });

  it('lets another link go only after the cooldown, then starts it again', async () => {
    const view = await render(<ForgotPasswordPage />);
    await requestLink(view);

    expect(resendButton(view).getAttribute('aria-disabled')).toBe('true');
    expect(textOf(resendButton(view))).toBe(`Send another link in ${RESEND_COOLDOWN_SECONDS} s`);
    await click(resendButton(view));
    expect(mocks.forgotPassword).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime((RESEND_COOLDOWN_SECONDS - 1) * 1000); });
    expect(textOf(resendButton(view))).toBe('Send another link in 1 s');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(resendButton(view).hasAttribute('aria-disabled')).toBe(false);

    await click(resendButton(view));
    expect(mocks.forgotPassword).toHaveBeenCalledTimes(2);
    expect(mocks.forgotPassword).toHaveBeenLastCalledWith('lee@example.com');
    expect(textOf(view)).toContain('Another link is on its way to lee@example.com if it has an account.');
    expect(textOf(resendButton(view))).toBe(`Send another link in ${RESEND_COOLDOWN_SECONDS} s`);
  });

  it('explains a rate limit and stays on the form', async () => {
    mocks.forgotPassword.mockRejectedValue(new ApiError(429, 'Too many reset requests. Wait a while, then try again.'));
    const view = await render(<ForgotPasswordPage />);
    await requestLink(view);

    expect(alertText(view)).toEqual(['Too many reset requests. Wait a while, then try again.']);
    expect(textOf(view)).not.toContain('Check your email');
    expect(getByName(view, 'button', 'Send reset link').hasAttribute('disabled')).toBe(false);
  });

  it('explains a rate limit on another link and keeps the confirmation', async () => {
    const view = await render(<ForgotPasswordPage />);
    await requestLink(view);
    await act(async () => { vi.advanceTimersByTime(RESEND_COOLDOWN_SECONDS * 1000); });
    mocks.forgotPassword.mockRejectedValue(new ApiError(429, 'Too many reset requests. Wait a while, then try again.'));

    await click(resendButton(view));

    expect(alertText(view)).toEqual(['Too many reset requests. Wait a while, then try again.']);
    expect(textOf(view)).toContain('Check your email');
    expect(textOf(view)).not.toContain('Another link is on its way');
  });

  it('says when the API cannot be reached', async () => {
    mocks.forgotPassword.mockRejectedValue(new ApiError(0, 'Could not connect. Check your connection and try again.'));
    const view = await render(<ForgotPasswordPage />);
    await requestLink(view);

    expect(alertText(view)).toEqual(['Could not connect. Check your connection and try again.']);
    expect(textOf(view)).not.toContain('Check your email');
  });

  it('asks for an address before sending anything', async () => {
    const view = await render(<ForgotPasswordPage />);
    await dispatch(form(view), 'submit');

    expect(alertText(view)).toEqual(['Enter your email address.']);
    expect(byId(view, 'reset-email').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(byId(view, 'reset-email'));
    expect(mocks.forgotPassword).not.toHaveBeenCalled();
  });

  it('goes back to the form, address kept, to fix a typo', async () => {
    const view = await render(<ForgotPasswordPage />);
    await requestLink(view, 'lee@exmaple.com');
    await click(getByName(view, 'button', 'Use a different email'));

    expect(byId(view, 'reset-email').value).toBe('lee@exmaple.com');
    expect(document.activeElement).toBe(byId(view, 'reset-email'));
  });

  it('keeps the confirmation and its actions at AA contrast, also under the pointer', async () => {
    const view = await render(<ForgotPasswordPage />);
    await requestLink(view);

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
