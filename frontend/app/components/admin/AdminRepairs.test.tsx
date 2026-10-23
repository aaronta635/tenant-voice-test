import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminRepair, RepairPage } from '@/app/lib/admin-repairs-api';
import { ApiError } from '@/app/lib/api';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import AdminRepairs from './AdminRepairs';

const mocks = vi.hoisted(() => ({ list: vi.fn(), decide: vi.fn() }));
vi.mock('@/app/lib/admin-repairs-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-repairs-api')>()),
  adminRepairsApi: { list: mocks.list, decide: mocks.decide },
}));
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => '/admin/repairs',
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

const ADA = { id: 'ada', full_name: 'Ada Admin', role: 'admin' };

function repair(id: string, over: Partial<AdminRepair> = {}): AdminRepair {
  return {
    id, title: `Repair ${id}`, description: 'Water under the sink.', category: 'plumbing', priority: 'normal', status: 'open',
    work_status: 'OPEN', property_title: 'Harbour flat', area: 'Wollongong, NSW',
    tenant: { id: 'tia', full_name: 'Tia Nguyen', role: 'tenant' }, owner: { id: 'oliver', full_name: 'Oliver Grant', role: 'landlord' },
    provider: null, appointment_at: null, resolution_note: null, created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z', resolved_at: null, actions: ['cancel', 'close'], last_decision: null, ...over,
  };
}

const pipe = repair('r1', { title: 'Burst pipe', priority: 'urgent' });
const heater = repair('r2', {
  title: 'Broken heater', status: 'in_progress', work_status: 'SCHEDULED', appointment_at: '2026-10-10T23:00:00Z',
  provider: { id: 'pat', full_name: 'Pat Plumber', role: 'service_provider' },
});
const tile = repair('r3', {
  title: 'Loose tile', status: 'cancelled', work_status: 'CANCELLED', actions: [], resolution_note: 'Reported twice.',
  last_decision: { decision: 'cancelled', reason: 'Reported twice.', actor: ADA, created_at: '2026-10-05T00:00:00Z' },
});

function pageOf(items: AdminRepair[], total = items.length): RepairPage {
  return { items, total, limit: 20, offset: 0 };
}

