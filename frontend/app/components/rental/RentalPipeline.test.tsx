import { cleanup, click, descendants, dispatch, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application, Property } from '@/app/lib/api';
import { lease } from '@/app/test-utils/leases';
import RentalPipeline from './RentalPipeline';

const mockApi = vi.hoisted(() => ({
  properties: { listPublic: vi.fn() },
  applications: { listMine: vi.fn(), create: vi.fn() },
  profiles: { me: vi.fn() },
  conversations: { startRental: vi.fn() },
}));
const profiles = vi.hoisted(() => ({ getMyProfile: vi.fn() }));
const documents = vi.hoisted(() => ({ checklist: vi.fn() }));
const inspections = vi.hoisted(() => ({ openSlots: vi.fn(), myBookings: vi.fn(), book: vi.fn(), publicSlots: vi.fn() }));
const leases = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/app/lib/api')>()), api: mockApi }));
vi.mock('@/app/lib/my-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/my-profile')>()),
  getMyProfile: profiles.getMyProfile,
}));
vi.mock('@/app/lib/profile-documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/profile-documents')>()),
  documentsApi: documents,
}));
vi.mock('@/app/lib/inspections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/inspections')>()),
  inspectionsApi: inspections,
}));
vi.mock('@/app/lib/leases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/leases')>()),
  leasesApi: leases,
}));

const listing = {
  id: 'pr-1', title: 'Harbour flat', address: 'Wollongong, NSW 2500', suburb: 'Wollongong', state: 'NSW', postcode: '2500',
  price: 650, bond: 2600, photo_urls: [], available_from: null, lease_term: '12 months', status: 'available',
} as unknown as Property;

function application(over: Partial<Application>): Application {
  return {
    id: 'app-1', property_id: 'pr-1', tenant_id: 'me', status: 'new', stage: 'submitted', shortlisted: false,
    created_at: '2026-10-01T00:00:00Z', history: [], ...over,
  } as Application;
}

