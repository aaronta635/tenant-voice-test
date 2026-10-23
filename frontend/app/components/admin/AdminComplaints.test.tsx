import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminComplaint, AdminComplaintPage } from '@/app/lib/admin-complaints-api';
import { ApiError } from '@/app/lib/api';
import { adminComplaint } from '@/app/test-utils/admin-moderation';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import AdminComplaints from './AdminComplaints';

const mocks = vi.hoisted(() => ({ list: vi.fn(), categories: vi.fn(), assignees: vi.fn() }));
vi.mock('@/app/lib/admin-complaints-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-complaints-api')>()),
  adminComplaintsApi: { list: mocks.list, assignees: mocks.assignees },
}));
vi.mock('@/app/lib/complaint-categories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/complaint-categories')>()),
  complaintCategoriesApi: { list: mocks.categories },
}));
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => '/admin/complaints',
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

const ADMIN = 'a3000000-0000-4000-8000-000000000002';

function results(items: AdminComplaint[], total = items.length): AdminComplaintPage {
  return { items, total, limit: 20, offset: 0 };
}

let leavePage = () => {};
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/admin/complaints${search}`);
  leavePage = navigation.page.install(window);
}

async function land() {
  await act(async () => { navigation.page.land(); });
  await settle();
}

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};
const row = (view: FakeElement, subject: string) =>
  descendants(view).find((element) => element.tagName === 'LI' && textOf(element).startsWith(subject))!;

beforeEach(() => {
  vi.clearAllMocks();
  openPage();
  mocks.list.mockResolvedValue(results([
    adminComplaint('c1'),
    adminComplaint('c2', {
      status: 'ESCALATED', category: 'maintenance', category_label: 'Maintenance', category_active: false, severity: 'HIGH',
      assignee: { id: ADMIN, full_name: 'Otto Admin', role: 'admin' },
    }),
    adminComplaint('c3', { status: 'CLOSED', withdrawn: true }),
  ]));
  mocks.categories.mockResolvedValue([
    { code: 'PROPERTY_CONDITION', name: 'Property condition', description: '' },
    { code: 'SAFETY', name: 'Safety', description: '' },
  ]);
  mocks.assignees.mockResolvedValue([{ id: ADMIN, full_name: 'Otto Admin', email: 'otto@example.test' }]);
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

describe('the admin complaints list', () => {
  it('loads the complaints the URL asks for', async () => {
    openPage(`?status=ESCALATED&category=SAFETY&assignee=${ADMIN}&q=heater&page=2`);
    mocks.list.mockResolvedValue(results([adminComplaint('c9')], 21));

    const view = await render(<AdminComplaints />);

    expect(mocks.list).toHaveBeenCalledWith({ status: 'ESCALATED', category: 'SAFETY', assignee: ADMIN, q: 'heater', page: 2 });
    expect(textOf(view)).toContain('21 complaints');
    expect(textOf(view)).toContain('Showing 21–21 of 21');
    expect((field(view, 'Category') as FakeElement).value).toBe('SAFETY');
    expect((field(view, 'Handled by') as FakeElement).value).toBe(ADMIN);
  });

  it('shows each complaint with its status, category and who handles it', async () => {
    const view = await render(<AdminComplaints />);

    const escalated = row(view, 'Complaint c2');
    expect(getByName(escalated, 'a', 'Complaint c2').getAttribute('href')).toBe('/admin/complaints/c2');
    expect(textOf(escalated)).toContain('Escalated');
    expect(textOf(escalated)).toContain('Maintenance (older category)');
    expect(textOf(escalated)).toContain('High severity');
    expect(textOf(escalated)).toContain('Handled by Otto Admin');
    expect(textOf(row(view, 'Complaint c1'))).toContain('Unassigned');
    expect(textOf(row(view, 'Complaint c1'))).toContain('Tia Nguyen about Harbour flat');
    expect(textOf(row(view, 'Complaint c3'))).toContain('Withdrawn');
    // The filters offer the fixed complaint categories.
    const categories = (field(view, 'Category') as FakeElement).options.map(textOf);
    expect(categories).toEqual(['All', 'Property condition', 'Safety']);
    expect((field(view, 'Handled by') as FakeElement).options.map(textOf)).toEqual(['Anyone', 'Assigned to me', 'Unassigned', 'Otto Admin']);
  });

  it('writes each filter to the URL and loads that page', async () => {
    const view = await render(<AdminComplaints />);
    const status = field(view, 'Status') as FakeElement;

    status.value = 'IN_REVIEW';
    await dispatch(status, 'change');
    expect(navigation.page.stack()).toEqual(['/admin/complaints', '>/admin/complaints?status=IN_REVIEW']);
    await land();
    expect(mocks.list).toHaveBeenLastCalledWith({ status: 'IN_REVIEW', category: '', assignee: '', q: '', page: 1 });

    const handledBy = field(view, 'Handled by') as FakeElement;
    handledBy.value = 'unassigned';
    await dispatch(handledBy, 'change');
    await typeInto(field(view, 'Subject or description') as FakeElement, '  mould  ');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');
    await land();
    expect(navigation.page.location.search).toBe('?status=IN_REVIEW&assignee=unassigned&q=mould');
    expect(mocks.list).toHaveBeenLastCalledWith({ status: 'IN_REVIEW', category: '', assignee: 'unassigned', q: 'mould', page: 1 });
  });

  it('says when nothing matches, with a way to clear the filters', async () => {
    openPage('?status=RESOLVED');
    mocks.list.mockResolvedValue(results([]));
    const view = await render(<AdminComplaints />);

    expect(textOf(view)).toContain('No complaints found');
    await click(getByName(view, 'button', 'Clear the filters'));
    expect(navigation.page.location.search).toBe('');
  });

  it('offers a retry when the complaints cannot load', async () => {
    mocks.list.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<AdminComplaints />);

    expect(textOf(view)).toContain("Couldn't load the complaints");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Complaint c1');
  });

  it('keeps the list at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminComplaints />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
