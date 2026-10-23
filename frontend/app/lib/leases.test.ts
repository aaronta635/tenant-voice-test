import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, ApiError } from './api';
import { addToDate, leasesApi, previewBlob, rentText, stageLabel, stepsDone, type LeaseForm } from './leases';

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const FORM: LeaseForm = {
  title: 'Residential tenancy agreement', bond_amount: 2600, payment_details: null, max_occupants: 2,
  pets_allowed: false, utilities: null, special_conditions: 'No smoking inside.',
};

describe('the lease API', () => {
  it('sends each step to its route with the body the backend reads', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ id: 'lease-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await leasesApi.create({
      application_id: 'app-1', rent_amount: 650, rent_frequency: 'WEEKLY', start_date: '2026-11-15',
      first_due_date: '2026-11-15', end_date: null,
    });
    await leasesApi.preview('lease-1', FORM);
    await leasesApi.send('lease-1', FORM, 'a'.repeat(64));
    await leasesApi.confirm('lease-1', 'doc-1');
    await leasesApi.sign('lease-1', 'doc-1', 'Tanya Tenant');
    await leasesApi.ownerSign('lease-1', 'Olivia Owner');
    await leasesApi.activate('lease-1');

    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.body && JSON.parse(init.body)]);
    expect(calls).toEqual([
      [`${API_BASE}/leases`, 'POST', expect.objectContaining({ application_id: 'app-1', rent_amount: 650, end_date: null })],
      [`${API_BASE}/leases/lease-1/document/preview`, 'POST', FORM],
      [`${API_BASE}/leases/lease-1/document`, 'POST', { ...FORM, preview_sha256: 'a'.repeat(64) }],
      [`${API_BASE}/leases/lease-1/confirm`, 'POST', { document_id: 'doc-1' }],
      [`${API_BASE}/leases/lease-1/sign`, 'POST', { document_id: 'doc-1', signer_name: 'Tanya Tenant', agree: true }],
      [`${API_BASE}/leases/lease-1/owner-signature`, 'POST', { signer_name: 'Olivia Owner', agree: true }],
      [`${API_BASE}/leases/lease-1/activate`, 'POST', undefined],
    ]);
  });

  it('uploads a PDF as multipart', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: 'lease-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await leasesApi.upload('lease-1', new File(['%PDF-1.4'], 'lease.pdf', { type: 'application/pdf' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/leases/lease-1/document/upload`);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('reads the PDF from the backend, never from a Storage link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['%PDF-1.4']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const blob = await leasesApi.pdf('lease-1', 'doc-1');

    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/leases/lease-1/documents/doc-1/file`);
    expect(await blob.text()).toBe('%PDF-1.4');
  });

  it("gives an older PDF's answer as the server worded it", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: 'A newer lease PDF replaced this one. Open the latest version.' }, 410)));

    const refused = leasesApi.pdf('lease-1', 'old');

    await expect(refused).rejects.toBeInstanceOf(ApiError);
    await expect(refused).rejects.toMatchObject({ status: 410, message: 'A newer lease PDF replaced this one. Open the latest version.' });
  });
});

describe('lease wording', () => {
  it('says the rent with its period', () => {
    expect(rentText(650, 'WEEKLY')).toBe('$650 a week');
    expect(rentText(2816.5, 'MONTHLY')).toBe('$2,816.50 a month');
  });

  it('names each stage for whoever is looking', () => {
    expect(stageLabel('review', 'owner')).toBe('Sent: the tenant is reviewing it');
    expect(stageLabel('review', 'tenant')).toBe('Ready for you to review');
    expect(stageLabel('tenant_signed', 'tenant')).toBe('Signed by you: waiting for the owner');
  });

  it('counts a lease as signed only once the server says both signed', () => {
    expect(stepsDone({ stage: 'tenant_signed' })).toBe(4);
    expect(stepsDone({ stage: 'signed' })).toBe(5);
    expect(stepsDone({ stage: 'active' })).toBe(6);
  });

  it('works out an end date a term after the start', () => {
    expect(addToDate('2026-11-15', { months: 12, days: -1 })).toBe('2027-11-14');
    expect(addToDate('2026-01-31', { months: 1 })).toBe('2026-02-28');
  });

  it("turns a preview's base64 into its PDF", async () => {
    const blob = previewBlob({ sha256: 'x', filename: 'lease.pdf', size: 8, pdf_base64: btoa('%PDF-1.4') });

    expect(blob.type).toBe('application/pdf');
    expect(await blob.text()).toBe('%PDF-1.4');
  });
});
