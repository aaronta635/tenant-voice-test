import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOKING_STATUS_LABELS,
  durationLabel,
  inspectionTime,
  inspectionsApi,
  isActiveBooking,
  SLOT_STATUS_LABELS,
  statusPill,
  sydneyLocalOf,
  sydneyMinLocal,
  sydneyNowLocal,
} from './inspections';

describe('Sydney inspection times', () => {
  it('shows the same UTC hour as daylight or standard time, whichever applies that day', () => {
    expect(inspectionTime('2027-11-05T23:00:00Z')).toBe('Sat, 6 Nov, 10:00 am AEDT');
    expect(inspectionTime('2027-06-05T00:00:00Z')).toBe('Sat, 5 June, 10:00 am AEST');
    expect(inspectionTime('2027-06-04T23:00:00Z')).toBe('Sat, 5 June, 9:00 am AEST');
  });

  it('changes zone exactly when the clocks change', () => {
    // Daylight saving starts at 2:00 am on 3 October 2027 and ends at 3:00 am on 4 April 2027.
    expect(inspectionTime('2027-10-02T15:59:00Z')).toBe('Sun, 3 Oct, 1:59 am AEST');
    expect(inspectionTime('2027-10-02T16:00:00Z')).toBe('Sun, 3 Oct, 3:00 am AEDT');
    expect(inspectionTime('2027-04-03T15:30:00Z')).toBe('Sun, 4 Apr, 2:30 am AEDT');
    expect(inspectionTime('2027-04-03T16:30:00Z')).toBe('Sun, 4 Apr, 2:30 am AEST');
  });

  it('gives a field the Sydney wall-clock value of an instant', () => {
    expect(sydneyNowLocal(new Date('2027-10-02T15:59:00Z'))).toBe('2027-10-03T01:59');
    expect(sydneyNowLocal(new Date('2027-10-02T16:00:00Z'))).toBe('2027-10-03T03:00');
    expect(sydneyLocalOf('2027-11-05T23:00:00Z')).toBe('2027-11-06T10:00');
    expect(sydneyLocalOf('not a time')).toBe('');
  });

  it("gives a time field's min as the next 5-minute mark, so every 5-minute time is a whole step from it", () => {
    expect(sydneyMinLocal(new Date('2026-10-23T04:22:00Z'))).toBe('2026-10-23T15:25');
    expect(sydneyMinLocal(new Date('2026-10-23T04:24:59.999Z'))).toBe('2026-10-23T15:25');
    // On a mark it is the next one, since a start must be after now.
    expect(sydneyMinLocal(new Date('2026-10-23T04:25:00Z'))).toBe('2026-10-23T15:30');
    expect(sydneyMinLocal(new Date('2026-10-23T12:58:00Z'))).toBe('2026-10-24T00:00');
    // 1:58 am AEST, two minutes before the clocks go forward to 3:00 am AEDT.
    expect(sydneyMinLocal(new Date('2027-10-02T15:58:00Z'))).toBe('2027-10-03T03:00');
  });

  it('reads a missing or broken time as a dash', () => {
    expect(inspectionTime(null)).toBe('—');
    expect(inspectionTime('soon')).toBe('—');
  });

  it('says how long a viewing is', () => {
    expect([15, 30, 45, 60, 90, 120].map(durationLabel)).toEqual(['15 min', '30 min', '45 min', '1 hr', '1 hr 30 min', '2 hr']);
  });
});

describe('inspection states', () => {
  it('has a label for every state of a slot and a booking', () => {
    expect(Object.keys(SLOT_STATUS_LABELS)).toEqual(['open', 'held', 'booked', 'cancelled']);
    expect(Object.keys(BOOKING_STATUS_LABELS)).toEqual(['pending', 'accepted', 'rejected', 'reschedule_requested', 'cancelled']);
    expect(statusPill('slot', 'held').label).toBe('Requested');
    expect(statusPill('booking', 'reschedule_requested').label).toBe('Pick another time');
    expect(statusPill('record', 'Completed').label).toBe('Completed');
    expect(statusPill('booking', 'something-new')).toEqual({ label: 'something-new', className: 'border-text-body text-text-body' });
  });

  it('counts only a pending or accepted booking as holding the home', () => {
    expect((['pending', 'accepted', 'rejected', 'reschedule_requested', 'cancelled'] as const)
      .filter((status) => isActiveBooking({ status }))).toEqual(['pending', 'accepted']);
  });
});

describe('the inspection calls', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '[]', headers: { get: () => null } });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { path: url.replace(/^.*\/api\/v1/, ''), method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined };
  };

  it.each([
    [() => inspectionsApi.book('slot 1', 'After work'), { path: '/inspection-slots/slot%201/bookings', method: 'POST', body: { note: 'After work' } }],
    [() => inspectionsApi.createSlots('pr-1', ['2027-11-06T10:00'], 45),
      { path: '/me/properties/pr-1/inspection-slots', method: 'POST', body: { starts_at: ['2027-11-06T10:00'], duration_minutes: 45 } }],
    [() => inspectionsApi.cancelSlot('slot-1'), { path: '/inspection-slots/slot-1/cancel', method: 'POST', body: undefined }],
    [() => inspectionsApi.decide('bk-1', 'reschedule'), { path: '/inspection-bookings/bk-1/decision', method: 'POST', body: { decision: 'reschedule' } }],
    [() => inspectionsApi.owner('pr-1'), { path: '/me/inspections?property_id=pr-1', method: 'GET', body: undefined }],
    [() => inspectionsApi.openSlots('pr-1'), { path: '/properties/pr-1/inspection-slots', method: 'GET', body: undefined }],
    [() => inspectionsApi.publicSlots('pr-1'), { path: '/properties/pr-1/inspections', method: 'GET', body: undefined }],
    [() => inspectionsApi.setRecordStatus('rec-1', 'Completed', 'Fine'),
      { path: '/inspection-records/rec-1/status', method: 'POST', body: { status: 'Completed', note: 'Fine' } }],
  ])('sends %#', async (call, expected) => {
    await call();
    expect(sent()).toEqual(expected);
  });
});
