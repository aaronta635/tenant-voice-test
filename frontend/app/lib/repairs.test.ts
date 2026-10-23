import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./api', () => http);

import { photoProblem, repairNextStep, repairs, reportProblem, type Repair } from './repairs';

beforeEach(() => http.apiFetch.mockReset().mockResolvedValue({}));

const repair = {
  id: 'r1', status: 'open', provider_name: null, appointment_at: null, tenant_rating: null,
} as Repair;

describe('the repairs API', () => {
  it('calls each step of the shared repair flow', async () => {
    await repairs.list();
    await repairs.homes();
    await repairs.create({
      property_id: 'l1', title: 'Burst pipe', description: 'Water through the ceiling.', category: 'PLUMBING',
      priority: 'urgent', photos: ['u1/a.png'], access_notes: null,
    });
    await repairs.providers('r1');
    await repairs.assign('r1', 'p1');
    await repairs.resolve('r1', null);
    await repairs.confirm('r1', 5);
    await repairs.rate('r1', 4);

    expect(http.apiFetch.mock.calls).toEqual([
      ['/maintenance'],
      ['/maintenance/homes'],
      ['/maintenance', { method: 'POST', body: {
        property_id: 'l1', title: 'Burst pipe', description: 'Water through the ceiling.', category: 'PLUMBING',
        priority: 'urgent', photos: ['u1/a.png'], access_notes: null,
      } }],
      ['/maintenance/r1/providers'],
      ['/maintenance/r1/assign', { method: 'POST', body: { provider_id: 'p1' } }],
      ['/maintenance/r1/resolve', { method: 'POST', body: { note: null } }],
      ['/maintenance/r1/confirm', { method: 'POST', body: { rating: 5 } }],
      ['/maintenance/r1/rate', { method: 'POST', body: { rating: 4 } }],
    ]);
  });

  it('uploads a photo as multipart', async () => {
    const file = new File(['x'], 'ceiling.png', { type: 'image/png' });
    await repairs.uploadPhoto(file);

    const [path, options] = http.apiFetch.mock.calls[0];
    expect(path).toBe('/maintenance/photos');
    expect(options.method).toBe('POST');
    expect((options.formData as FormData).get('file')).toBe(file);
  });
});

describe('what a report needs', () => {
  it('checks what mobile_repair_insert checks', () => {
    const report = { property_id: 'l1', title: 'Burst pipe', description: 'Water through the ceiling.' };
    expect(reportProblem(report)).toBeNull();
    expect(reportProblem({ ...report, property_id: '' })).toBe('Choose the home this repair is for.');
    expect(reportProblem({ ...report, title: ' ' })).toContain('120 characters');
    expect(reportProblem({ ...report, title: 'x'.repeat(121) })).toContain('120 characters');
    expect(reportProblem({ ...report, description: 'Leak' })).toContain('5 to 2000');
  });

  it('takes up to four photos of 5 MB, as the bucket does', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    expect(photoProblem(png, 0)).toBeNull();
    expect(photoProblem(png, 4)).toBe('You can attach up to 4 photos.');
    expect(photoProblem(new File(['x'], 'a.gif', { type: 'image/gif' }), 0)).toBe('Add a JPEG, PNG or WebP photo.');
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' });
    expect(photoProblem(big, 0)).toBe('Each photo can be up to 5 MB.');
  });
});

describe('the next step', () => {
  it('says whose turn it is', () => {
    expect(repairNextStep(repair, 'owner')).toBe('Assign a provider who covers this repair.');
    expect(repairNextStep(repair, 'tenant')).toBe('Waiting for the owner to assign a provider.');
    expect(repairNextStep({ ...repair, status: 'in_progress', provider_name: 'Pat' }, 'tenant')).toBe('Waiting for Pat to book the visit.');
    expect(repairNextStep({ ...repair, status: 'awaiting_confirmation' }, 'tenant')).toBe('The provider marked it done. Confirm it with a rating.');
    expect(repairNextStep({ ...repair, status: 'awaiting_confirmation' }, 'owner')).toBe('Done. Waiting for the tenant to confirm it.');
    expect(repairNextStep({ ...repair, status: 'resolved', tenant_rating: 4 }, 'owner')).toBe('Resolved. Rated 4 out of 5.');
  });
});
