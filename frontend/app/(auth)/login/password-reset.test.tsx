import { cleanup, descendants, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD_UPDATED_LOGIN_HREF } from '@/app/lib/password-reset';
import LoginPage from './page';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const statusText = (view: FakeElement) => descendants(view).filter((element) => element.getAttribute('role') === 'status').map(textOf);

afterEach(cleanup);

describe('the sign-in page and password reset', () => {
  it('links "Forgot?" to the forgot password page', async () => {
    nav.search = '';
    const view = await render(<LoginPage />);

    expect(getByName(view, 'a', 'Forgot?').getAttribute('href')).toBe('/forgot-password');
  });

  it('confirms a finished reset where the reset page sends the user', async () => {
    nav.search = new URL(PASSWORD_UPDATED_LOGIN_HREF, 'https://tenantvoice.test').search;
    const view = await render(<LoginPage />);

    expect(new URL(PASSWORD_UPDATED_LOGIN_HREF, 'https://tenantvoice.test').pathname).toBe('/login');
    expect(statusText(view)).toContain('Password updated. Sign in with your new password.');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('says nothing about a reset on a plain visit', async () => {
    nav.search = '';
    const view = await render(<LoginPage />);

    expect(textOf(view)).not.toContain('Password updated');
  });
});
