import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUser, AdminUserDetail, AdminUserPage } from '@/app/lib/admin-api';
import { ApiError } from '@/app/lib/api';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import AdminUsers from './AdminUsers';
import { statusChoices } from './UserStatusDialog';

const mocks = vi.hoisted(() => ({ users: vi.fn(), setStatus: vi.fn() }));
vi.mock('@/app/lib/admin-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-api')>()),
  adminApi: { users: mocks.users, setStatus: mocks.setStatus },
}));
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => '/admin/users',
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

function account(id: string, over: Partial<AdminUser> = {}): AdminUser {
  return {
    id, full_name: `Member ${id}`, email: `${id}@example.test`, role: 'tenant', primary_role: 'TENANT', status: 'ACTIVE',
    verification_status: 'PENDING', created_at: '2026-10-01T00:00:00Z', pending_documents: 0, ...over,
  };
}

function results(items: AdminUser[], total = items.length): AdminUserPage {
  return { items, total, limit: 25, offset: 0 };
}

function detail(user: AdminUser, over: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return {
    ...user, phone: null, updated_at: null, closed_at: null, roles: [], documents: [], status_history: [], status_locked: null,
    verification: { status: 'pending', rejection_reason: null, approved_at: null, account_rejected: false },
    ...over,
  };
}

