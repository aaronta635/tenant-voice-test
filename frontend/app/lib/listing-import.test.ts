import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
  displayValue,
  fieldsWithValues,
  getImportSummary,
  importFailure,
  importedDraft,
  importListingFromPdf,
  importListingFromUrl,
  inputRefusal,
  linkToRead,
  pdfRefusal,
  saveImportSummary,
  summaryOf,
  type ListingImport,
} from './listing-import';
import { importedField as field, missingField as missing } from '@/app/test-utils/listing-import';

const RESULT: ListingImport = {
  kind: 'url', source_label: 'coast.example', source_url: 'https://coast.example/listings/1', demo: false,
  fields: {
    title: field('Harbour flat'), description: missing(), address: field('4/1 Harbour Street', 'inferred'),
    suburb: field('Wollongong', 'inferred'), state: field('NSW', 'inferred'), postcode: field('2500', 'inferred'),
    property_type: field('Apartment'), bedrooms: field(2), bathrooms: field(1, 'found', '1 bath', 'text'),
    price: field(650.5, 'found', '$650.50 pw', 'text'), bond: missing(), lease_term: field('12 months'),
    available_from: field('2026-12-01'), amenities: field(['Balcony', 'Dishwasher']), pets_allowed: field(true),
    floor_area: field(78),
  },
  counts: { found: 10, inferred: 4, missing: 2 },
  ai_status: 'not_requested', message: null, verification: null,
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

describe('the import requests', () => {
  it('sends a link and the AI choice as JSON, and a PDF as a form', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(RESULT), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await importListingFromUrl('https://coast.example/listings/1', true);
    await importListingFromPdf(new File([new Uint8Array(4)], 'listing.pdf', { type: 'application/pdf' }), false);

    const [[url, sent], [pdfUrl, pdfSent]] = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(url).toMatch(/\/me\/listing-imports\/url$/);
    expect(sent.method).toBe('POST');
    expect(JSON.parse(sent.body as string)).toEqual({ url: 'https://coast.example/listings/1', use_ai: true });
    expect(pdfUrl).toMatch(/\/me\/listing-imports\/pdf$/);
    const form = pdfSent.body as FormData;
    expect((form.get('file') as File).name).toBe('listing.pdf');
    expect(form.get('use_ai')).toBe('false');
  });

  it('takes a link without a scheme as https, and leaves any other as it is for the server to refuse', () => {
    expect(linkToRead('  www.coast.example/listings/1 ')).toBe('https://www.coast.example/listings/1');
    expect(linkToRead('http://coast.example/1')).toBe('http://coast.example/1');
    expect(linkToRead('javascript:alert(1)')).toBe('javascript:alert(1)');
  });
});

describe('importFailure', () => {
  it("shows the server's reason, by its code", () => {
    const failure = importFailure(new ApiError(504, 'x', { code: 'timeout', message: 'That site took too long to answer.' }));

    expect(failure).toEqual({ code: 'timeout', title: 'The site took too long', message: 'That site took too long to answer.', sample: null });
  });

  it('keeps the sample a refusing site offers', () => {
    const sample = { ...RESULT, kind: 'sample' as const, demo: true, source_label: 'Sample listing' };
    const failure = importFailure(new ApiError(422, 'x', { code: 'blocked', message: "realestate.com.au doesn't let other sites read its listings.", sample }));

    expect(failure.code).toBe('blocked');
    expect(failure.title).toBe("This site doesn't allow imports");
    expect(failure.sample).toEqual(sample);
  });

  it('says what a refusal before the import says, or a general reason', () => {
    expect(importFailure(new ApiError(403, 'You do not have access to this action.'))).toMatchObject({
      code: 'other', message: 'You do not have access to this action.',
    });
    expect(importFailure(new Error('boom'))).toMatchObject({ code: 'other', message: 'Try again, or type the details below.' });
    expect(importFailure(new ApiError(422, 'x', { code: 'not_a_listing', message: '<b>no</b>' })).message).toBe(
      "We couldn't find a listing's details. Check the link opens the listing itself, or type the details below.",
    );
    expect(importFailure(new ApiError(413, 'x', { code: 'something_new', message: 'Hm.' })).code).toBe('other');
    expect(importFailure(new ApiError(429, 'x', { code: 'busy', message: 'An import you started is still running.' }))).toMatchObject({
      code: 'busy', title: 'An import is still running',
    });
  });
});

