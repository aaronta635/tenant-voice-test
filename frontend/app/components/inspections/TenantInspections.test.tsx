import { cleanup, click, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { InspectionBooking } from '@/app/lib/inspections';
import TenantInspections from './TenantInspections';

const mockInspections = vi.hoisted(() => ({ myBookings: vi.fn(), homes: vi.fn(), records: vi.fn() }));

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/inspections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/inspections')>()),
  inspectionsApi: mockInspections,
}));

function booking(id: string, status: InspectionBooking['status'], startsAt: string): InspectionBooking {
  return {
    id, slot_id: `slot-${id}`, property_id: `pr-${id}`, owner_id: 'owner-1', tenant_id: 'me', status, note: null,
    starts_at: startsAt, duration_minutes: 30, slot_status: 'held', property_title: `Home ${id}`, address: '12 Harbour St',
    tenant_name: 'Tess Tenant', owner_name: 'Olivia Owner', created_at: null, updated_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockInspections.myBookings.mockResolvedValue([
    booking('a', 'pending', '2027-11-05T23:00:00Z'),
    booking('b', 'accepted', '2027-06-05T00:00:00Z'),
    booking('c', 'rejected', '2027-06-05T00:00:00Z'),
    booking('d', 'reschedule_requested', '2027-06-05T00:00:00Z'),
    booking('e', 'cancelled', '2027-06-05T00:00:00Z'),
  ]);
  mockInspections.homes.mockResolvedValue([
    { property_id: 'pr-x', title: 'Garden studio', address: '3 Park Rd', owner_id: 'owner-2', owner_name: 'Oscar Other', open_slot_count: 2 },
  ]);
  mockInspections.records.mockResolvedValue([]);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe("a tenant's inspections", () => {
  it('shows every request in its state, with the next step and Sydney times', async () => {
    const text = textOf(await render(<TenantInspections />));

    for (const words of [
      'Waiting for the owner', 'The owner will accept it, decline it or ask you to pick another time.',
      'Accepted. This is a viewing, not a decision on a rental application.',
      'Declined. You can ask for another open time.', 'The owner asked you to pick another time.', 'Cancelled.',
      'Sat, 6 Nov, 10:00 am AEDT · 30 min', 'Sat, 5 June, 10:00 am AEST · 30 min',
    ]) {
      expect(text).toContain(words);
    }
  });

  it('links each home with open times and each request to its listing', async () => {
    const view = await render(<TenantInspections />);

    expect(getByName(view, 'a', 'Garden studio').getAttribute('href')).toBe('/tenant/properties/pr-x');
    expect(textOf(view)).toContain('2 open times · Oscar Other');
    expect(getByName(view, 'a', 'Home a').getAttribute('href')).toBe('/tenant/properties/pr-a');
  });

  it('shows an error with a retry, and the empty states', async () => {
    mockInspections.myBookings.mockRejectedValueOnce(new ApiError(0, 'Could not connect. Check your connection and try again.'));
    mockInspections.homes.mockResolvedValue([]);
    const view = await render(<TenantInspections />);
    expect(textOf(view)).toContain('Could not connect.');

    mockInspections.myBookings.mockResolvedValue([]);
    await click(getByName(view, 'button', 'Try again'));

    expect(textOf(view)).toContain('No requests yet.');
    expect(textOf(view)).toContain('No listed home has an open inspection time right now.');
    expect(textOf(view)).toContain('No owner has scheduled an inspection with you.');
  });
});
