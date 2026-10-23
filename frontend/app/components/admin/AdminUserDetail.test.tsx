import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUserDetail as Detail } from '@/app/lib/admin-api';
import { ApiError } from '@/app/lib/api';
import AdminUserDetail from './AdminUserDetail';

const mocks = vi.hoisted(() => ({ user: vi.fn(), setStatus: vi.fn(), documentLink: vi.fn() }));
vi.mock('@/app/lib/admin-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-api')>()),
  adminApi: mocks,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

function detail(over: Partial<Detail> = {}): Detail {
  return {
    id: 'mia', full_name: 'Mia Member', email: 'mia@example.test', role: 'tenant', primary_role: 'TENANT', status: 'ACTIVE',
    verification_status: 'PENDING', created_at: '2026-10-01T00:00:00Z', pending_documents: 1, phone: '0400 000 000',
    updated_at: null, closed_at: null, roles: [{ role: 'tenant', is_primary: true }],
    documents: [{
      id: 'doc-1', document_type: 'PASSPORT', label: 'Passport', status: 'pending', rejection_reason: null,
      file_name: 'Passport.pdf', has_file: true, can_open: true, visibility: 'private', kind: null,
      submitted_at: '2026-10-20T00:00:00Z', verified_at: null,
    }],
    status_history: [{
      from_status: 'SUSPENDED', to_status: 'ACTIVE', reason: 'Appeal upheld', actor_id: 'ada', actor_name: 'Ada Admin',
      created_at: '2026-10-10T00:00:00Z',
    }],
    verification: { status: 'pending', rejection_reason: null, approved_at: null, account_rejected: false },
    status_locked: null,
    ...over,
  };
}

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue(detail());
});
afterEach(cleanup);

