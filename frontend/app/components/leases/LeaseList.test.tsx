import { cleanup, click, descendants, dispatch, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { LeaseCandidate } from '@/app/lib/leases';
import { lease } from '@/app/test-utils/leases';
import { LeaseCandidates, LeaseList } from './LeaseList';

const mockLeases = vi.hoisted(() => ({ list: vi.fn(), candidates: vi.fn(), create: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/leases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/leases')>()),
  leasesApi: mockLeases,
}));

const CANDIDATE: LeaseCandidate = {
  application_id: 'app-1', listing_id: 'pr-1', title: 'Harbour flat', address: '12 Harbour Street, Wollongong NSW 2500',
  tenant: { id: 'tenant-1', name: 'Tanya Tenant' }, offer_weekly_rent: 640, move_in_date: '2026-11-15', bond_amount: 2600,
  lease_term_months: 12, approved_at: '2026-10-20T00:00:00Z',
};

const inputs = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'INPUT');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the owner leases page', () => {
  it("drafts an approved application's lease from its offer, move-in date and term", async () => {
    mockLeases.candidates.mockResolvedValue([CANDIDATE]);
    mockLeases.create.mockResolvedValue(lease({ id: 'lease-9', viewer_role: 'owner' }));
    const view = await render(<LeaseCandidates />);

    await click(getByName(view, 'button', 'Prepare the lease'));
    expect(inputs(view).map((input) => input.value)).toEqual(['640', '2026-11-15', '2026-11-15', '2027-11-14']);
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(mockLeases.create).toHaveBeenCalledWith({
      application_id: 'app-1', rent_amount: 640, rent_frequency: 'WEEKLY', start_date: '2026-11-15',
      first_due_date: '2026-11-15', end_date: '2027-11-14',
    });
    expect(router.push).toHaveBeenCalledWith('/owner/leases/lease-9');
  });

  it("shows the server's refusal and stays", async () => {
    mockLeases.candidates.mockResolvedValue([CANDIDATE]);
    mockLeases.create.mockRejectedValue(new ApiError(409, 'This application already has a lease.'));
    const view = await render(<LeaseCandidates />);

    await click(getByName(view, 'button', 'Prepare the lease'));
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(textOf(view)).toContain('This application already has a lease.');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('says when no approved application waits for a lease', async () => {
    mockLeases.candidates.mockResolvedValue([]);

    expect(textOf(await render(<LeaseCandidates />))).toContain('No approved application is waiting for a lease.');
  });
});

describe('a list of leases', () => {
  it("opens each lease from the viewer's own pages, naming the other party", async () => {
    mockLeases.list.mockResolvedValue([lease({ viewer_role: 'owner', stage: 'tenant_signed' })]);

    const view = await render(<LeaseList role="owner" />);

    expect(textOf(view)).toContain('Signed by the tenant: your signature next');
    expect(textOf(view)).toContain('Tenant: Tanya Tenant');
    expect(getByName(view, 'a', 'Open the lease').getAttribute('href')).toBe('/owner/leases/lease-1');
  });

  it('offers to try again when the list fails', async () => {
    mockLeases.list.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'))
      .mockResolvedValueOnce([]);
    const view = await render(<LeaseList role="tenant" />);

    expect(textOf(view)).toContain('The service is temporarily unavailable.');
    await click(getByName(view, 'button', 'Try again'));

    expect(textOf(view)).toContain('No lease yet');
  });
});
