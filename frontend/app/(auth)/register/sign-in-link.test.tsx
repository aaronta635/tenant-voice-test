import { cleanup, click, descendants, getByName, render, type FakeElement } from '@/app/components/ui/test-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RegisterPage from './page';

const navigation = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const bookingPath = '/providers/amelia?service=svc-1#booking';
const signInLink = (view: FakeElement) => new URL(descendants(view).find((element) => element.tagName === 'A' && element.textContent.trim() === 'Sign in')?.getAttribute('href') as string, 'https://tenantvoice.invalid');

afterEach(cleanup);

describe('the register page "Sign in" link', () => {
  it('names the account type the visitor picks', async () => {
    navigation.search = `next=${encodeURIComponent(bookingPath)}`;
    const view = await render(<RegisterPage />);
    expect(signInLink(view).searchParams.has('role')).toBe(false);

    await click(getByName(view, 'button', /^Landlord/));

    expect(signInLink(view).searchParams.get('role')).toBe('landlord');
    expect(signInLink(view).searchParams.get('next')).toBe(bookingPath);
  });
});
