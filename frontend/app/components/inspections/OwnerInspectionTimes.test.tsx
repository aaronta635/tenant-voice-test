import { cleanup, click, descendants, dispatch, fire, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { InspectionBooking, InspectionSlot } from '@/app/lib/inspections';
import OwnerInspectionTimes from './OwnerInspectionTimes';

const mockInspections = vi.hoisted(() => ({ owner: vi.fn(), createSlots: vi.fn(), cancelSlot: vi.fn(), decide: vi.fn() }));

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/inspections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/inspections')>()),
  inspectionsApi: mockInspections,
}));

const SUMMER = '2027-11-05T23:00:00Z';

function slot(id: string, status: InspectionSlot['status'], over: Partial<InspectionSlot> = {}): InspectionSlot {
  return {
    id, property_id: 'pr-1', owner_id: 'owner-1', starts_at: SUMMER, duration_minutes: 45, status,
    property_title: 'Harbour flat', address: '12 Harbour St', created_at: null, updated_at: null, ...over,
  };
}

function booking(id: string, status: InspectionBooking['status'], over: Partial<InspectionBooking> = {}): InspectionBooking {
  return {
    id, slot_id: 'slot-held', property_id: 'pr-1', owner_id: 'owner-1', tenant_id: 'tenant-1', status, note: 'After work please',
    starts_at: SUMMER, duration_minutes: 45, slot_status: 'held', property_title: 'Harbour flat', address: '12 Harbour St',
    tenant_name: 'Tess Tenant', owner_name: 'Olivia Owner', created_at: null, updated_at: null, ...over,
  };
}

const inputs = (view: FakeElement, type: string) => descendants(view).filter((element) => element.tagName === 'INPUT' && (element.type || element.getAttribute('type')) === type);
const publishForm = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'FORM') as FakeElement;

/** The browser's rule: a datetime-local value is a step mismatch unless it is a whole number of steps from min. */
function stepMismatch(value: string, input: FakeElement): boolean {
  const steps = (Date.parse(`${value}Z`) - Date.parse(`${input.getAttribute('min')}Z`)) / (Number(input.getAttribute('step')) * 1000);
  return !Number.isInteger(steps);
}