let leavePage = () => {};
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/admin/repairs${search}`);
  leavePage = navigation.page.install(window);
}

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};
const openDialog = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open'))!;
const formIn = (element: FakeElement) => descendants(element).find((item) => item.tagName === 'FORM')!;
const row = (view: FakeElement, title: string) =>
  descendants(view).find((element) => element.tagName === 'LI' && textOf(element).startsWith(title))!;
const buttons = (element: FakeElement) => descendants(element).filter((item) => item.tagName === 'BUTTON').map(textOf);

beforeEach(() => {
  vi.clearAllMocks();
  openPage();
  mocks.list.mockResolvedValue(pageOf([pipe, heater, tile]));
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

describe('the admin repairs', () => {
  it('show each repair with its place, people, visit, last decision and the actions it allows', async () => {
    const view = await render(<AdminRepairs />);

    expect(mocks.list).toHaveBeenCalledWith({ status: '', priority: '', q: '', page: 1 });
    expect(textOf(row(view, 'Burst pipe'))).toContain('Harbour flat, Wollongong, NSW');
    expect(textOf(row(view, 'Burst pipe'))).toContain('Urgent priority');
    expect(textOf(row(view, 'Burst pipe'))).toContain('Provider not assigned');
    expect(getByName(row(view, 'Burst pipe'), 'a', 'Tia Nguyen').getAttribute('href')).toBe('/admin/users/tia');
    expect(getByName(row(view, 'Broken heater'), 'a', 'Pat Plumber').getAttribute('href')).toBe('/admin/users/pat');
    expect(textOf(row(view, 'Broken heater'))).toContain('In progress');
    expect(textOf(row(view, 'Broken heater'))).toMatch(/Visit .*11 Oct/);
    expect(buttons(row(view, 'Burst pipe'))).toEqual(['Close repair Burst pipe', 'Cancel repair Burst pipe']);
    expect(buttons(row(view, 'Loose tile'))).toEqual([]);
    expect(textOf(row(view, 'Loose tile'))).toContain('Cancelled by Ada Admin on 5 Oct 2026: Reported twice.');
    // The decision's reason is the repair's note too: said once.
    expect(textOf(row(view, 'Loose tile'))).not.toContain('Note:');
  });

  it('write the filters to the URL', async () => {
    const view = await render(<AdminRepairs />);

    const status = field(view, 'Status') as FakeElement;
    status.value = 'in_progress';
    await dispatch(status, 'change');
    const priority = field(view, 'Priority') as FakeElement;
    priority.value = 'urgent';
    await dispatch(priority, 'change');
    await typeInto(field(view, 'Title or description') as FakeElement, ' heater ');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');
    await act(async () => { navigation.page.land(); });
    await settle();

    expect(navigation.page.location.search).toBe('?status=in_progress&priority=urgent&q=heater');
    expect(mocks.list).toHaveBeenLastCalledWith({ status: 'in_progress', priority: 'urgent', q: 'heater', page: 1 });
  });

  it('cancel a repair with the reason its people are told', async () => {
    mocks.decide.mockResolvedValue({
      ...heater, status: 'cancelled', work_status: 'CANCELLED', actions: [], resolution_note: 'The tenant moved out.',
      last_decision: { decision: 'cancelled', reason: 'The tenant moved out.', actor: ADA, created_at: '2026-10-06T00:00:00Z' },
    });
    const view = await render(<AdminRepairs />);

    await click(getByName(view, 'button', 'Cancel repair Broken heater'));
    const dialog = openDialog(view);
    expect(textOf(dialog)).toContain('Cancel “Broken heater”');
    expect(textOf(dialog)).toContain('Its tenant, owner and assigned provider are told why.');
    await dispatch(formIn(dialog), 'submit');
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(textOf(dialog)).toContain('Give a reason. It is kept with the decision.');
    await typeInto(field(dialog, 'Reason') as FakeElement, 'The tenant moved out.');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.decide).toHaveBeenCalledWith(heater, 'cancel', 'The tenant moved out.');
    expect(textOf(view)).toContain('“Broken heater” was cancelled. Its tenant, owner and provider were told why.');
    expect(textOf(row(view, 'Broken heater'))).toContain('Cancelled by Ada Admin');
    expect(buttons(row(view, 'Broken heater'))).toEqual([]);
  });

  it('close a repair, and reload the list when it changed meanwhile', async () => {
    mocks.decide.mockRejectedValueOnce(new ApiError(409, 'This repair changed while you were looking at it. Reload the list and try again.'));
    const view = await render(<AdminRepairs />);

    await click(getByName(view, 'button', 'Close repair Burst pipe'));
    const dialog = openDialog(view);
    expect(textOf(dialog)).toContain('The repair is over');
    await typeInto(field(dialog, 'Reason') as FakeElement, 'Fixed by the owner.');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.decide).toHaveBeenCalledWith(pipe, 'close', 'Fixed by the owner.');
    expect(textOf(dialog)).toContain('This repair changed while you were looking at it.');
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it('say when nothing matches, and offer a retry when the repairs cannot load', async () => {
    mocks.list.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    mocks.list.mockResolvedValueOnce(pageOf([]));
    const view = await render(<AdminRepairs />);

    expect(textOf(view)).toContain("Couldn't load the repairs");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('No repairs found');
    expect(textOf(view)).toContain('No tenant has asked for a repair yet.');
  });

  it('offer to clear filters that match nothing', async () => {
    openPage('?status=cancelled&q=roof');
    mocks.list.mockResolvedValue(pageOf([]));
    const view = await render(<AdminRepairs />);

    expect(textOf(view)).toContain('Try another status, priority or search.');
    await click(getByName(view, 'button', 'Clear the filters'));
    await act(async () => { navigation.page.land(); });
    expect(navigation.page.location.search).toBe('');
  });

  it('keep the list at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminRepairs />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });

  it("wrap a party shown by a long email rather than widening a phone's screen", async () => {
    // With no name, a party is shown by their email (admin_repairs._party), which has no break in it.
    const email = 'bartholomew.featherstonehaugh@example.test';
    mocks.list.mockResolvedValue(pageOf([repair('r4', { title: 'Leaking roof', tenant: { id: 'bart', full_name: email, role: 'tenant' } })]));
    const view = await render(<AdminRepairs />);

    const tenant = descendants(row(view, 'Leaking roof')).find((element) => element.tagName === 'SPAN' && textOf(element) === `Tenant ${email}`)!;
    expect(tenant.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'break-words']));
    expect(getByName(view, 'a', email).getAttribute('href')).toBe('/admin/users/bart');
  });
});