describe('one account in the admin console', () => {
  it('shows the account, its documents and its status history', async () => {
    const view = await render(<AdminUserDetail userId="mia" />);

    expect(mocks.user).toHaveBeenCalledWith('mia');
    expect(textOf(view)).toContain('Mia Member');
    expect(textOf(view)).toContain('0400 000 000');
    expect(textOf(view)).toContain('Tenant (main)');
    expect(textOf(view)).toContain('Passport.pdf');
    expect(textOf(view)).toContain('In review');
    expect(textOf(view)).toContain('Suspended → Active by Ada Admin');
    expect(textOf(view)).toContain('VerificationPending');
    expect(textOf(view)).toContain('Reason: Appeal upheld');
  });

  it('opens a member\'s document through a freshly signed link', async () => {
    mocks.documentLink.mockResolvedValue({ url: 'https://storage.example.test/signed/Passport.pdf?token=t1', expires_in: 300 });
    const tab = { opener: {}, closed: false, location: { href: '' }, close: vi.fn() };
    Object.assign(window, { open: vi.fn(() => tab) });
    const view = await render(<AdminUserDetail userId="mia" />);

    await click(getByName(view, 'button', 'View Passport'));

    expect(mocks.documentLink).toHaveBeenCalledWith('doc-1');
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe('https://storage.example.test/signed/Passport.pdf?token=t1');
  });

  it('says why its own or a staff account\'s status cannot change here', async () => {
    mocks.user.mockResolvedValue(detail({ role: 'admin', status_locked: "You can't change the status of your own account." }));
    const view = await render(<AdminUserDetail userId="ada" />);

    expect(textOf(view)).toContain("You can't change the status of your own account.");
    expect(descendants(view).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'Change status')).toBe(false);
  });

  it('changes the status with a reason and shows it at once', async () => {
    mocks.setStatus.mockResolvedValue(detail({
      status: 'SUSPENDED',
      status_history: [{ from_status: 'ACTIVE', to_status: 'SUSPENDED', reason: 'Harassment', actor_id: 'ada', actor_name: 'Ada Admin', created_at: '2026-10-23T00:00:00Z' }],
    }));
    const view = await render(<AdminUserDetail userId="mia" />);

    await click(getByName(view, 'button', 'Change status'));
    await typeInto(field(view, 'Reason') as FakeElement, 'Harassment');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');

    expect(mocks.setStatus).toHaveBeenCalledWith('mia', 'SUSPENDED', 'Harassment');
    expect(textOf(view)).toContain('Mia Member is now suspended.');
    expect(textOf(view)).toContain('Active → Suspended by Ada Admin');
  });

  it('says why an account is not verified, and opens its tab of the verification queue', async () => {
    mocks.user.mockResolvedValue(detail({
      verification_status: 'REJECTED',
      verification: { status: 'rejected', rejection_reason: 'Names do not match', approved_at: null, account_rejected: true },
    }));
    const view = await render(<AdminUserDetail userId="mia" />);

    expect(textOf(view)).toContain('VerificationRejected');
    expect(textOf(view)).toContain('Rejected by an adminNames do not match');
    expect(getByName(view, 'a', 'Approve or reject documents in the verification queue').getAttribute('href')).toBe('/admin/verification');

    await cleanup();
    mocks.user.mockResolvedValue(detail({ role: 'service_provider', primary_role: 'SERVICE_PROVIDER' }));
    const provider = await render(<AdminUserDetail userId="pat" />);
    expect(getByName(provider, 'a', 'Approve or reject documents in the verification queue').getAttribute('href')).toBe(
      '/admin/verification?role=provider');

    await cleanup();
    mocks.user.mockResolvedValue(detail({ role: 'admin', primary_role: 'ADMIN', status_locked: 'Staff accounts are managed by the TenantVoice team.' }));
    const staff = await render(<AdminUserDetail userId="ada" />);
    expect(textOf(staff)).not.toContain('verification queue');
  });

  it('says when the account does not exist', async () => {
    mocks.user.mockRejectedValue(new ApiError(404, 'Account not found'));
    const view = await render(<AdminUserDetail userId="nobody" />);

    expect(textOf(view)).toContain('Account not found');
    expect(textOf(view)).not.toContain('Try again');
  });

  it('offers a retry when the account cannot load', async () => {
    mocks.user.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<AdminUserDetail userId="mia" />);

    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Mia Member');
  });

  it('keeps the page at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminUserDetail userId="mia" />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe('a provider account in the admin console', () => {
  const marketplace = { has_profile: true, published: true, listed: true, standing: 'approved', upcoming_bookings: 2, jobs_in_progress: 1 } as const;
  const provider = (over: Partial<Detail> = {}) => detail({
    id: 'pat', full_name: 'Pat Provider', role: 'service_provider', primary_role: 'SERVICE_PROVIDER', provider: marketplace, ...over,
  });
  const heading = (view: FakeElement, text: string) =>
    descendants(view).some((element) => element.tagName === 'H2' && textOf(element) === text);

  it('shows where they are on the marketplace and the jobs they have open', async () => {
    mocks.user.mockResolvedValue(provider());
    const view = await render(<AdminUserDetail userId="pat" />);

    expect(heading(view, 'Marketplace')).toBe(true);
    expect(textOf(view)).toContain('ListingListed on the marketplace');
    expect(textOf(view)).toContain('New bookings, repairs and going liveAllowed');
    expect(textOf(view)).toContain('Confirmed upcoming bookings2');
    expect(textOf(view)).toContain('Jobs in progress1');
  });

  it.each([
    [{ status: 'SUSPENDED' as const }, { listed: false, standing: 'suspended' as const }, 'Hidden while the account is suspended', 'Blocked while the account is suspended'],
    [{}, { listed: false, published: false, standing: 'pending' as const }, 'Not listed: the provider has not gone live', 'Blocked until the account is verified'],
    [{}, { listed: false, published: false, has_profile: false, standing: 'unknown' as const }, 'Not listed: no provider profile yet', 'Blocked until the account is verified'],
    [{ closed_at: '2026-10-20T00:00:00Z' }, { listed: false, standing: 'inactive' as const }, 'Hidden: the account is closed', 'Blocked while the account is not active'],
  ])('says why they are not listed or get no new work (%#)', async (account, state, listing, work) => {
    mocks.user.mockResolvedValue(provider({ ...account, provider: { ...marketplace, ...state } }));
    const view = await render(<AdminUserDetail userId="pat" />);

    expect(textOf(view)).toContain(`Listing${listing}`);
    expect(textOf(view)).toContain(`New bookings, repairs and going live${work}`);
  });

  it('has no marketplace section for anyone else', async () => {
    const view = await render(<AdminUserDetail userId="mia" />);

    expect(heading(view, 'Marketplace')).toBe(false);
  });

  it('explains what suspending a provider does, then how many clients were sent a notice', async () => {
    mocks.user.mockResolvedValue(provider());
    mocks.setStatus.mockResolvedValue(provider({
      status: 'SUSPENDED', notified: 2, provider: { ...marketplace, listed: false, standing: 'suspended' },
    }));
    const view = await render(<AdminUserDetail userId="pat" />);

    await click(getByName(view, 'button', 'Change status'));
    expect(textOf(view)).toContain('They can still sign in to finish jobs in progress and read past messages and invoices.');
    expect(textOf(view)).toContain('Clients with confirmed upcoming bookings are told.');
    await typeInto(field(view, 'Reason') as FakeElement, 'Unlicensed work');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');

    expect(mocks.setStatus).toHaveBeenCalledWith('pat', 'SUSPENDED', 'Unlicensed work');
    expect(textOf(view)).toContain('Pat Provider is now suspended. The clients of 2 confirmed upcoming bookings were sent a notice.');
    expect(textOf(view)).toContain('Hidden while the account is suspended');
  });

  it('counts one client in the singular, and none once the provider was already out of work', async () => {
    mocks.user.mockResolvedValue(provider({ provider: { ...marketplace, upcoming_bookings: 1 } }));
    mocks.setStatus.mockResolvedValue(provider({ status: 'DEACTIVATED', notified: 1, provider: { ...marketplace, upcoming_bookings: 1 } }));
    const view = await render(<AdminUserDetail userId="pat" />);
    await click(getByName(view, 'button', 'Change status'));
    const status = field(view, 'New status') as FakeElement;
    status.value = 'DEACTIVATED';
    await dispatch(status, 'change');
    await typeInto(field(view, 'Reason') as FakeElement, 'Asked to close');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');

    expect(textOf(view)).toContain('Pat Provider is now deactivated. The client of 1 confirmed upcoming booking was sent a notice.');

    await cleanup();
    mocks.user.mockResolvedValue(provider({ status: 'SUSPENDED', provider: { ...marketplace, upcoming_bookings: 1 } }));
    mocks.setStatus.mockResolvedValue(provider({ status: 'DEACTIVATED', notified: 0, provider: { ...marketplace, upcoming_bookings: 1 } }));
    const suspended = await render(<AdminUserDetail userId="pat" />);
    await click(getByName(suspended, 'button', 'Change status'));
    const next = field(suspended, 'New status') as FakeElement;
    next.value = 'DEACTIVATED';
    await dispatch(next, 'change');
    // Their clients heard at the suspension; this change tells nobody.
    expect(textOf(suspended)).toContain('Clients with confirmed upcoming bookings were told when the account was suspended.');
    expect(textOf(suspended)).not.toContain('Clients with confirmed upcoming bookings are told.');
    await typeInto(field(suspended, 'Reason') as FakeElement, 'Asked to close');
    await dispatch(descendants(suspended).find((element) => element.tagName === 'FORM')!, 'submit');

    expect(textOf(suspended)).toContain('Pat Provider is now deactivated.');
    expect(textOf(suspended)).not.toContain('was sent a notice');
  });

  it('claims no notice the server did not send, as when the notices failed', async () => {
    mocks.user.mockResolvedValue(provider());
    // Three clients have bookings, but the change answers that it told nobody.
    mocks.setStatus.mockResolvedValue(provider({
      status: 'SUSPENDED', notified: 0, provider: { ...marketplace, upcoming_bookings: 3, listed: false, standing: 'suspended' },
    }));
    const view = await render(<AdminUserDetail userId="pat" />);

    await click(getByName(view, 'button', 'Change status'));
    await typeInto(field(view, 'Reason') as FakeElement, 'Unlicensed work');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');

    expect(textOf(view)).toContain('Pat Provider is now suspended.');
    expect(textOf(view)).not.toMatch(/(was|were) sent a notice/);
  });

  it('says reactivating still needs verification for new work, and tells no clients', async () => {
    mocks.user.mockResolvedValue(provider({ status: 'SUSPENDED', provider: { ...marketplace, listed: false, standing: 'suspended' } }));
    mocks.setStatus.mockResolvedValue(provider({ provider: { ...marketplace, standing: 'pending' } }));
    const view = await render(<AdminUserDetail userId="pat" />);

    await click(getByName(view, 'button', 'Change status'));
    expect((field(view, 'New status') as FakeElement).value).toBe('ACTIVE');
    expect(textOf(view)).toContain('Accepting bookings, taking on repairs and going live still need a verified account.');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');

    expect(textOf(view)).toContain('Pat Provider is now active.');
    expect(textOf(view)).not.toContain('were sent a notice');
    expect(textOf(view)).toContain('Blocked until the account is verified');
  });

  it('keeps the marketplace section at AA contrast', async () => {
    mocks.user.mockResolvedValue(provider());
    const view = await render(<AdminUserDetail userId="pat" />);

    expect(lowContrastText(view)).toEqual([]);
  });
});