async function setValue(element: FakeElement, value: string) {
  element.value = value;
  await act(async () => { fire(element, 'input'); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockInspections.owner.mockResolvedValue({
    slots: [slot('slot-open', 'open'), slot('slot-held', 'held'), slot('slot-booked', 'booked')],
    bookings: [booking('bk-pending', 'pending'), booking('bk-accepted', 'accepted'), booking('bk-rejected', 'rejected'),
      booking('bk-reschedule', 'reschedule_requested')],
  });
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe("an owner's inspection times", () => {
  it('shows every time and request with its state, in Sydney time', async () => {
    const view = await render(<OwnerInspectionTimes propertyId="pr-1" />);
    const text = textOf(view);

    expect(mockInspections.owner).toHaveBeenCalledWith('pr-1');
    for (const label of ['Open', 'Requested', 'Booked', 'Waiting for the owner', 'Accepted', 'Declined', 'Pick another time']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Sat, 6 Nov, 10:00 am AEDT · 45 min');
    expect(text).toContain('“After work please”');
    // Only an open or held time can be cancelled, and only a pending request decided.
    expect(descendants(view).filter((element) => /^Cancel the time /.test(element.getAttribute('aria-label') ?? ''))).toHaveLength(2);
    expect(descendants(view).filter((element) => /^Accept: /.test(element.getAttribute('aria-label') ?? ''))).toHaveLength(1);
  });

  it('publishes the times as typed, in Sydney time, with their length', async () => {
    mockInspections.createSlots.mockResolvedValue([slot('new-1', 'open')]);
    const view = await render(<OwnerInspectionTimes propertyId="pr-1" />);

    await setValue(inputs(view, 'datetime-local')[0], '2027-11-06T10:00');
    await click(getByName(view, 'button', 'Add another time'));
    await setValue(inputs(view, 'datetime-local')[1], '2027-11-06T10:00');
    const length = descendants(view).find((element) => element.tagName === 'SELECT') as FakeElement;
    length.value = '60';
    await act(async () => { fire(length, 'change'); });
    await dispatch(publishForm(view), 'submit');

    expect(mockInspections.createSlots).toHaveBeenCalledWith('pr-1', ['2027-11-06T10:00', '2027-11-06T10:00'], 60);
    expect(textOf(view)).toContain('Published 1 inspection time.');
    expect(mockInspections.owner).toHaveBeenCalledTimes(2);
  });

  it('offers every 5-minute time from the next 5-minute mark, and leaves judging a time to the database', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T04:22:00Z')); // 3:22 pm AEDT
    try {
      const view = await render(<OwnerInspectionTimes propertyId="pr-1" />);
      const start = inputs(view, 'datetime-local')[0];

      expect(start.getAttribute('min')).toBe('2026-10-23T15:25');
      expect(start.getAttribute('step')).toBe('300');
      expect(stepMismatch('2026-10-24T10:00', start)).toBe(false);
      // The browser holds back no time, such as 10:02: the database says if one is refused.
      expect(publishForm(view).hasAttribute('noValidate')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what the database refused', async () => {
    mockInspections.createSlots.mockRejectedValue(new ApiError(422, 'Inspection times must be in the future.'));
    const view = await render(<OwnerInspectionTimes propertyId="pr-1" />);

    await setValue(inputs(view, 'datetime-local')[0], '2027-11-06T10:00');
    await dispatch(publishForm(view), 'submit');

    expect(textOf(view)).toContain('Inspection times must be in the future.');
  });

  it('asks for a time before publishing', async () => {
    const view = await render(<OwnerInspectionTimes propertyId="pr-1" />);

    await dispatch(publishForm(view), 'submit');

    expect(mockInspections.createSlots).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Add at least one inspection time.');
  });

  it('cancels a time once confirmed', async () => {
    mockInspections.cancelSlot.mockResolvedValue(slot('slot-open', 'cancelled'));
    const view = await render(<OwnerInspectionTimes propertyId="pr-1" />);

    await click(descendants(view).filter((element) => /^Cancel the time /.test(element.getAttribute('aria-label') ?? ''))[0]);
    expect(mockInspections.cancelSlot).not.toHaveBeenCalled();
    await click(getByName(view, 'button', 'Yes, cancel it'));

    expect(mockInspections.cancelSlot).toHaveBeenCalledWith('slot-open');
    expect(textOf(view)).toContain('Time cancelled. Anyone waiting on it has been told.');
  });

  it.each([
    ['Accept', 'accept', 'Accepted: the time is booked and the tenant has been told.'],
    ['Decline', 'reject', 'Declined: the time is open again and the tenant has been told.'],
    ['Ask to reschedule', 'reschedule', 'The tenant has been asked to pick another time.'],
  ])('decides a pending request: %s', async (label, decision, done) => {
    mockInspections.decide.mockResolvedValue(booking('bk-pending', 'accepted'));
    const view = await render(<OwnerInspectionTimes propertyId="pr-1" />);

    await click(descendants(view).find((element) => (element.getAttribute('aria-label') ?? '').startsWith(`${label}: Tess Tenant`)) as FakeElement);

    expect(mockInspections.decide).toHaveBeenCalledWith('bk-pending', decision);
    expect(textOf(view)).toContain(done);
  });

  it('shows a decision the database refused', async () => {
    mockInspections.decide.mockRejectedValue(new ApiError(422, 'This booking has already been decided.'));
    const view = await render(<OwnerInspectionTimes propertyId="pr-1" />);

    await click(descendants(view).find((element) => (element.getAttribute('aria-label') ?? '').startsWith('Accept: ')) as FakeElement);

    expect(textOf(view)).toContain('This booking has already been decided.');
  });

  it('lists every listing without the publish form, linking each to its property', async () => {
    const view = await render(<OwnerInspectionTimes />);

    expect(mockInspections.owner).toHaveBeenCalledWith(undefined);
    expect(descendants(view).filter((element) => element.tagName === 'FORM')).toEqual([]);
    expect(descendants(view).filter((element) => element.tagName === 'A').map((element) => element.getAttribute('href')))
      .toContain('/owner/properties/pr-1?tab=inspections');
  });

  it('shows an error with a retry, and the empty states', async () => {
    mockInspections.owner.mockRejectedValueOnce(new ApiError(403, 'Choose one of your properties.'));
    const view = await render(<OwnerInspectionTimes propertyId="pr-1" />);
    expect(textOf(view)).toContain('Choose one of your properties.');

    mockInspections.owner.mockResolvedValue({ slots: [], bookings: [] });
    await click(getByName(view, 'button', 'Try again'));

    expect(textOf(view)).toContain('No requests yet.');
    expect(textOf(view)).toContain('No inspection times yet. Publish some above.');
  });
});
