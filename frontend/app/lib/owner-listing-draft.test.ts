import { describe, expect, it } from 'vitest';
import { draftToPropertyInput, uploadedPhotos, type ListingDraft } from './owner-listing-draft';

const PHOTO = 'https://example.supabase.co/storage/v1/object/public/property-images/owner/a.jpg';
const complete: ListingDraft = {
  title: 'Harbour flat', address: '1 Harbour Street', suburb: 'Wollongong', state: 'NSW', postcode: '2500',
  price: '650', photo_urls: [PHOTO],
};

describe('draftToPropertyInput', () => {
  it('sends the suburb, state and postcode the listing needs', () => {
    const result = draftToPropertyInput({ ...complete, suburb: ' Wollongong ' });

    expect(result).toEqual({ input: expect.objectContaining({ suburb: 'Wollongong', state: 'NSW', postcode: '2500' }) });
  });

  it.each(['suburb', 'state', 'postcode'] as const)('asks for the %s before publishing', (field) => {
    expect(draftToPropertyInput({ ...complete, [field]: '  ' })).toEqual({ error: 'City, state and postcode are required.' });
  });

  it('sends only uploaded photo links', () => {
    const result = draftToPropertyInput({ ...complete, photo_urls: ['data:image/png;base64,iVBORw0KGgo=', PHOTO] });

    expect(result).toEqual({ input: expect.objectContaining({ photo_urls: [PHOTO] }) });
    expect(draftToPropertyInput({ ...complete, photo_urls: ['data:image/png;base64,iVBORw0KGgo='] }))
      .toEqual({ input: expect.objectContaining({ photo_urls: null }) });
  });
});

describe('uploadedPhotos', () => {
  it('keeps http(s) links and drops inline data', () => {
    expect(uploadedPhotos(['data:image/jpeg;base64,/9j/', PHOTO, 'http://localhost/a.png'])).toEqual([
      PHOTO, 'http://localhost/a.png',
    ]);
    expect(uploadedPhotos(undefined)).toEqual([]);
  });
});
