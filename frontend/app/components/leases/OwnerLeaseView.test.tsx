import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { Lease } from '@/app/lib/leases';
import { lease, SIGNATURE } from '@/app/test-utils/leases';
import OwnerLeaseView from './OwnerLeaseView';

const mockLeases = vi.hoisted(() => ({
  get: vi.fn(), pdf: vi.fn(), preview: vi.fn(), send: vi.fn(), upload: vi.fn(), ownerSign: vi.fn(), activate: vi.fn(),
}));

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/leases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/leases')>()),
  leasesApi: mockLeases,
}));

const NONE = { send_document: false, confirm: false, sign: false, owner_sign: false, activate: false };
const owned = (over: Partial<Lease> = {}) => lease({ viewer_role: 'owner', consent: { text: 'I have read the lease PDF the tenant signed.', version: 'v1' }, ...over });
const draft = () => owned({ stage: 'draft', document: null, actions: { ...NONE, send_document: true } });
const PREVIEW = { sha256: 'b'.repeat(64), filename: 'Residential tenancy agreement.pdf', size: 8, pdf_base64: btoa('%PDF-1.4') };

/** The control a visible <label> names. */
function field(view: FakeElement, text: RegExp): FakeElement {
  const label = descendants(view).find((element) => element.tagName === 'LABEL' && text.test(textOf(element)));
  if (!label) throw new Error(`No label reads ${text}`);
  return descendants(view).find((element) => element.id === label.getAttribute('for')) as FakeElement;
}

const forms = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'FORM');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockLeases.pdf.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
  mockLeases.preview.mockResolvedValue(PREVIEW);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('sending the lease PDF', () => {
  it('sends exactly the PDF previewed, from the guided form', async () => {
    mockLeases.get.mockResolvedValue(draft());
    mockLeases.send.mockResolvedValue(owned({ stage: 'review' }));
    const view = await render(<OwnerLeaseView leaseId="lease-1" />);

    // The bond starts from the listing's.
    expect(field(view, /^Bond/).value).toBe('2600');
    await typeInto(field(view, /Special conditions/), 'No smoking inside.');
    await dispatch(forms(view)[0], 'submit');
    await click(getByName(view, 'button', 'Send this PDF to Tanya Tenant'));

    expect(mockLeases.preview).toHaveBeenCalledWith('lease-1', expect.objectContaining({ bond_amount: 2600, special_conditions: 'No smoking inside.' }));
    expect(mockLeases.send).toHaveBeenCalledWith('lease-1', expect.objectContaining({ special_conditions: 'No smoking inside.' }), PREVIEW.sha256);
    expect(textOf(view)).toContain('The lease PDF was sent to Tanya Tenant.');
  });

  it('asks for a new preview after the details change', async () => {
    mockLeases.get.mockResolvedValue(draft());
    const view = await render(<OwnerLeaseView leaseId="lease-1" />);

    await dispatch(forms(view)[0], 'submit');
    await typeInto(field(view, /Special conditions/), 'Changed after the preview.');

    expect(textOf(view)).toContain('You changed the details after the preview. Preview the PDF again before you send it.');
    expect(descendants(view).filter((element) => element.tagName === 'BUTTON' && /Send this PDF/.test(textOf(element)))).toEqual([]);
    expect(mockLeases.send).not.toHaveBeenCalled();
  });

  it("drops a preview the server says is stale, with the server's words", async () => {
    mockLeases.get.mockResolvedValue(draft());
    mockLeases.send.mockRejectedValue(new ApiError(409, 'The lease changed after you previewed it. Preview it again, then send it.'));
    const view = await render(<OwnerLeaseView leaseId="lease-1" />);

    await dispatch(forms(view)[0], 'submit');
    await click(getByName(view, 'button', 'Send this PDF to Tanya Tenant'));

    expect(textOf(view)).toContain('The lease changed after you previewed it. Preview it again, then send it.');
    expect(descendants(view).filter((element) => element.tagName === 'IFRAME')).toEqual([]);
  });

  it.each(['send', 'upload'])('reloads the lease when a %s is refused because the tenant confirmed meanwhile', async (how) => {
    const CONFIRMED = 'The tenant has confirmed this lease, so its PDF can no longer change.';
    mockLeases.get.mockResolvedValueOnce(draft())
      .mockResolvedValue(owned({ stage: 'confirmed', tenant_confirmed_at: '2026-10-22T00:00:00Z', actions: NONE }));
    mockLeases.send.mockRejectedValue(new ApiError(409, CONFIRMED));
    mockLeases.upload.mockRejectedValue(new ApiError(409, CONFIRMED));
    const view = await render(<OwnerLeaseView leaseId="lease-1" />);

    if (how === 'send') {
      await dispatch(forms(view)[0], 'submit');
      await click(getByName(view, 'button', 'Send this PDF to Tanya Tenant'));
    } else {
      const input = field(view, /Lease PDF \(up to 10 MB\)/);
      input.files = [new File(['%PDF-1.4'], 'ours.pdf', { type: 'application/pdf' })];
      await dispatch(input, 'change');
      await dispatch(forms(view)[1], 'submit');
    }

    expect(mockLeases.get).toHaveBeenCalledTimes(2);
    expect(textOf(view)).toContain(CONFIRMED);
    // The lease as it is now: no form offers another PDF.
    expect(forms(view)).toEqual([]);
    expect(textOf(view)).toContain('Tanya Tenant confirmed its terms, so it can no longer change.');
  });

  it('sends an uploaded PDF', async () => {
    mockLeases.get.mockResolvedValue(draft());
    mockLeases.upload.mockResolvedValue(owned({ stage: 'review' }));
    const view = await render(<OwnerLeaseView leaseId="lease-1" />);
    const input = field(view, /Lease PDF \(up to 10 MB\)/);
    const file = new File(['%PDF-1.4'], 'ours.pdf', { type: 'application/pdf' });

    input.files = [file];
    await dispatch(input, 'change');
    await dispatch(forms(view)[1], 'submit');

    expect(mockLeases.upload).toHaveBeenCalledWith('lease-1', file);
    expect(textOf(view)).toContain('ours.pdf was sent to Tanya Tenant.');
  });

  it('offers no new PDF once the tenant confirmed the terms', async () => {
    mockLeases.get.mockResolvedValue(owned({ stage: 'confirmed', tenant_confirmed_at: '2026-10-22T00:00:00Z', actions: NONE }));

    const view = await render(<OwnerLeaseView leaseId="lease-1" />);

    expect(textOf(view)).toContain('Tanya Tenant confirmed its terms, so it can no longer change.');
    expect(forms(view)).toEqual([]);
  });
});

