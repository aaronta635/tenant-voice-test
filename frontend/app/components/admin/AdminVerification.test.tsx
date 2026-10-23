import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileVerificationDocument, ReviewDocument, VerificationItem, VerificationQueue } from '@/app/lib/admin-api';
import { ApiError } from '@/app/lib/api';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import AdminVerification from './AdminVerification';

const mocks = vi.hoisted(() => ({
  verification: vi.fn(), verificationItem: vi.fn(), decideDocument: vi.fn(), decideAccount: vi.fn(), documentLink: vi.fn(),
}));
vi.mock('@/app/lib/admin-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-api')>()),
  adminApi: mocks,
}));
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => '/admin/verification',
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

const SIGNED = 'https://storage.example.test/sign/profile-documents/Passport.pdf?token=t1';

function document(id: string, over: Partial<ReviewDocument> = {}): ReviewDocument {
  return {
    id, document_type: 'PASSPORT', label: 'Passport', status: 'pending', rejection_reason: null,
    file_name: 'Passport.pdf', has_file: true, can_open: true, visibility: 'private', kind: null,
    submitted_at: '2026-10-20T00:00:00Z', verified_at: null, updated_at: '2026-10-20T00:00:00.123456Z',
    link: { url: SIGNED, expires_in: 300 }, ...over,
  };
}

function mobileDocument(key: string, over: Partial<MobileVerificationDocument> = {}): MobileVerificationDocument {
  return {
    key, name: 'Passport', mime_type: 'image/jpeg', uploaded_at: '2026-10-19T00:00:00Z', has_file: true,
    link: { url: `https://storage.example.test/sign/profile-documents/${key}.jpg?token=m1`, expires_in: 300 }, ...over,
  };
}

function account(id: string, name: string, over: Partial<VerificationItem> = {}): VerificationItem {
  return {
    user_id: id, full_name: name, email: `${id}@example.test`, role: 'tenant', primary_role: 'TENANT',
    account: { status: 'pending', rejection_reason: null, approved_at: null, account_rejected: false },
    requirements: [{ key: 'photo_id', label: 'Photo ID', types: ['PASSPORT'], status: 'pending' }],
    can_approve: false,
    documents: [document(`${id}-passport`)],
    ...over,
  };
}

function queue(items: VerificationItem[], over: Partial<VerificationQueue> = {}): VerificationQueue {
  return {
    role: 'tenant', status: 'PENDING', items, total: items.length, limit: 20, offset: 0,
    counts: { tenant: items.length, landlord: 2, provider: 0 }, ...over,
  };
}

