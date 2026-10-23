import { cleanup, click, dispatch, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { descendants, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { Repair } from '@/app/lib/repairs';
import OwnerMaintenancePage from './page';

const mockRepairs = vi.hoisted(() => ({
  list: vi.fn(), homes: vi.fn(), create: vi.fn(), uploadPhoto: vi.fn(), providers: vi.fn(), assign: vi.fn(), resolve: vi.fn(),
}));
vi.mock('@/app/lib/repairs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/repairs')>()),
  repairs: mockRepairs,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/owner/maintenance', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <span role="img" aria-label={alt} data-src={src} /> }));
vi.mock('@/app/components/owner/OwnerShell', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const repair: Repair = {
  id: 'r1', property_id: 'l1', tenant_id: 't1', owner_id: 'o1', provider_id: null, category: 'PLUMBING',
  category_label: 'Plumbing', priority: 'high', status: 'open', title: 'Burst pipe', description: 'Water through the ceiling.',
  photo_urls: [], access_notes: null, resolution_note: null, appointment_at: null, estimated_duration_minutes: null,
  appointment_note: null, completed_at: null, tenant_rating: null, logged_by_owner: false, can_confirm: false,
  can_rate: false, can_assign: true, can_resolve: true, created_at: '2030-01-10T00:00:00Z', updated_at: '2030-01-10T00:00:00Z',
  property_title: 'Harbour flat', property_address: '12 Harbour St', tenant_name: 'Jane Tenant', owner_name: 'Olivia Owner',
  provider_name: null,
};
const select = (root: FakeElement) => descendants(root).find((element) => element.tagName === 'SELECT') as FakeElement;

beforeEach(() => {
  vi.clearAllMocks();
  mockRepairs.list.mockResolvedValue([repair]);
  mockRepairs.homes.mockResolvedValue([]);
});
afterEach(cleanup);

describe('the owner repairs page', () => {
  it('assigns a provider from the ones who cover the repair', async () => {
    mockRepairs.providers.mockResolvedValue([
      { id: 'p1', name: "Pat's Plumbing", service_area: 'Wollongong', pricing_summary: 'From $90' },
      { id: 'p2', name: 'Leak Busters', service_area: null, pricing_summary: null },
    ]);
    mockRepairs.assign.mockResolvedValue({ ...repair, status: 'in_progress', provider_id: 'p2', provider_name: 'Leak Busters', can_assign: true });
    const view = await render(<OwnerMaintenancePage />);

    expect(textOf(view)).toContain('1 repair needs a provider.');
    await click(getByName(view, 'button', 'Assign a provider for Burst pipe'));
    const form = getByName(view, 'form', 'Assign a provider to Burst pipe');
    expect(mockRepairs.providers).toHaveBeenCalledWith('r1');
    expect(textOf(select(form))).toContain("Pat's Plumbing · Wollongong · From $90");
    select(form).value = 'p2';
    await dispatch(select(form), 'change');
    await dispatch(form, 'submit');

    expect(mockRepairs.assign).toHaveBeenCalledWith('r1', 'p2');
    expect(textOf(view)).toContain('Leak Busters has been assigned and told. They book the visit next.');
    expect(textOf(view)).toContain('Waiting for Leak Busters to book the visit.');
  });

  it('says so when no verified provider covers the repair', async () => {
    mockRepairs.providers.mockResolvedValue([]);
    const view = await render(<OwnerMaintenancePage />);

    await click(getByName(view, 'button', 'Assign a provider for Burst pipe'));

    expect(textOf(view)).toContain('No verified provider covers this category yet.');
    expect(mockRepairs.assign).not.toHaveBeenCalled();
  });

  it('shows why the shared function refused a provider', async () => {
    mockRepairs.providers.mockResolvedValue([{ id: 'p1', name: "Pat's Plumbing", service_area: null, pricing_summary: null }]);
    mockRepairs.assign.mockRejectedValue(new ApiError(403, 'Approved worker qualified for this maintenance category required'));
    const view = await render(<OwnerMaintenancePage />);

    await click(getByName(view, 'button', 'Assign a provider for Burst pipe'));
    await dispatch(getByName(view, 'form', 'Assign a provider to Burst pipe'), 'submit');

    expect(textOf(view)).toContain('Approved worker qualified for this maintenance category required');
  });

  it('marks a repair resolved with a note', async () => {
    mockRepairs.resolve.mockResolvedValue({ ...repair, status: 'resolved', can_assign: false, can_resolve: false, resolution_note: 'Fixed.' });
    const view = await render(<OwnerMaintenancePage />);

    await click(getByName(view, 'button', 'Mark Burst pipe resolved'));
    const form = getByName(view, 'form', 'Mark Burst pipe resolved');
    const note = descendants(form).find((element) => element.tagName === 'TEXTAREA') as FakeElement;
    note.value = 'Fixed.';
    await dispatch(note, 'input');
    await dispatch(form, 'submit');

    expect(mockRepairs.resolve).toHaveBeenCalledWith('r1', 'Fixed.');
    expect(textOf(view)).toContain('Marked resolved. The tenant has been told.');
    expect(textOf(view)).not.toContain('Assign a provider');
  });
});
