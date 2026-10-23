import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { lease, SIGNATURE } from '@/app/test-utils/leases';
import TenantLeaseView from './TenantLeaseView';

const mockLeases = vi.hoisted(() => ({ get: vi.fn(), pdf: vi.fn(), confirm: vi.fn(), sign: vi.fn() }));

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/leases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/leases')>()),
  leasesApi: mockLeases,
}));

const checkbox = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'INPUT' && element.type === 'checkbox') as FakeElement;

async function tick(box: FakeElement) {
  box.checked = true;
  await click(box);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockLeases.pdf.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the tenant lease page', () => {
  it('shows the terms and the latest PDF from the backend', async () => {
    mockLeases.get.mockResolvedValue(lease());

    const view = await render(<TenantLeaseView leaseId="lease-1" />);

    expect(textOf(view)).toContain('Ready for you to review');
    expect(textOf(view)).toContain('$650 a week (AUD)');
    expect(textOf(view)).toContain('Version 1, sent 21 Oct 2026');
    expect(mockLeases.pdf).toHaveBeenCalledWith('lease-1', 'doc-1');
    const frame = descendants(view).find((element) => element.tagName === 'IFRAME') as FakeElement;
    expect(frame.getAttribute('src')).toMatch(/^blob:/);
    expect(frame.getAttribute('title')).toBe('Lease PDF, version 1');
  });

  it('confirms the terms of the PDF shown, once the tenant ticks they read it', async () => {
    mockLeases.get.mockResolvedValue(lease());
    mockLeases.confirm.mockResolvedValue(lease({
      stage: 'confirmed', tenant_confirmed_at: '2026-10-22T00:00:00Z',
      actions: { send_document: false, confirm: false, sign: true, owner_sign: false, activate: false },
    }));
    const view = await render(<TenantLeaseView leaseId="lease-1" />);
    const button = getByName(view, 'button', 'Confirm the terms');

    expect(button.hasAttribute('disabled')).toBe(true);
    await tick(checkbox(view));
    await click(getByName(view, 'button', 'Confirm the terms'));

    expect(mockLeases.confirm).toHaveBeenCalledWith('lease-1', 'doc-1');
    expect(textOf(view)).toContain('You confirmed the terms. Sign the lease next.');
    expect(getByName(view, 'button', 'Sign the lease')).toBeTruthy();
  });

  it('shows the newer PDF when the owner replaced the one reviewed', async () => {
    mockLeases.get
      .mockResolvedValueOnce(lease())
      .mockResolvedValueOnce(lease({ document: { id: 'doc-2', filename: 'v2.pdf', version: 2, created_at: '2026-10-22T00:00:00Z' } }));
    mockLeases.confirm.mockRejectedValue(new ApiError(409, 'The lease PDF has changed; review the latest PDF.'));
    const view = await render(<TenantLeaseView leaseId="lease-1" />);

    await tick(checkbox(view));
    await click(getByName(view, 'button', 'Confirm the terms'));

    expect(textOf(view)).toContain('The lease PDF has changed; review the latest PDF.');
    expect(textOf(view)).toContain('Version 2');
    expect(mockLeases.pdf).toHaveBeenLastCalledWith('lease-1', 'doc-2');
    // The tick was for the older PDF.
    expect(checkbox(view).checked).toBe(false);
  });

  it('signs with the typed name and the consent ticked', async () => {
    mockLeases.get.mockResolvedValue(lease({
      stage: 'confirmed', tenant_confirmed_at: '2026-10-22T00:00:00Z',
      actions: { send_document: false, confirm: false, sign: true, owner_sign: false, activate: false },
    }));
    mockLeases.sign.mockResolvedValue(lease({ stage: 'tenant_signed', tenant_signature: SIGNATURE, actions: {
      send_document: false, confirm: false, sign: false, owner_sign: false, activate: false } }));
    const view = await render(<TenantLeaseView leaseId="lease-1" />);
    const form = descendants(view).find((element) => element.tagName === 'FORM') as FakeElement;

    await dispatch(form, 'submit');
    expect(mockLeases.sign).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Tick the box to agree to the statement before you sign.');

    await typeInto(descendants(form).find((element) => element.tagName === 'INPUT' && element.type === 'text') as FakeElement, '  Tanya   Tenant ');
    await tick(checkbox(view));
    await dispatch(form, 'submit');

    expect(mockLeases.sign).toHaveBeenCalledWith('lease-1', 'doc-1', 'Tanya Tenant');
    expect(textOf(view)).toContain('You signed the lease. Your owner signs it next.');
    expect(textOf(view)).toContain('You signed as “Tanya Tenant”');
    expect(textOf(view)).toContain(`SHA-256 ${'a'.repeat(64)}`);
  });

  it('never shows a draft without signatures as signed', async () => {
    mockLeases.get.mockResolvedValue(lease({ stage: 'draft', document: null, actions: {
      send_document: false, confirm: false, sign: false, owner_sign: false, activate: false } }));

    const view = await render(<TenantLeaseView leaseId="lease-1" />);

    expect(textOf(view)).toContain('Your owner is preparing the lease');
    expect(textOf(view)).toContain('Your owner has not sent the lease PDF yet.');
    const done = descendants(view).filter((element) => element.tagName === 'LI').map(textOf).filter((step) => step.endsWith(': done'));
    expect(done).toEqual(['✓Terms drafted: done']);
    expect(textOf(view)).not.toContain('Signatures');
    expect(descendants(view).filter((element) => element.tagName === 'IFRAME')).toEqual([]);
  });

  it('says when a lease is not theirs to open', async () => {
    mockLeases.get.mockRejectedValue(new ApiError(404, 'Lease not found.'));

    const view = await render(<TenantLeaseView leaseId="someone-elses" />);

    expect(textOf(view)).toContain('Lease not found');
    expect(mockLeases.pdf).not.toHaveBeenCalled();
  });
});