let leavePage = () => {};
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/admin/verification${search}`);
  leavePage = navigation.page.install(window);
}

async function land() {
  await act(async () => { navigation.page.land(); });
  await settle();
}

const cardOf = (view: FakeElement, name: string) =>
  descendants(view).find((element) => element.tagName === 'ARTICLE' && textOf(element).startsWith(name)) as FakeElement;
const dialogForm = (view: FakeElement) =>
  descendants(view).find((element) => element.tagName === 'FORM' && textOf(element).includes('Reason (required)')) as FakeElement;
const reasonField = (view: FakeElement) =>
  descendants(dialogForm(view)).find((element) => element.tagName === 'TEXTAREA') as FakeElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  openPage();
  mocks.verification.mockResolvedValue(queue([account('mia', 'Mia Member'), account('oli', 'Oli Other')]));
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

describe('the verification queue', () => {
  it('lists each account with what its verification needs and its documents in review', async () => {
    const view = await render(<AdminVerification />);

    expect(mocks.verification).toHaveBeenCalledWith({ role: 'tenant', status: 'PENDING', page: 1 });
    expect(textOf(view)).toContain('2 tenants with documents in review');
    expect(textOf(view)).toContain('Showing 1–2 of 2');
    const mia = cardOf(view, 'Mia Member');
    expect(textOf(mia)).toContain('mia@example.test');
    expect(textOf(mia)).toContain('Account not verified yet');
    expect(textOf(mia)).toContain('Photo ID In review');
    expect(textOf(mia)).toContain('Passport.pdf');
    expect(textOf(mia)).toContain('Submitted');
    expect(getByName(mia, 'a', 'Mia Member').getAttribute('href')).toBe('/admin/users/mia');
    // Only an account the server says can be approved offers it; one in review can be rejected.
    expect(descendants(mia).some((element) => textOf(element).startsWith('Approve account'))).toBe(false);
    expect(getByName(mia, 'button', 'Reject account of Mia Member')).toBeTruthy();
  });

  it('keeps the tab, status and page in the URL and loads what it asks for', async () => {
    openPage('?role=provider&status=REJECTED&page=2');
    mocks.verification.mockResolvedValue(queue([account('pat', 'Pat Provider')], {
      role: 'provider', status: 'REJECTED', total: 21, counts: { tenant: 1, landlord: 0, provider: 21 },
    }));

    const view = await render(<AdminVerification />);

    expect(mocks.verification).toHaveBeenCalledWith({ role: 'provider', status: 'REJECTED', page: 2 });
    expect(textOf(view)).toContain('21 providers with rejected documents');
    expect(textOf(view)).toContain('Showing 21–21 of 21');
    const tabs = descendants(view).find((element) => element.getAttribute('aria-label') === 'Account type') as FakeElement;
    expect(getByName(tabs, 'a', 'Providers(21)').getAttribute('aria-current')).toBe('page');
    expect(getByName(tabs, 'a', 'Tenants(1)').getAttribute('href')).toBe('/admin/verification?status=REJECTED');
    expect(getByName(view, 'a', 'Rejected').getAttribute('aria-current')).toBe('page');
  });

  it('switches tab and status through the History API', async () => {
    const view = await render(<AdminVerification />);

    await click(getByName(view, 'a', 'Landlords(2)'));
    expect(navigation.page.stack()).toEqual(['/admin/verification', '>/admin/verification?role=landlord']);
    await land();
    expect(mocks.verification).toHaveBeenLastCalledWith({ role: 'landlord', status: 'PENDING', page: 1 });

    await click(getByName(view, 'a', 'Approved'));
    await land();
    expect(navigation.page.location.search).toBe('?role=landlord&status=APPROVED');
    expect(mocks.verification).toHaveBeenLastCalledWith({ role: 'landlord', status: 'APPROVED', page: 1 });
  });

  it('says it is loading, then when nothing waits', async () => {
    let resolve!: (value: VerificationQueue) => void;
    mocks.verification.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = await render(<AdminVerification />);
    expect(textOf(view)).toContain('Loading the queue…');

    resolve(queue([]));
    await settle();

    expect(textOf(view)).toContain('Nothing to review');
    expect(textOf(view)).toContain('0 tenants with documents in review');
  });

  it('offers a retry when the queue cannot load', async () => {
    mocks.verification.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<AdminVerification />);

    expect(textOf(view)).toContain("Couldn't load the queue");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Mia Member');
  });

  it('keeps the queue at AA contrast, also under the pointer', async () => {
    mocks.verification.mockResolvedValue(queue([
      account('mia', 'Mia Member', {
        account: { status: 'rejected', rejection_reason: 'Photo ID: blurred', approved_at: null, account_rejected: false },
        documents: [document('d1', { status: 'rejected', rejection_reason: 'blurred' }), document('d2')],
      }),
      account('leo', 'Leo Landlord', {
        can_approve: true,
        mobile_documents: [mobileDocument('passport'), mobileDocument('licence', { name: 'Licence', link: null })],
      }),
      account('pat', 'Pat Provider', { approval_note: 'Approving a provider needs a service area and categories on its profile.' }),
    ], { mobile_unavailable: true }));
    const view = await render(<AdminVerification />);

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });

  it('says when the mobile app\'s documents could not be loaded, and tries again', async () => {
    mocks.verification.mockResolvedValueOnce(queue([account('mia', 'Mia Member')], { mobile_unavailable: true }));
    const view = await render(<AdminVerification />);

    expect(textOf(view)).toContain('The documents sent from the mobile app could not be loaded');
    expect(textOf(view)).toContain('Mia Member');
    await click(getByName(view, 'button', 'Try again'));

    expect(mocks.verification).toHaveBeenCalledTimes(2);
    expect(textOf(view)).not.toContain('could not be loaded');
  });
});

describe('deciding a document', () => {
  it('approves the version shown, then shows the account as the server has it', async () => {
    mocks.decideDocument.mockResolvedValue({
      document: document('mia-passport', { status: 'verified' }),
      account: { status: 'verified', rejection_reason: null, approved_at: '2026-10-23T00:00:00Z', account_rejected: false },
    });
    mocks.verificationItem.mockResolvedValue(account('mia', 'Mia Member', {
      account: { status: 'verified', rejection_reason: null, approved_at: '2026-10-23T00:00:00Z', account_rejected: false },
      requirements: [{ key: 'photo_id', label: 'Photo ID', types: ['PASSPORT'], status: 'verified' }],
      documents: [],
    }));
    const view = await render(<AdminVerification />);

    await click(getByName(cardOf(view, 'Mia Member'), 'button', 'Approve Passport'));

    const [sent, decision, reason] = mocks.decideDocument.mock.calls[0];
    expect(sent).toMatchObject({ id: 'mia-passport', updated_at: '2026-10-20T00:00:00.123456Z' });
    expect([decision, reason]).toEqual(['APPROVED', '']);
    expect(mocks.verificationItem).toHaveBeenCalledWith('mia', 'PENDING');
    const mia = cardOf(view, 'Mia Member');
    expect(textOf(mia)).toContain("Passport approved. Mia Member's account is now verified.");
    expect(textOf(mia)).toContain('Nothing left to review for this account.');
    expect(textOf(mia)).toContain('Account verified');
    // The other account is untouched.
    expect(textOf(cardOf(view, 'Oli Other'))).toContain('Passport.pdf');
  });

  it('needs a reason to reject, then sends it', async () => {
    mocks.decideDocument.mockResolvedValue({
      document: document('mia-passport', { status: 'rejected', rejection_reason: 'The photo is blurred' }),
      account: { status: 'rejected', rejection_reason: 'Photo ID: The photo is blurred', approved_at: null, account_rejected: false },
    });
    mocks.verificationItem.mockResolvedValue(account('mia', 'Mia Member', { documents: [] }));
    const view = await render(<AdminVerification />);

    await click(getByName(cardOf(view, 'Mia Member'), 'button', 'Reject Passport'));
    expect(textOf(view)).toContain('Reject this document');
    await dispatch(dialogForm(view), 'submit');

    expect(mocks.decideDocument).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Give a reason. The person sees it with the decision.');
    expect(reasonField(view).getAttribute('aria-invalid')).toBe('true');

    await typeInto(reasonField(view), 'The photo is blurred');
    await dispatch(dialogForm(view), 'submit');

    expect(mocks.decideDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'mia-passport' }), 'REJECTED', 'The photo is blurred');
    expect(dialogForm(view)).toBeUndefined();
    expect(textOf(cardOf(view, 'Mia Member'))).toContain('Passport rejected. Mia Member is told why.');
  });

  it('reloads the account and says so when someone changed the document first', async () => {
    mocks.decideDocument.mockRejectedValue(new ApiError(409, 'This document changed since you opened it.'));
    mocks.verificationItem.mockResolvedValue(account('mia', 'Mia Member', {
      documents: [document('mia-passport', { status: 'verified', verified_at: '2026-10-22T00:00:00Z' })],
    }));
    const view = await render(<AdminVerification />);

    await click(getByName(cardOf(view, 'Mia Member'), 'button', 'Approve Passport'));

    const mia = cardOf(view, 'Mia Member');
    expect(textOf(mia)).toContain('Passport changed since this page loaded, so your decision was not saved. The latest version is shown.');
    expect(mocks.verificationItem).toHaveBeenCalledWith('mia', 'PENDING');
    expect(textOf(mia)).toContain('Approved');
    expect(descendants(mia).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'Approve Passport')).toBe(false);
  });

  it('closes the reason dialog and reloads when the document went meanwhile', async () => {
    mocks.decideDocument.mockRejectedValue(new ApiError(404, 'Document not found'));
    mocks.verificationItem.mockResolvedValue(account('mia', 'Mia Member', { documents: [] }));
    const view = await render(<AdminVerification />);

    await click(getByName(cardOf(view, 'Mia Member'), 'button', 'Reject Passport'));
    await typeInto(reasonField(view), 'Expired');
    await dispatch(dialogForm(view), 'submit');

    expect(dialogForm(view)).toBeUndefined();
    expect(textOf(cardOf(view, 'Mia Member'))).toContain('Passport is no longer there, so your decision was not saved.');
  });

  it('keeps the reason dialog open with the problem when saving fails', async () => {
    mocks.decideDocument.mockRejectedValue(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<AdminVerification />);

    await click(getByName(cardOf(view, 'Mia Member'), 'button', 'Reject Passport'));
    await typeInto(reasonField(view), 'Expired');
    await dispatch(dialogForm(view), 'submit');

    expect(textOf(dialogForm(view))).toContain('The service is temporarily unavailable.');
    expect(mocks.verificationItem).not.toHaveBeenCalled();
  });

  it('shows decided documents without decisions, with their reason', async () => {
    openPage('?status=REJECTED');
    mocks.verification.mockResolvedValue(queue([account('mia', 'Mia Member', {
      documents: [document('d1', { status: 'rejected', rejection_reason: 'Only the front' })],
    })], { status: 'REJECTED' }));
    const view = await render(<AdminVerification />);

    const mia = cardOf(view, 'Mia Member');
    expect(textOf(mia)).toContain('Rejected documents');
    expect(textOf(mia)).toContain('Rejected: Only the front');
    expect(descendants(mia).some((element) => element.tagName === 'BUTTON' && /^(Approve|Reject) Passport$/.test(textOf(element)))).toBe(false);
  });
});

describe('opening a document', () => {
  it('opens the signed link in a new tab while it works', async () => {
    const view = await render(<AdminVerification />);

    const link = getByName(cardOf(view, 'Mia Member'), 'a', 'View Passport (opens in a new tab)');
    expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual([
      SIGNED, '_blank', 'noopener noreferrer']);
    await click(link);
    expect(mocks.documentLink).not.toHaveBeenCalled();
  });

  it('signs a fresh link once the one shown has expired', async () => {
    const view = await render(<AdminVerification />);
    mocks.documentLink.mockResolvedValue({ url: 'https://storage.example.test/fresh?token=t2', expires_in: 300 });
    const tab = { opener: {}, closed: false, location: { href: '' }, close: vi.fn() };
    Object.assign(window, { open: vi.fn(() => tab) });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000);

    await click(getByName(cardOf(view, 'Mia Member'), 'a', 'View Passport (opens in a new tab)'));

    expect(mocks.documentLink).toHaveBeenCalledWith('mia-passport');
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe('https://storage.example.test/fresh?token=t2');
  });
});

describe("the mobile app's documents", () => {
  it('lists them read-only, with a link to each file the app stored here', async () => {
    mocks.verification.mockResolvedValue(queue([account('mia', 'Mia Member', {
      documents: [],
      mobile_documents: [
        mobileDocument('passport'),
        mobileDocument('selfie', { name: 'Selfie', link: null, uploaded_at: 'yesterday' }),
        mobileDocument('note', { name: 'Note', link: null, has_file: false, uploaded_at: null }),
      ],
    })]));
    const view = await render(<AdminVerification />);

    const mia = cardOf(view, 'Mia Member');
    expect(textOf(mia)).toContain('From the mobile app');
    expect(textOf(mia)).toContain('None from the website.');
    expect(textOf(mia)).not.toContain('Nothing left to review for this account.');
    const link = getByName(mia, 'a', 'View Passport from the mobile app (opens in a new tab)');
    expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual([
      'https://storage.example.test/sign/profile-documents/passport.jpg?token=m1', '_blank', 'noopener noreferrer']);
    expect(textOf(mia)).toContain('Uploaded 19 Oct 2026');
    expect(textOf(mia)).toContain('Stored outside TenantVoice');
    expect(textOf(mia)).toContain('No file');
    expect(textOf(mia)).not.toContain('Uploaded —');
    // No decision of their own.
    expect(descendants(mia).some((element) => element.tagName === 'BUTTON' && /^(Approve|Reject) (Passport|Selfie)/.test(textOf(element)))).toBe(false);
  });

  it('reads the account again for a fresh link once the one shown has expired', async () => {
    mocks.verification.mockResolvedValue(queue([account('mia', 'Mia Member', { mobile_documents: [mobileDocument('passport')] })]));
    mocks.verificationItem.mockResolvedValue(account('mia', 'Mia Member', {
      mobile_documents: [mobileDocument('passport', { link: { url: 'https://storage.example.test/fresh-mobile?token=m2', expires_in: 300 } })],
    }));
    const tab = { opener: {}, closed: false, location: { href: '' }, close: vi.fn() };
    Object.assign(window, { open: vi.fn(() => tab) });
    const view = await render(<AdminVerification />);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000);

    await click(getByName(cardOf(view, 'Mia Member'), 'a', 'View Passport from the mobile app (opens in a new tab)'));
    await settle();

    expect(mocks.verificationItem).toHaveBeenCalledWith('mia', 'PENDING');
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe('https://storage.example.test/fresh-mobile?token=m2');
  });
});

describe('deciding an account', () => {
  it('approves an account in review, and shows why the server refused one', async () => {
    mocks.verification.mockResolvedValue(queue([account('mia', 'Mia Member', { can_approve: true, documents: [] })]));
    mocks.decideAccount.mockRejectedValueOnce(new ApiError(422, 'Worker service area and categories are required before approval'));
    mocks.verificationItem.mockResolvedValue(account('mia', 'Mia Member', { can_approve: true, documents: [] }));
    const view = await render(<AdminVerification />);

    await click(getByName(cardOf(view, 'Mia Member'), 'button', 'Approve account of Mia Member'));
    expect(textOf(cardOf(view, 'Mia Member'))).toContain('Worker service area and categories are required before approval');

    mocks.decideAccount.mockResolvedValueOnce({});
    mocks.verificationItem.mockResolvedValue(account('mia', 'Mia Member', {
      account: { status: 'verified', rejection_reason: null, approved_at: '2026-10-23T00:00:00Z', account_rejected: false },
      documents: [],
    }));
    await click(getByName(cardOf(view, 'Mia Member'), 'button', 'Approve account of Mia Member'));

    expect(mocks.decideAccount).toHaveBeenLastCalledWith('mia', 'APPROVED', '');
    const mia = cardOf(view, 'Mia Member');
    expect(textOf(mia)).toContain("Mia Member's account is verified.");
    expect(textOf(mia)).toContain('Account verified');
    // A decided account is not decided again from here.
    expect(descendants(mia).some((element) => element.tagName === 'BUTTON' && /account of Mia Member$/.test(textOf(element)))).toBe(false);
  });

  it('says why an account in review cannot be approved yet', async () => {
    mocks.verification.mockResolvedValue(queue([account('pat', 'Pat Provider', {
      role: 'service_provider', primary_role: 'SERVICE_PROVIDER',
      approval_note: 'Approving a provider needs a service area and categories on its profile.',
    })]));
    const view = await render(<AdminVerification />);

    const pat = cardOf(view, 'Pat Provider');
    expect(textOf(pat)).toContain('Approving a provider needs a service area and categories on its profile.');
    expect(descendants(pat).some((element) => textOf(element).startsWith('Approve account'))).toBe(false);
    expect(getByName(pat, 'button', 'Reject account of Pat Provider')).toBeTruthy();
  });

  it('rejects an account with a reason it then shows', async () => {
    mocks.decideAccount.mockResolvedValue({});
    mocks.verificationItem.mockResolvedValue(account('mia', 'Mia Member', {
      account: { status: 'rejected', rejection_reason: 'Names do not match', approved_at: null, account_rejected: true },
    }));
    const view = await render(<AdminVerification />);

    await click(getByName(cardOf(view, 'Mia Member'), 'button', 'Reject account of Mia Member'));
    expect(textOf(view)).toContain('Reject this account');
    await dispatch(dialogForm(view), 'submit');
    expect(mocks.decideAccount).not.toHaveBeenCalled();
    await typeInto(reasonField(view), 'Names do not match');
    await dispatch(dialogForm(view), 'submit');

    expect(mocks.decideAccount).toHaveBeenCalledWith('mia', 'REJECTED', 'Names do not match');
    const mia = cardOf(view, 'Mia Member');
    expect(textOf(mia)).toContain("Mia Member's account was rejected. They are told why.");
    expect(textOf(mia)).toContain('Rejected by an admin: Names do not match');
    expect(descendants(mia).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'Reject account of Mia Member')).toBe(false);
  });
});
