import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Booking } from '@/app/lib/api';
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

function refusal(status: string, message: string, documents_href: string | null) {
  return new ApiError(403, message, { code: 'verification_required', action: 'accept_booking', status, message, documents_href });
}

async function accept(view: FakeElement) {
  await click(getByName(view, 'button', 'Accept booking for Cleo Client'));
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
  await settle();
}

const dialog = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open')) as FakeElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockApi.bookings.list.mockResolvedValue([enquiry]);
  mockApi.providers.mine.mockResolvedValue({ id: 'prov-1' });
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('a booking the gates refuse', () => {
  it('says why an unverified provider cannot accept it, with the way to their documents', async () => {
    const message = 'Your account needs to be verified before you can accept bookings. Upload the documents it asks for, or wait for the review to finish.';
    mockApi.bookings.update.mockRejectedValue(refusal('pending', message, '/dashboard/profile#verification-documents'));
    const view = await render(<BookingList />);

    await accept(view);

    expect(mockApi.bookings.update).toHaveBeenCalledWith('b1', { status: 'confirmed' });
    const alerts = descendants(dialog(view)).filter((element) => element.getAttribute('role') === 'alert');
    expect(alerts.map(textOf)).toEqual([`Verification needed${message}Go to your documents`, '']);
    expect(getByName(dialog(view), 'a', 'Go to your documents').getAttribute('href')).toBe('/dashboard/profile#verification-documents');
    expect(textOf(view)).not.toContain('Booking updated');
    expect(lowContrastText(dialog(view))).toEqual([]);
  });

  it('tells a suspended provider they take no new work, without a documents link', async () => {
    const message = "Your account is suspended, so you can't accept bookings. Contact support to restore it.";
    mockApi.bookings.update.mockRejectedValue(refusal('suspended', message, null));
    const view = await render(<BookingList />);

    await accept(view);

    expect(textOf(dialog(view))).toContain(`Account suspended${message}`);
    expect(descendants(dialog(view)).some((element) => textOf(element) === 'Go to your documents')).toBe(false);
  });

  it('starts again without the refusal when the dialog opens again', async () => {
    mockApi.bookings.update.mockRejectedValueOnce(refusal('pending', 'Verify first.', null))
      .mockRejectedValueOnce(new ApiError(409, 'That time overlaps another booking. Choose another time.'));
    const view = await render(<BookingList />);

    await accept(view);
    await click(getByName(dialog(view), 'button', 'Go back'));
    await accept(view);

    expect(textOf(dialog(view))).not.toContain('Verify first.');
    expect(textOf(dialog(view))).toContain('That time overlaps another booking. Choose another time.');
  });
});
