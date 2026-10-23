import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, friendlyApiError } from './api';
import { refusalOf, verificationRequired } from './verification-gate';

const refusal = {
  code: 'verification_required',
  action: 'accept_booking',
  status: 'pending',
  message: 'Your account needs to be verified before you can accept bookings. Upload the documents it asks for, or wait for the review to finish.',
  documents_href: '/dashboard/profile#verification-documents',
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('a verification gate refusal', () => {
  it('reaches the page from a 403 response with its sentence as the error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: refusal }), { status: 403 })));

    const error: unknown = await apiFetch('/bookings/b1', { method: 'PATCH', body: { status: 'confirmed' }, auth: false })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(refusal.message);
    expect(verificationRequired(error)).toEqual(refusal);
  });

  it('is recognised only on a 403 with the gate code and a sentence', () => {
    expect(verificationRequired(new ApiError(403, 'x', refusal))).toEqual(refusal);
    expect(verificationRequired(new ApiError(400, 'x', refusal))).toBeNull();
    expect(verificationRequired(new ApiError(403, 'You do not have access to this resource', 'You do not have access to this resource'))).toBeNull();
    expect(verificationRequired(new ApiError(403, 'x', { ...refusal, code: 'forbidden' }))).toBeNull();
    expect(verificationRequired(new ApiError(403, 'x', { ...refusal, message: ' ' }))).toBeNull();
    expect(verificationRequired(new ApiError(403, 'x'))).toBeNull();
    expect(verificationRequired(new Error('offline'))).toBeNull();
    expect(verificationRequired(null)).toBeNull();
  });

  it('keeps a documents link only when it is a path on this site', () => {
    const href = (documents_href: unknown) => verificationRequired(new ApiError(403, 'x', { ...refusal, documents_href }))?.documents_href;

    expect(href('/tenant/id-verification')).toBe('/tenant/id-verification');
    expect(href(null)).toBeNull();
    expect(href('https://elsewhere.example/documents')).toBeNull();
    expect(href('//elsewhere.example/documents')).toBeNull();
    expect(href('/\\elsewhere.example')).toBeNull();
    expect(href('javascript:alert(1)')).toBeNull();
  });

  it('is read the same way from a response that answered without the action', () => {
    const paidAi = { ...refusal, action: 'paid_ai', message: 'Your account needs to be verified before you can use AI features.' };

    expect(refusalOf(paidAi)).toEqual(paidAi);
    expect(refusalOf({ ...paidAi, documents_href: 'https://elsewhere.example/documents' })?.documents_href).toBeNull();
    expect(refusalOf({ ...paidAi, code: 'other' })).toBeNull();
    expect(refusalOf({ ...paidAi, message: '' })).toBeNull();
    expect(refusalOf(null)).toBeNull();
    expect(refusalOf(undefined)).toBeNull();
    expect(refusalOf('verification_required')).toBeNull();
  });

  it('gives its sentence wherever a page shows the error message alone', () => {
    expect(friendlyApiError(403, { detail: refusal })).toBe(refusal.message);
    expect(friendlyApiError(403, { detail: { ...refusal, message: '<b>x</b>' } })).toBe('You do not have access to this action.');
    expect(friendlyApiError(403, { detail: { code: 'other' } })).toBe('You do not have access to this action.');
  });
});
