import { cleanup, click, descendants, dispatch, fire, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { InspectionRecord } from '@/app/lib/inspections';
import InspectionRecords from './InspectionRecords';

const mockInspections = vi.hoisted(() => ({
  records: vi.fn(), attendees: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(), setRecordStatus: vi.fn(),
}));

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/inspections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/inspections')>()),
  inspectionsApi: mockInspections,
}));

function record(over: Partial<InspectionRecord> = {}): InspectionRecord {
  return {
    id: 'rec-1', property_id: 'pr-1', property_title: 'Harbour flat', address: '12 Harbour St, Wollongong, NSW, 2500',
    type: 'Private viewing', scheduled_at: '2027-11-05T23:00:00Z', attendee_id: 'tenant-1', attendee_name: 'Tess Tenant',
    notes: 'Video call: https://meet.example.test/abc', status: 'Scheduled',
    history: [{ status: 'Scheduled', note: 'Inspection scheduled by owner', at: '2026-10-23T00:00:00Z' }], ...over,
  };
}

const field = (view: FakeElement, id: string) => descendants(view).find((element) => element.id === id) as FakeElement;

/** The browser's rule: a datetime-local value is a step mismatch unless it is a whole number of steps from min. */
function stepMismatch(value: string, input: FakeElement): boolean {
  const steps = (Date.parse(`${value}Z`) - Date.parse(`${input.getAttribute('min')}Z`)) / (Number(input.getAttribute('step')) * 1000);
  return !Number.isInteger(steps);
}

