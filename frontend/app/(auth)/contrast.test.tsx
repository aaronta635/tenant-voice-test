import { cleanup, render, textOf } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from './forgot-password/page';
import LoginPage from './login/page';
import RegisterPage from './register/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

afterEach(cleanup);

describe('sign-in, sign-up and password reset contrast', () => {
  it.each([
    ['sign-in', LoginPage, ['Welcome back', 'Forgot?', 'Sign in', 'Create an account']],
    ['sign-up', RegisterPage, ['Continue to workspace', 'Terms', 'Privacy Policy', 'Sign in']],
    ['password reset', ForgotPasswordPage, ['Reset your password', 'Send reset link', 'Sign in']],
  ])('keeps the %s page\'s buttons and links at AA contrast, also under the pointer', async (_page, Page, labels) => {
    const view = await render(<Page />);
    for (const label of labels) expect(textOf(view)).toContain(label);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
