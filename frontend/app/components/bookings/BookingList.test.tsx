import { cleanup, click, descendants, getByName, render, settle, type FakeElement } from '@/app/components/ui/test-dom';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '@/app/lib/api';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import BookingList from './BookingList';

const navigation = vi.hoisted(() => ({ page: null as FakeHistory | null, navigate: vi.fn() }));

vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: navigation.navigate, replace: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => {
      const search = useSyncExternalStore(
        (listener) => navigation.page?.subscribe(listener) ?? (() => {}),
        () => navigation.page?.search ?? '',
      );
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.navigate(href)),
}));

const bookings = vi.hoisted(() => ['b1', 'b2', 'b3'].map((id) => ({
  id, client_id: `client-${id}`, provider_id: 'provider-1', service_id: null, status: 'confirmed',
  property_address: `${id} Main St`, property_suburb: 'Newtown', scheduled_date: '2026-11-02', scheduled_time: '09:00:00',
  price: 100, notes: null, completion_report: null, created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z',
  client_name: `Client ${id}`, client_avatar_url: null, provider_name: 'Harbour Plumbing', service_title: `Service ${id}`,
  review_rating: null, unread_count: 0, conversation_id: null,
}) as Booking));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    bookings: { list: async () => bookings },
    providers: { mine: async () => ({ id: 'provider-1' }) },
  },
}));

let leavePage = () => {};
afterEach(async () => {
  await cleanup();
  leavePage();
  navigation.page = null;
});

const listed = (view: FakeElement) => descendants(view).filter((element) => element.id.startsWith('booking-')).map((element) => element.id);

describe.each([
  { scope: 'dashboard', href: '/dashboard/bookings' },
  { scope: 'client', href: '/dashboard/client-bookings' },
  { scope: 'owner', href: '/owner/bookings' },
  { scope: 'tenant', href: '/tenant/bookings' },
] as const)('BookingList ($scope) View all bookings', ({ scope, href }) => {
  // After a full load of a prerendered page with ?booking=, next 16.2's router
  // sends a link to the page's bare path back to the loaded URL.
  it('lists every booking again after a deep link, through the History API', async () => {
    const page = createFakeHistory(`${href}?booking=b2`);
    leavePage = page.install(window);
    navigation.page = page;
    navigation.navigate = vi.fn();
    const view = await render(<BookingList scope={scope} />);
    expect(listed(view)).toEqual(['booking-b2']);

    await click(getByName(view, 'a', 'View all bookings'));
    expect(page.stack()).toEqual([`${href}?booking=b2`, `>${href}`]);
    expect(navigation.navigate).not.toHaveBeenCalled();

    await act(async () => { page.land(); });
    await settle();
    expect(listed(view)).toEqual(['booking-b1', 'booking-b2', 'booking-b3']);
    expect(descendants(view).some((element) => element.textContent === 'View all bookings')).toBe(false);
  });
});