describe('the checks before anything is sent', () => {
  it('asks for a link or a file', () => {
    expect(inputRefusal('url', '  ', null)?.code).toBe('invalid_url');
    expect(inputRefusal('url', 'coast.example/1', null)).toBeNull();
    expect(inputRefusal('pdf', '', null)?.code).toBe('invalid_file');
  });

  it('refuses a file that is no PDF or over 10 MB', () => {
    expect(pdfRefusal(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))?.code).toBe('unsupported_content');
    expect(pdfRefusal(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' }))?.code).toBe('too_large');
    expect(pdfRefusal(new File(['%PDF'], 'listing.PDF', { type: '' }))).toBeNull();
  });
});

describe('importedDraft', () => {
  it('fills the draft with the kept fields, numbers as the form holds them', () => {
    expect(importedDraft(RESULT, fieldsWithValues(RESULT), {})).toEqual({
      title: 'Harbour flat', address: '4/1 Harbour Street', suburb: 'Wollongong', state: 'NSW', postcode: '2500',
      property_type: 'Apartment', bedrooms: '2', bathrooms: '1', price: '650.5', lease_term: '12 months',
      available_from: '2026-12-01', amenities: ['Balcony', 'Dishwasher', 'Pet friendly', 'Floor area 78 m²'],
    });
  });

  it('leaves out the fields the owner unticked and those the listing did not give', () => {
    const patch = importedDraft(RESULT, ['title', 'bond', 'description', 'price'], { title: 'Mine', bond: '2600' });

    expect(patch).toEqual({ title: 'Harbour flat', price: '650.5' });
  });

  it("adds the imported amenities after the draft's own, once each, up to what a listing keeps", () => {
    const own = Array.from({ length: 38 }, (_, index) => `Feature ${index}`);
    const patch = importedDraft(RESULT, ['amenities', 'pets_allowed', 'floor_area'], { amenities: [...own, 'balcony'] });

    expect(patch.amenities).toHaveLength(40);
    expect(patch.amenities?.slice(-2)).toEqual(['balcony', 'Dishwasher']);
  });

  it('adds no amenity for pets that are not allowed', () => {
    const result: ListingImport = { ...RESULT, fields: { ...RESULT.fields, pets_allowed: field(false), amenities: missing(), floor_area: missing() } };

    expect(importedDraft(result, fieldsWithValues(result), {}).amenities).toBeUndefined();
  });
});

describe('what the review shows', () => {
  it('shows each kind of value in words', () => {
    expect(displayValue('price', RESULT.fields)).toBe('$650.50 a week');
    expect(displayValue('available_from', RESULT.fields)).toBe('1 Dec 2026');
    expect(displayValue('amenities', RESULT.fields)).toBe('Balcony, Dishwasher');
    expect(displayValue('pets_allowed', RESULT.fields)).toBe('Allowed: adds "Pet friendly" to the amenities');
    expect(displayValue('floor_area', RESULT.fields)).toBe('78 m²: adds "Floor area 78 m²" to the amenities');
    expect(displayValue('bond', RESULT.fields)).toBe('');
  });
});

describe('the import summary', () => {
  it('is kept while its draft is in progress, and dropped once the draft is gone', () => {
    // The draft is the browser's (lib/owner-listing-draft).
    vi.stubGlobal('window', {});
    saveImportSummary(summaryOf(RESULT, ['title']));
    expect(getImportSummary()).toBeNull();

    sessionStorage.setItem('tv_listing_draft', JSON.stringify({ title: 'Harbour flat' }));
    saveImportSummary(summaryOf(RESULT, ['title', 'bond']));
    const summary = getImportSummary();
    expect(summary?.fields.find((entry) => entry.key === 'title')).toEqual({ key: 'title', source: 'found', used: true });
    expect(summary?.fields.find((entry) => entry.key === 'bond')).toEqual({ key: 'bond', source: 'missing', used: false });
    expect(summary?.fields.find((entry) => entry.key === 'price')).toEqual({ key: 'price', source: 'found', used: false });

    sessionStorage.removeItem('tv_listing_draft');
    expect(getImportSummary()).toBeNull();
    expect(sessionStorage.getItem('tv_listing_import')).toBeNull();
  });
});
