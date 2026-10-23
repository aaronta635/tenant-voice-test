import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '@/app/lib/api';
import BookingList from './BookingList';

const mockApi = vi.hoisted(() => ({
  bookings: { list: vi.fn(), update: vi.fn() },
  providers: { mine: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const enquiry: Booking = {
  id: 'b1', client_id: 'cleo', provider_id: 'prov-1', service_id: 'bond', status: 'new_enquiry',
  property_address: null, property_suburb: 'Newtown', scheduled_date: '2031-03-04', scheduled_time: '10:00:00',
  price: 320, notes: null, completion_report: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  client_name: 'Cleo Client', client_avatar_url: null, provider_name: 'Harbour Cleans', service_title: 'Bond clean',
  review_rating: null, unread_count: 0, conversation_id: 'c1',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const focused = () => document.activeElement as unknown as FakeElement;

/** Accepts the enquiry through its confirmation dialog, as a click leaves focus on the buttons. */
async function accept(view: FakeElement) {
  const open = getByName(view, 'button', 'Accept booking for Cleo Client');
  open.focus();
  await click(open);
  getByName(view, 'button', 'Confirm change').focus();
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.bookings.list.mockResolvedValue([enquiry]);
  mockApi.providers.mine.mockResolvedValue({ id: 'prov-1' });
});
afterEach(cleanup);

describe('BookingList results', () => {
  it('moves focus to the booking’s result once a change saves', async () => {
    mockApi.bookings.update.mockResolvedValue({ ...enquiry, status: 'confirmed' });
    const view = await render(<BookingList />);
    await accept(view);

    expect(mockApi.bookings.update).toHaveBeenCalledWith('b1', { status: 'confirmed' });
    expect(textOf(focused())).toBe('Booking updated: Confirmed.');
  });

  it('leaves focus where the provider moved it while the change saved', async () => {
    const saved = deferred<Booking>();
    mockApi.bookings.update.mockReturnValue(saved.promise);
    // The shell's header search sits outside the list.
    const view = await render(<><input aria-label="Search" /><BookingList /></>);
    await accept(view);
    // Say another dialog opened on top and took focus; stand it in by
    // closing this one without telling the page.
    (descendants(view).find((element) => element.tagName === 'DIALOG') as FakeElement).close();
    const search = getByName(view, 'input', 'Search');
    search.focus();

    await act(async () => saved.resolve({ ...enquiry, status: 'confirmed' }));
    await settle();
    expect(focused()).toBe(search);
    expect(textOf(view)).toContain('Booking updated: Confirmed.');
  });
});
