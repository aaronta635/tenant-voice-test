import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { roleForSignIn } from '@/app/lib/auth-redirect';
import { stubBrowser } from '@/app/lib/test-browser';

// Vitest runs in node without a DOM, so the component is called directly with
// the recovery snapshot it would read from the session store.
const state = vi.hoisted(() => ({ recovery: null as null | { id: number; role: string | null } }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useSyncExternalStore: () => state.recovery, useState: <T,>(initial: T) => [initial, () => {}] };
});

beforeEach(() => {
  vi.resetModules();
  stubBrowser({ pathname: '/tenant/bookings', search: '?tab=upcoming' });
});

afterEach(() => { vi.unstubAllGlobals(); });

/** The "Sign in (new tab)" link the expiry notice offers for `role`. */
async function signInLink(role: string | null) {
  state.recovery = { id: 1, role };
  const { default: SessionExpiredNotice } = await import('./SessionExpiredNotice');
  const modal = SessionExpiredNotice() as ReactElement<{ open: boolean; children: ReactElement<{ href: string }>[] }>;
  expect(modal.props.open).toBe(true);
  return new URL(modal.props.children[1].props.href, 'https://tenantvoice.invalid');
}

describe('SessionExpiredNotice', () => {
  it('leaves the role out when none was stored, so sign-in infers it from next', async () => {
    const link = await signInLink(null);
    expect(link.searchParams.get('next')).toBe('/tenant/bookings?tab=upcoming');
    expect(link.searchParams.has('role')).toBe(false);
    expect(roleForSignIn(link.searchParams.get('role'), link.searchParams.get('next'))).toBe('Client');
  });

  it('ignores an unrecognised stored role', async () => {
    expect((await signInLink('admin')).searchParams.has('role')).toBe(false);
  });

  it('keeps a known stored role', async () => {
    expect((await signInLink('Owner')).searchParams.get('role')).toBe('landlord');
  });
});