describe('signing and activating', () => {
  const tenantSigned = () => owned({ stage: 'tenant_signed', tenant_signature: SIGNATURE, actions: { ...NONE, owner_sign: true } });

  async function sign(view: FakeElement) {
    const form = forms(view)[0];
    const agree = descendants(form).find((element) => element.tagName === 'INPUT' && element.type === 'checkbox') as FakeElement;
    agree.checked = true;
    await click(agree);
    await dispatch(form, 'submit');
  }

  it('signs the tenant-signed PDF, then activates the lease', async () => {
    mockLeases.get.mockResolvedValue(tenantSigned());
    mockLeases.ownerSign.mockResolvedValue(owned({ stage: 'signed', tenant_signature: SIGNATURE, owner_signature: SIGNATURE, actions: { ...NONE, activate: true } }));
    mockLeases.activate.mockResolvedValue(owned({ stage: 'active', status: 'active', tenant_signature: SIGNATURE, owner_signature: SIGNATURE, actions: NONE }));
    const view = await render(<OwnerLeaseView leaseId="lease-1" />);

    await sign(view);

    expect(mockLeases.ownerSign).toHaveBeenCalledWith('lease-1', 'Olivia Owner');
    expect(mockLeases.activate).toHaveBeenCalledWith('lease-1');
    expect(textOf(view)).toContain('The lease is active. Tanya Tenant has been told.');
  });

  it('keeps the signature and offers activation again when activating fails', async () => {
    mockLeases.get.mockResolvedValue(tenantSigned());
    mockLeases.ownerSign.mockResolvedValue(owned({ stage: 'signed', tenant_signature: SIGNATURE, owner_signature: SIGNATURE, actions: { ...NONE, activate: true } }));
    mockLeases.activate.mockRejectedValue(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<OwnerLeaseView leaseId="lease-1" />);

    await sign(view);

    expect(textOf(view)).toContain('The service is temporarily unavailable. Please try again.');
    expect(getByName(view, 'button', 'Activate the lease')).toBeTruthy();
  });

  it('says when a lease is not theirs to open', async () => {
    mockLeases.get.mockRejectedValue(new ApiError(404, 'Lease not found.'));

    const view = await render(<OwnerLeaseView leaseId="other" />);

    expect(textOf(view)).toContain('Lease not found');
  });
});