let leavePage = () => {};
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/admin/users${search}`);
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
/** The status dialog's form; the test DOM submits a form only when told to. */
const dialogForm = (view: FakeElement) =>
  descendants(view).find((element) => element.tagName === 'FORM' && textOf(element).includes('New status'))!;
const row = (view: FakeElement, name: string) =>
  descendants(view).find((element) => element.tagName === 'LI' && textOf(element).startsWith(name))!;

beforeEach(() => {
  vi.clearAllMocks();
  openPage();
  mocks.users.mockResolvedValue(results([
    account('mia'), account('pat', { role: 'service_provider', status: 'SUSPENDED', pending_documents: 2 }),
    account('ada', { role: 'admin', full_name: 'Ada Admin' }),
  ]));
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

describe('the users list', () => {
  it('loads the accounts the URL asks for', async () => {
    openPage('?role=landlord&status=SUSPENDED&q=leo&page=2');
    mocks.users.mockResolvedValue(results([account('leo', { role: 'landlord', status: 'SUSPENDED' })], 26));

    const view = await render(<AdminUsers />);

    expect(mocks.users).toHaveBeenCalledWith({ role: 'landlord', status: 'SUSPENDED', q: 'leo', page: 2 });
    expect(textOf(view)).toContain('26 accounts');
    expect(textOf(view)).toContain('Showing 26–26 of 26');
    expect((field(view, 'Name or email') as FakeElement).value).toBe('leo');
  });

  it('shows each account with its role, status and documents in review', async () => {
    const view = await render(<AdminUsers />);

    const pat = row(view, 'Member pat');
    expect(textOf(pat)).toContain('Service provider');
    expect(textOf(pat)).toContain('Suspended');
    expect(textOf(pat)).toContain('2 in review');
    expect(getByName(pat, 'a', 'Member pat').getAttribute('href')).toBe('/admin/users/pat');
    // Staff accounts are the TenantVoice team's: no status button.
    expect(textOf(row(view, 'Ada Admin'))).toContain('Staff account');
    expect(descendants(row(view, 'Ada Admin')).some((element) => element.tagName === 'BUTTON')).toBe(false);
  });

  it('writes each filter to the URL and loads that page', async () => {
    const view = await render(<AdminUsers />);
    const role = field(view, 'Role') as FakeElement;

    role.value = 'service_provider';
    await dispatch(role, 'change');
    expect(navigation.page.stack()).toEqual(['/admin/users', '>/admin/users?role=service_provider']);
    await land();
    expect(mocks.users).toHaveBeenLastCalledWith({ role: 'service_provider', status: '', q: '', page: 1 });

    await typeInto(field(view, 'Name or email') as FakeElement, '  pat  ');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');
    await land();
    expect(navigation.page.location.search).toBe('?role=service_provider&q=pat');
    expect(mocks.users).toHaveBeenLastCalledWith({ role: 'service_provider', status: '', q: 'pat', page: 1 });
  });

  it('pages through the accounts', async () => {
    mocks.users.mockResolvedValue(results([account('mia')], 60));
    const view = await render(<AdminUsers />);

    await click(getByName(view, 'a', 'Next page'));
    await land();

    expect(navigation.page.location.search).toBe('?page=2');
    expect(mocks.users).toHaveBeenLastCalledWith({ role: '', status: '', q: '', page: 2 });
  });

  it('says when nothing matches, with a way to clear the filters', async () => {
    openPage('?status=DEACTIVATED');
    mocks.users.mockResolvedValue(results([]));
    const view = await render(<AdminUsers />);

    expect(textOf(view)).toContain('No accounts found');
    await click(getByName(view, 'button', 'Clear the filters'));
    expect(navigation.page.location.search).toBe('');
  });

  it('offers a retry when the accounts cannot load', async () => {
    mocks.users.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<AdminUsers />);

    expect(textOf(view)).toContain("Couldn't load the accounts");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Member mia');
  });

  it('keeps the list at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminUsers />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe('changing an account\'s status', () => {
  it('needs a reason to suspend, then saves it and shows the new status', async () => {
    mocks.setStatus.mockResolvedValue(detail(account('mia', { status: 'SUSPENDED' })));
    const view = await render(<AdminUsers />);

    await click(getByName(view, 'button', 'Change status of Member mia'));
    expect(textOf(view)).toContain("Change Member mia's account status");
    const form = dialogForm(view);
    await dispatch(form, 'submit');

    expect(mocks.setStatus).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Give a reason for suspending or deactivating an account.');
    const reason = field(view, 'Reason') as FakeElement;
    expect(reason.getAttribute('aria-invalid')).toBe('true');

    await typeInto(reason, 'Repeated harassment reports');
    await dispatch(form, 'submit');

    expect(mocks.setStatus).toHaveBeenCalledWith('mia', 'SUSPENDED', 'Repeated harassment reports');
    expect(textOf(row(view, 'Member mia'))).toContain('Suspended');
    expect(textOf(view)).toContain('Member mia is now suspended.');
  });

  it('reactivates without a reason', async () => {
    mocks.setStatus.mockResolvedValue(detail(account('pat', { status: 'ACTIVE' })));
    const view = await render(<AdminUsers />);

    await click(getByName(view, 'button', 'Change status of Member pat'));
    expect((field(view, 'New status') as FakeElement).value).toBe('ACTIVE');
    expect(textOf(view)).toContain('Reason (optional)');
    expect(getByName(view, 'button', 'Reactivate account').getAttribute('type')).toBe('submit');
    await dispatch(dialogForm(view), 'submit');

    expect(mocks.setStatus).toHaveBeenCalledWith('pat', 'ACTIVE', '');
  });

  it('keeps the dialog open with the server\'s reason when it refuses', async () => {
    mocks.setStatus.mockRejectedValue(new ApiError(409, 'This account changed while you were looking at it. Reload it and try again.'));
    const view = await render(<AdminUsers />);

    await click(getByName(view, 'button', 'Change status of Member mia'));
    const status = field(view, 'New status') as FakeElement;
    status.value = 'DEACTIVATED';
    await dispatch(status, 'change');
    await typeInto(field(view, 'Reason') as FakeElement, 'Asked to close');
    expect(getByName(view, 'button', 'Deactivate account').getAttribute('type')).toBe('submit');
    await dispatch(dialogForm(view), 'submit');

    expect(mocks.setStatus).toHaveBeenCalledWith('mia', 'DEACTIVATED', 'Asked to close');
    expect(textOf(view)).toContain('This account changed while you were looking at it.');
    expect(textOf(row(view, 'Member mia'))).toContain('Active');
  });

  it('offers only the statuses an account can move to', () => {
    expect(statusChoices('ACTIVE')).toEqual(['SUSPENDED', 'DEACTIVATED']);
    expect(statusChoices('SUSPENDED')).toEqual(['ACTIVE', 'DEACTIVATED']);
    expect(statusChoices('DEACTIVATED')).toEqual(['ACTIVE', 'SUSPENDED']);
    expect(statusChoices('PENDING_VERIFICATION')).toEqual(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']);
  });
});
