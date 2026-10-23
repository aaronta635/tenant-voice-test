import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { InspectionBooking as Booking, InspectionSlot } from '@/app/lib/inspections';
import InspectionBooking from './InspectionBooking';

const mockInspections = vi.hoisted(() => ({
  publicSlots: vi.fn(), openSlots: vi.fn(), myBookings: vi.fn(), book: vi.fn(),
}));
const chat = vi.hoisted(() => ({ startRental: vi.fn() }));

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/inspections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/inspections')>()),
  inspectionsApi: mockInspections,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { conversations: chat },
}));

// 7 Nov is daylight time in Sydney (AEDT), 5 June standard time (AEST).
const SUMMER = '2027-11-05T23:00:00Z';
const WINTER = '2027-06-05T00:00:00Z';

function slot(id: string, startsAt: string, over: Partial<InspectionSlot> = {}): InspectionSlot {
  return {
    id, property_id: 'pr-1', owner_id: 'owner-1', starts_at: startsAt, duration_minutes: 30, status: 'open',
    property_title: 'Harbour flat', address: null, created_at: null, updated_at: null, ...over,
  };
}

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1', slot_id: 'slot-1', property_id: 'pr-1', owner_id: 'owner-1', tenant_id: 'me', status: 'pending',
    note: null, starts_at: SUMMER, duration_minutes: 30, slot_status: 'held', property_title: 'Harbour flat',
    address: '12 Harbour St', tenant_name: 'Tess Tenant', owner_name: 'Olivia Owner', created_at: null, updated_at: null,
    ...over,
  };
}