const step = (view: FakeElement, name: string) => getByName(view, 'button', new RegExp(`^(?:\\d|✓)${name}(?:done|current|next)$`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockApi.properties.listPublic.mockResolvedValue([listing]);
  inspections.openSlots.mockResolvedValue([]);
  inspections.myBookings.mockResolvedValue([]);
  mockApi.applications.listMine.mockResolvedValue([]);
  mockApi.profiles.me.mockResolvedValue({ id: 'me', full_name: 'Tanya Tenant' });
  profiles.getMyProfile.mockResolvedValue(null);
  documents.checklist.mockResolvedValue({ documents: [] });
  leases.list.mockResolvedValue([]);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('RentalPipeline applying', () => {
  it('applies through the shared form and moves on to the owner review', async () => {
    mockApi.applications.create.mockResolvedValue(application({}));
    const view = await render(<RentalPipeline />);

    await click(step(view, 'Submit application'));
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(mockApi.applications.create).toHaveBeenCalledWith(expect.objectContaining({ property_id: 'pr-1', rent_offered: 650 }));
    expect(textOf(view)).toContain('Application submitted to the owner.');
    expect(textOf(step(view, 'Owner review'))).toMatch(/current$/);
  });

  it('says where an application stands instead of applying again', async () => {
    mockApi.applications.listMine.mockResolvedValue([application({ status: 'reviewing', stage: 'shortlisted', shortlisted: true })]);
    const view = await render(<RentalPipeline />);

    await click(step(view, 'Submit application'));

    expect(textOf(view)).toContain('Application submitted 1 Oct 2026 — status: Shortlisted.');
    expect(descendants(view).filter((element) => element.tagName === 'FORM')).toEqual([]);
  });

  it("shows the owner's note on the review step", async () => {
    mockApi.applications.listMine.mockResolvedValue([application({
      status: 'declined', stage: 'declined',
      history: [{ from_stage: 'submitted', to_stage: 'declined', note: 'We chose a family.', by: 'landlord', created_at: '2026-10-02T00:00:00Z' }],
    })]);
    const view = await render(<RentalPipeline />);

    await click(step(view, 'Owner review'));

    expect(textOf(view)).toContain('Declined');
    expect(textOf(view)).toContain('From the owner: We chose a family.');
  });
});

describe('RentalPipeline booking an inspection', () => {
  const SLOT = {
    id: 'slot-1', property_id: 'pr-1', owner_id: 'owner-1', starts_at: '2027-11-05T23:00:00Z', duration_minutes: 30,
    status: 'open', property_title: 'Harbour flat', address: null, created_at: null, updated_at: null,
  };

  it("books one of the owner's times through the booking call, never a chat message", async () => {
    inspections.openSlots.mockResolvedValue([SLOT]);
    inspections.book.mockResolvedValue({
      ...SLOT, id: 'bk-1', slot_id: 'slot-1', tenant_id: 'me', status: 'pending', note: null, slot_status: 'held',
      tenant_name: 'Tanya Tenant', owner_name: 'Olivia Owner',
    });
    const view = await render(<RentalPipeline />);

    await click(step(view, 'Book inspection'));
    expect(inspections.openSlots).toHaveBeenCalledWith('pr-1');
    expect(textOf(view)).toContain('Sat, 6 Nov, 10:00 am AEDT · 30 min');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(inspections.book).toHaveBeenCalledWith('slot-1', null);
    expect(mockApi.conversations.startRental).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Waiting for the owner');
  });

  it('says when the owner has published no times, with no step button that only messages', async () => {
    const view = await render(<RentalPipeline />);

    await click(step(view, 'Book inspection'));

    expect(textOf(view)).toContain('No inspection times published yet — message the landlord to arrange one.');
    expect(descendants(view).filter((element) => element.tagName === 'BUTTON' && /Book an inspection/.test(textOf(element)))).toEqual([]);
  });
});

describe('RentalPipeline lease and move-in', () => {
  const approved = () => application({ status: 'approved', stage: 'approved' });
  const NONE = { send_document: false, confirm: false, sign: false, owner_sign: false, activate: false };

  it('waits at the lease until the owner sends one', async () => {
    mockApi.applications.listMine.mockResolvedValue([approved()]);

    const view = await render(<RentalPipeline />);

    expect(textOf(step(view, 'Lease agreement'))).toMatch(/current$/);
    expect(textOf(view)).toContain('Your owner drafts the lease next, and it appears here when they send it.');
    expect(descendants(view).filter((element) => element.tagName === 'BUTTON' && /Review the lease|Accept lease terms/.test(textOf(element)))).toEqual([]);
  });

  it("shows the lease's own state and links to it", async () => {
    mockApi.applications.listMine.mockResolvedValue([approved()]);
    leases.list.mockResolvedValue([lease({ application_id: 'other-app', id: 'lease-0' }), lease()]);

    const view = await render(<RentalPipeline />);

    expect(textOf(view)).toContain('Ready for you to review');
    expect(textOf(view)).toContain('$650 a week');
    expect(getByName(view, 'a', 'Review the lease').getAttribute('href')).toBe('/tenant/leases/lease-1');
    // Moving in waits for the active lease.
    await click(step(view, 'Move in'));
    expect(textOf(view)).toContain('Moving in opens once you and your owner have both signed the lease');
  });

  it('does not move on when both signed but the owner has not activated it', async () => {
    mockApi.applications.listMine.mockResolvedValue([approved()]);
    leases.list.mockResolvedValue([lease({ stage: 'signed', actions: NONE })]);

    const view = await render(<RentalPipeline />);

    expect(textOf(step(view, 'Lease agreement'))).toMatch(/current$/);
    expect(getByName(view, 'a', 'View the lease')).toBeTruthy();
  });

  it('moves to moving in once the lease is active', async () => {
    mockApi.applications.listMine.mockResolvedValue([approved()]);
    leases.list.mockResolvedValue([lease({ stage: 'active', status: 'active', actions: NONE })]);

    const view = await render(<RentalPipeline />);

    expect(textOf(step(view, 'Lease agreement'))).toMatch(/done$/);
    expect(textOf(step(view, 'Move in'))).toMatch(/current$/);
    expect(textOf(view)).toContain('Your lease is active from 15 Nov 2026.');
    expect(textOf(view)).toContain('Your first rent payment of $650 a week is due 15 Nov 2026.');
  });

  it('reads no lease before the application is approved', async () => {
    mockApi.applications.listMine.mockResolvedValue([application({ status: 'reviewing', stage: 'under_review' })]);

    const view = await render(<RentalPipeline />);
    await click(step(view, 'Lease agreement'));

    expect(leases.list).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Your lease comes once the owner approves your application.');
  });
});
