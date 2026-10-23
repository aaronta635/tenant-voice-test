import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { Repair, RepairHome } from '@/app/lib/repairs';
import TenantMaintenancePage from './page';

const mockRepairs = vi.hoisted(() => ({
  list: vi.fn(), homes: vi.fn(), create: vi.fn(), uploadPhoto: vi.fn(), confirm: vi.fn(), rate: vi.fn(),
}));
vi.mock('@/app/lib/repairs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/repairs')>()),
  repairs: mockRepairs,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/tenant/maintenance', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <span role="img" aria-label={alt} data-src={src} /> }));
vi.mock('@/app/components/tenant/TenantShell', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const home: RepairHome = {
  listing_id: 'l1', property_id: 'p1', title: 'Harbour flat', address: '12 Harbour St, Wollongong, NSW, 2500',
  owner_name: 'Olivia Owner', tenant_name: null,
};
const repair: Repair = {
  id: 'r1', property_id: 'l1', tenant_id: 't1', owner_id: 'o1', provider_id: 'p1', category: 'PLUMBING',
  category_label: 'Plumbing', priority: 'urgent', status: 'awaiting_confirmation', title: 'Burst pipe',
  description: 'Water through the ceiling.', photo_urls: ['https://storage.example/sign/repair-photos/t1/a.png?token=1'],
  access_notes: null, resolution_note: 'Replaced the pipe.', appointment_at: '2030-01-19T22:30:00Z',
  estimated_duration_minutes: 60, appointment_note: null, completed_at: '2030-01-20T01:00:00Z', tenant_rating: null,
  logged_by_owner: false, can_confirm: true, can_rate: false, can_assign: false, can_resolve: false,
  created_at: '2030-01-10T00:00:00Z', updated_at: '2030-01-20T01:00:00Z', property_title: 'Harbour flat',
  property_address: '12 Harbour St', tenant_name: 'Jane Tenant', owner_name: 'Olivia Owner', provider_name: "Pat's Plumbing",
};
const field = (view: FakeElement, placeholder: string) =>
  descendants(view).find((element) => element.getAttribute('placeholder') === placeholder) as FakeElement;
const form = (view: FakeElement, name: string) => getByName(view, 'form', name);

beforeEach(() => {
  vi.clearAllMocks();
  mockRepairs.list.mockResolvedValue([repair]);
  mockRepairs.homes.mockResolvedValue([home]);
});
afterEach(cleanup);

describe('the tenant repairs page', () => {
  it('says it is loading, then offers a retry when the repairs cannot be loaded', async () => {
    mockRepairs.list.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<TenantMaintenancePage />);

    expect(textOf(view)).toContain('Repairs could not be loaded');
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Burst pipe');
  });

  it('confirms the finished work with a rating', async () => {
    mockRepairs.confirm.mockResolvedValue({ ...repair, status: 'resolved', tenant_rating: 5, can_confirm: false });
    const view = await render(<TenantMaintenancePage />);

    expect(textOf(view)).toContain('The provider marked it done. Confirm it with a rating.');
    await dispatch(form(view, 'Confirm and rate'), 'submit');
    expect(mockRepairs.confirm).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Choose a rating from 1 to 5.');

    await click(getByName(view, 'button', '5 out of 5'));
    await dispatch(form(view, 'Confirm and rate'), 'submit');

    expect(mockRepairs.confirm).toHaveBeenCalledWith('r1', 5);
    expect(textOf(view)).toContain('Resolved. Rated 5 out of 5.');
    expect(descendants(view).some((element) => element.tagName === 'FORM' && element.getAttribute('aria-label') === 'Confirm and rate')).toBe(false);
  });

  it('rates a repair the owner resolved, and shows the function\'s refusal', async () => {
    mockRepairs.list.mockResolvedValue([{ ...repair, status: 'resolved', can_confirm: false, can_rate: true }]);
    mockRepairs.rate.mockRejectedValue(new ApiError(422, 'This work order has already been rated'));
    const view = await render(<TenantMaintenancePage />);

    await click(getByName(view, 'button', '3 out of 5'));
    await dispatch(form(view, 'Rate this repair'), 'submit');

    expect(mockRepairs.rate).toHaveBeenCalledWith('r1', 3);
    expect(textOf(view)).toContain('This work order has already been rated');
  });

  it('reports a repair with its category, priority and photos, uploading each photo once', async () => {
    mockRepairs.list.mockResolvedValue([]);
    mockRepairs.uploadPhoto.mockResolvedValue({ path: 't1/abc.png', url: null });
    mockRepairs.create.mockRejectedValueOnce(new ApiError(503, 'Try again.')).mockResolvedValue({ ...repair, id: 'r2', status: 'open' });
    const view = await render(<TenantMaintenancePage />);
    const report = form(view, 'Report a repair');

    await typeInto(field(view, 'e.g. Burst pipe under the kitchen sink'), 'Burst pipe');
    const [description] = descendants(report).filter((element) => element.tagName === 'TEXTAREA');
    await typeInto(description, 'Water through the ceiling.');
    const [, category, priority] = descendants(report).filter((element) => element.tagName === 'SELECT');
    category.value = 'LEAK';
    await dispatch(category, 'change');
    priority.value = 'high';
    await dispatch(priority, 'change');
    const photos = descendants(report).find((element) => element.tagName === 'INPUT' && element.getAttribute('accept') !== null) as FakeElement;
    Object.defineProperty(photos, 'files', { value: [new File(['x'], 'ceiling.png', { type: 'image/png' })], configurable: true });
    await dispatch(photos, 'change');

    await dispatch(report, 'submit');
    expect(textOf(view)).toContain('Try again.');
    await dispatch(report, 'submit');

    expect(mockRepairs.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(mockRepairs.create).toHaveBeenLastCalledWith({
      property_id: 'l1', title: 'Burst pipe', description: 'Water through the ceiling.', category: 'LEAK',
      priority: 'high', photos: ['t1/abc.png'], access_notes: null,
    });
    expect(textOf(view)).toContain('Repair reported. Your landlord has been told.');
  });

  it('keeps a photo stored before a later one failed, so a retry does not store it again', async () => {
    mockRepairs.list.mockResolvedValue([]);
    mockRepairs.uploadPhoto
      .mockResolvedValueOnce({ path: 't1/first.png', url: null })
      .mockRejectedValueOnce(new ApiError(503, 'Storage is busy.'))
      .mockResolvedValueOnce({ path: 't1/second.png', url: null });
    mockRepairs.create.mockResolvedValue({ ...repair, id: 'r2', status: 'open' });
    const view = await render(<TenantMaintenancePage />);
    const report = form(view, 'Report a repair');
    await typeInto(field(view, 'e.g. Burst pipe under the kitchen sink'), 'Burst pipe');
    const [description] = descendants(report).filter((element) => element.tagName === 'TEXTAREA');
    await typeInto(description, 'Water through the ceiling.');
    const photos = descendants(report).find((element) => element.tagName === 'INPUT' && element.getAttribute('accept') !== null) as FakeElement;
    Object.defineProperty(photos, 'files', {
      value: [new File(['x'], 'first.png', { type: 'image/png' }), new File(['y'], 'second.png', { type: 'image/png' })],
      configurable: true,
    });
    await dispatch(photos, 'change');

    await dispatch(report, 'submit');
    expect(textOf(view)).toContain('Storage is busy.');
    await dispatch(report, 'submit');

    expect(mockRepairs.uploadPhoto.mock.calls.map(([file]) => (file as File).name)).toEqual(['first.png', 'second.png', 'second.png']);
    expect(mockRepairs.create).toHaveBeenCalledTimes(1);
    expect(mockRepairs.create.mock.calls[0][0].photos).toEqual(['t1/first.png', 't1/second.png']);
  });

  it('says a repair can be reported once an application is approved', async () => {
    mockRepairs.homes.mockResolvedValue([]);
    mockRepairs.list.mockResolvedValue([]);
    const view = await render(<TenantMaintenancePage />);

    expect(textOf(view)).toContain('You can report a repair once your application for a home is approved.');
    expect(textOf(view)).toContain('No repair requests yet.');
  });
});