const PROPS = { propertyId: 'pr-1', signInHref: '/login?next=%2Fproperties%2Fpr-1', manageHref: '/owner/properties/pr-1?tab=inspections' };
const radios = (view: FakeElement) => descendants(view).filter((element) => element.hasAttribute('aria-pressed'));
const form = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'FORM') as FakeElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockInspections.publicSlots.mockResolvedValue([slot('slot-1', SUMMER), slot('slot-2', WINTER)]);
  mockInspections.openSlots.mockResolvedValue([slot('slot-1', SUMMER), slot('slot-2', WINTER)]);
  mockInspections.myBookings.mockResolvedValue([]);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('booking an inspection as a tenant', () => {
  it('leaves out a time that answered 409, which the list still shows as open, and picks another', async () => {
    mockInspections.book.mockRejectedValueOnce(new ApiError(409, 'That inspection time is no longer available.'));
    mockInspections.book.mockResolvedValue(booking({ slot_id: 'slot-2', starts_at: WINTER }));
    const view = await render(<InspectionBooking {...PROPS} role="tenant" isOwner={false} />);

    await dispatch(form(view), 'submit');
    expect(textOf(view)).toContain('That inspection time is no longer available.');
    // The reloaded list still names slot-1 (a reschedule hold): it is not offered again.
    expect(mockInspections.openSlots).toHaveBeenCalledTimes(2);
    expect(radios(view)).toHaveLength(1);
    expect(radios(view)[0].getAttribute('aria-pressed')).toBe('true');

    await dispatch(form(view), 'submit');
    expect(mockInspections.book.mock.calls.map(([id]) => id)).toEqual(['slot-1', 'slot-2']);
  });

  it('lists the times in Sydney time, daylight saving or not', async () => {
    const view = await render(<InspectionBooking {...PROPS} role="tenant" isOwner={false} />);

    expect(mockInspections.openSlots).toHaveBeenCalledWith('pr-1');
    expect(textOf(view)).toContain('Sat, 6 Nov, 10:00 am AEDT · 30 min');
    expect(textOf(view)).toContain('Sat, 5 June, 10:00 am AEST · 30 min');
    expect(radios(view)).toHaveLength(2);
  });

  it('books the chosen time with a note, through the booking call and never a chat message', async () => {
    mockInspections.book.mockResolvedValue(booking({ slot_id: 'slot-2', starts_at: WINTER, note: 'After work please' }));
    const view = await render(<InspectionBooking {...PROPS} role="tenant" isOwner={false} />);

    await click(radios(view)[1]);
    expect(radios(view).map((element) => element.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    await typeInto(descendants(view).find((element) => element.tagName === 'TEXTAREA') as FakeElement, '  After work please ');
    await dispatch(form(view), 'submit');

    expect(mockInspections.book).toHaveBeenCalledWith('slot-2', 'After work please');
    expect(chat.startRental).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Requested Sat, 5 June, 10:00 am AEST. The owner has been told.');
    expect(textOf(view)).toContain('Your inspection');
    expect(textOf(view)).toContain('Waiting for the owner');
    // One active booking per home: no second request can be made.
    expect(descendants(view).filter((element) => element.tagName === 'FORM')).toEqual([]);
  });

  it('says why a booking was refused and shows the times still open', async () => {
    mockInspections.book.mockRejectedValue(new ApiError(409, 'That inspection time is no longer available.'));
    const view = await render(<InspectionBooking {...PROPS} role="tenant" isOwner={false} />);
    mockInspections.openSlots.mockResolvedValue([slot('slot-2', WINTER)]);

    await dispatch(form(view), 'submit');

    expect(mockInspections.book).toHaveBeenCalledWith('slot-1', null);
    expect(textOf(view)).toContain('That inspection time is no longer available.');
    expect(mockInspections.openSlots).toHaveBeenCalledTimes(2);
    expect(radios(view)).toHaveLength(1);
  });

  it.each([
    ['pending', 'Waiting for the owner', false],
    ['accepted', 'Accepted', false],
    ['reschedule_requested', 'Pick another time', true],
    ['rejected', 'Declined', true],
  ] as const)('shows a %s booking for this home, and books again only once it no longer holds the home', async (status, label, canBook) => {
    mockInspections.myBookings.mockResolvedValue([booking({ status }), booking({ id: 'bk-other', property_id: 'pr-2', status: 'accepted' })]);

    const view = await render(<InspectionBooking {...PROPS} role="tenant" isOwner={false} />);

    expect(textOf(view)).toContain(`Your inspection${label}`);
    expect(textOf(view)).toContain('Sat, 6 Nov, 10:00 am AEDT');
    expect(descendants(view).some((element) => element.tagName === 'FORM')).toBe(canBook);
  });

  it('shows the error and retries when the times cannot be loaded', async () => {
    mockInspections.openSlots.mockRejectedValueOnce(new ApiError(422, 'Inspections are only available while this property is listed for viewing.'));
    const view = await render(<InspectionBooking {...PROPS} role="tenant" isOwner={false} />);

    expect(textOf(view)).toContain('Inspections are only available while this property is listed for viewing.');
    await click(getByName(view, 'button', 'Try again'));
    expect(radios(view)).toHaveLength(2);
  });

  it('says when no times are published', async () => {
    mockInspections.openSlots.mockResolvedValue([]);

    const view = await render(<InspectionBooking {...PROPS} role="tenant" isOwner={false} />);

    expect(textOf(view)).toContain('No inspection times published yet — message the landlord to arrange one.');
  });
});

describe('the times for anyone else', () => {
  it('asks a signed-out visitor to sign in to book', async () => {
    const view = await render(<InspectionBooking {...PROPS} role={null} isOwner={false} />);

    expect(mockInspections.publicSlots).toHaveBeenCalledWith('pr-1');
    expect(mockInspections.openSlots).not.toHaveBeenCalled();
    expect(radios(view)).toEqual([]);
    expect(getByName(view, 'a', 'Sign in to book an inspection').getAttribute('href')).toBe(PROPS.signInHref);
  });

  it('sends the owner to manage the times', async () => {
    const view = await render(<InspectionBooking {...PROPS} role="landlord" isOwner />);

    expect(getByName(view, 'a', 'Manage inspection times').getAttribute('href')).toBe(PROPS.manageHref);
    expect(mockInspections.myBookings).not.toHaveBeenCalled();
  });

  it('tells another landlord that tenants book', async () => {
    const view = await render(<InspectionBooking {...PROPS} role="landlord" isOwner={false} />);

    expect(textOf(view)).toContain('Inspections are booked from a tenant account.');
  });
});