async function setValue(element: FakeElement, value: string, event = 'input') {
  element.value = value;
  await act(async () => { fire(element, event); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockInspections.records.mockResolvedValue([record()]);
  mockInspections.attendees.mockResolvedValue([{ user_id: 'tenant-1', name: 'Tess Tenant' }]);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe("an owner's scheduled inspections", () => {
  it('schedules a remote inspection with an applicant, in Sydney time', async () => {
    mockInspections.createRecord.mockResolvedValue(record());
    const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);

    await setValue(field(view, 'record-new-type'), 'Routine inspection', 'change');
    await setValue(field(view, 'record-new-when'), '2027-06-05T10:00');
    await setValue(field(view, 'record-new-attendee'), 'tenant-1', 'change');
    await setValue(field(view, 'record-new-notes'), ' Video call: https://meet.example.test/xyz ');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(mockInspections.createRecord).toHaveBeenCalledWith('pr-1', {
      type: 'Routine inspection', scheduled_at: '2027-06-05T10:00', attendee_id: 'tenant-1',
      notes: 'Video call: https://meet.example.test/xyz',
    });
    expect(textOf(view)).toContain('Inspection scheduled. The attendee has been told.');
    expect(mockInspections.records).toHaveBeenCalledTimes(2);
  });

  it('says the attendee was told only when there is one', async () => {
    mockInspections.createRecord.mockResolvedValue(record({ attendee_id: null, attendee_name: null }));
    const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);

    await setValue(field(view, 'record-new-when'), '2030-06-08T10:00');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(mockInspections.createRecord).toHaveBeenCalledWith('pr-1', expect.objectContaining({ attendee_id: null }));
    expect(textOf(view)).toContain('Inspection scheduled.');
    expect(textOf(view)).not.toContain('The attendee has been told.');
  });

  it('shows each record with its time, attendee, notes and state', async () => {
    mockInspections.records.mockResolvedValue([
      record(),
      record({ id: 'rec-2', status: 'Completed', history: [{ status: 'Completed', note: 'Findings: the fan is broken.', at: null }] }),
      record({ id: 'rec-3', status: 'Cancelled', attendee_id: null, attendee_name: null, notes: null }),
    ]);
    const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);
    const text = textOf(view);

    expect(text).toContain('Private viewing · Sat, 6 Nov, 10:00 am AEDT');
    expect(text).toContain('Attendee: Tess Tenant');
    expect(text).toContain('Video call: https://meet.example.test/abc');
    expect(text).toContain('Completed: Findings: the fan is broken.');
    expect(text).toContain('Attendee: None');
    // Only a scheduled record can be edited or closed.
    expect(descendants(view).filter((element) => element.tagName === 'BUTTON' && textOf(element) === 'Edit')).toHaveLength(1);
  });

  it('tells the owner which notes the attendee reads and which stay with them', async () => {
    const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);

    expect(textOf(view)).toContain('The attendee can read the notes');
    expect(textOf(view)).toContain('Notes the attendee can read (meeting link, what to check)');
    await click(getByName(view, 'button', 'Complete or cancel'));
    expect(textOf(view)).toContain('Findings or reason (optional; only you see this)');
  });

  it('completes a record with its findings', async () => {
    mockInspections.setRecordStatus.mockResolvedValue(record({ status: 'Completed' }));
    const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);

    await click(getByName(view, 'button', 'Complete or cancel'));
    await setValue(field(view, 'record-rec-1-status-note'), 'Findings: all good.');
    await click(getByName(view, 'button', 'Mark completed'));

    expect(mockInspections.setRecordStatus).toHaveBeenCalledWith('rec-1', 'Completed', 'Findings: all good.');
  });

  it('asks before cancelling a record, which cannot be undone and tells the attendee', async () => {
    mockInspections.setRecordStatus.mockResolvedValue(record({ status: 'Cancelled' }));
    const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);

    await click(getByName(view, 'button', 'Complete or cancel'));
    await click(getByName(view, 'button', 'Cancel inspection'));
    expect(mockInspections.setRecordStatus).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Cancel this inspection? It cannot be undone, and the attendee is told.');

    await click(getByName(view, 'button', 'Keep it'));
    expect(mockInspections.setRecordStatus).not.toHaveBeenCalled();
    await click(getByName(view, 'button', 'Cancel inspection'));
    await click(getByName(view, 'button', 'Yes, cancel it'));
    expect(mockInspections.setRecordStatus).toHaveBeenCalledWith('rec-1', 'Cancelled', null);
  });

  it('edits a scheduled record, keeping its Sydney time', async () => {
    mockInspections.updateRecord.mockRejectedValue(new ApiError(422, 'Choose a date and time in the future.'));
    const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);

    await click(getByName(view, 'button', 'Edit'));
    expect(field(view, 'record-rec-1-when').value).toBe('2027-11-06T10:00');
    await dispatch(descendants(view).filter((element) => element.tagName === 'FORM')[1], 'submit');

    // The time was not changed: it goes back as the record's own instant.
    expect(mockInspections.updateRecord).toHaveBeenCalledWith('rec-1', {
      type: 'Private viewing', scheduled_at: '2027-11-05T23:00:00Z', attendee_id: 'tenant-1',
      notes: 'Video call: https://meet.example.test/abc',
    });
    expect(textOf(view)).toContain('Choose a date and time in the future.');
  });

  it("editing only the notes keeps a time in daylight saving's repeated hour, or with seconds, as it was", async () => {
    // 2:30 am AEST on 7 Apr 2030, the second 2:30 that night, and a mobile record with seconds.
    for (const scheduled of ['2030-04-06T16:30:00Z', '2030-06-08T00:00:30Z']) {
      mockInspections.records.mockResolvedValue([record({ scheduled_at: scheduled })]);
      mockInspections.updateRecord.mockResolvedValue(record({ scheduled_at: scheduled }));
      const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);

      await click(getByName(view, 'button', 'Edit'));
      await setValue(field(view, 'record-rec-1-notes'), 'Bring the keys');
      await dispatch(descendants(view).filter((element) => element.tagName === 'FORM')[1], 'submit');

      expect(mockInspections.updateRecord).toHaveBeenLastCalledWith('rec-1', expect.objectContaining({
        scheduled_at: scheduled, notes: 'Bring the keys',
      }));
      await cleanup();
    }
  });

  it('offers every 5-minute time from the next 5-minute mark, and leaves judging a time to the database', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T04:22:00Z')); // 3:22 pm AEDT
    try {
      // A record made on mobile at 10:03 am, which no 5-minute step reaches.
      mockInspections.records.mockResolvedValue([record({ scheduled_at: '2027-11-05T23:03:00Z' })]);
      mockInspections.updateRecord.mockResolvedValue(record());
      const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);
      await click(getByName(view, 'button', 'Edit'));

      for (const id of ['record-new-when', 'record-rec-1-when']) {
        expect(field(view, id).getAttribute('min')).toBe('2026-10-23T15:25');
        expect(field(view, id).getAttribute('step')).toBe('300');
      }
      expect(stepMismatch('2026-10-24T10:00', field(view, 'record-new-when'))).toBe(false);
      expect(stepMismatch('2027-11-06T10:03', field(view, 'record-rec-1-when'))).toBe(true);
      // So the browser holds back no time, and that record's notes can still be edited.
      const forms = descendants(view).filter((element) => element.tagName === 'FORM');
      expect(forms).toHaveLength(2);
      for (const form of forms) expect(form.hasAttribute('noValidate')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a changed time as the Sydney time typed', async () => {
    mockInspections.updateRecord.mockResolvedValue(record());
    const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);

    await click(getByName(view, 'button', 'Edit'));
    await setValue(field(view, 'record-rec-1-when'), '2030-11-09T11:00');
    await dispatch(descendants(view).filter((element) => element.tagName === 'FORM')[1], 'submit');

    expect(mockInspections.updateRecord).toHaveBeenCalledWith('rec-1', expect.objectContaining({ scheduled_at: '2030-11-09T11:00' }));
  });

  it('shows an error with a retry', async () => {
    mockInspections.records.mockRejectedValueOnce(new ApiError(500, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<InspectionRecords mode="owner" propertyId="pr-1" />);
    expect(textOf(view)).toContain('The service is temporarily unavailable.');

    mockInspections.records.mockResolvedValue([]);
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Nothing scheduled yet.');
  });
});

describe('the inspections scheduled with a tenant', () => {
  it('lists them with the meeting link and no way to change them', async () => {
    const view = await render(<InspectionRecords mode="attendee" />);

    expect(mockInspections.attendees).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Video call: https://meet.example.test/abc');
    expect(getByName(view, 'a', 'Harbour flat').getAttribute('href')).toBe('/tenant/properties/pr-1');
    expect(descendants(view).filter((element) => element.tagName === 'BUTTON' || element.tagName === 'FORM')).toEqual([]);
  });

  it("names a leased home's inspection without a link to its listing page, which is not public", async () => {
    mockInspections.records.mockResolvedValue([record({ type: 'Routine inspection', listed: false })]);
    const view = await render(<InspectionRecords mode="attendee" />);

    expect(descendants(view).filter((element) => element.tagName === 'A')).toEqual([]);
    expect(textOf(view)).toContain('Harbour flat · 12 Harbour St, Wollongong, NSW, 2500');
  });

  it('says when there are none', async () => {
    mockInspections.records.mockResolvedValue([]);

    expect(textOf(await render(<InspectionRecords mode="attendee" />))).toContain('No owner has scheduled an inspection with you.');
  });
});
