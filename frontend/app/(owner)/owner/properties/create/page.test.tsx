import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { field } from '@/app/test-utils/onboarding';
import { IMPORTED } from '@/app/test-utils/listing-import';
import CreateListingPropertyDetailsPage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const DRAFT_KEY = 'tv_listing_draft';
const fetchMock = vi.fn();

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const forms = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'FORM');

async function importLink(view: FakeElement) {
  await click(getByName(view, 'button', 'Import from a link or PDF'));
  await typeInto(field(view, 'Listing link'), 'https://coast.example/listings/1');
  await dispatch(forms(view)[0], 'submit');
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('sessionStorage', memoryStorage());
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the first step of a new listing', () => {
  it('fills its form from an import the owner confirms, and the later steps from the draft', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(IMPORTED), { status: 200 }));
    const view = await render(<CreateListingPropertyDetailsPage />);
    await typeInto(field(view, 'Bathrooms'), '3');

    await importLink(view);
    // Nothing is in the form until the owner confirms.
    expect(field(view, 'Listing Title').value).toBe('');
    await click(getByName(view, 'button', 'Use these details'));
    await settle();

    expect([
      field(view, 'Listing Title').value, field(view, 'Property Address').value, field(view, 'City').value,
      field(view, 'State').value, field(view, 'Postcode').value, field(view, 'Property Type').value,
      field(view, 'Bedrooms').value, field(view, 'Bathrooms').value,
    ]).toEqual(['Harbour flat', '4/1 Harbour Street', 'Wollongong', 'NSW', '2500', 'Apartment', '2', '1']);
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}')).toMatchObject({
      price: '650', available_from: '2026-12-01', description: 'A bright flat by the harbour.',
      amenities: ['Balcony', 'Pet friendly'],
    });
    expect(textOf(view)).toContain('Imported from coast.example');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('keeps what the owner typed when an import fails, and the form still continues', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      detail: { code: 'not_a_listing', message: "We couldn't find a listing's details at that link." },
    }), { status: 422 }));
    const view = await render(<CreateListingPropertyDetailsPage />);
    await typeInto(field(view, 'Listing Title'), 'My flat');

    await importLink(view);

    expect(textOf(view)).toContain('No listing found there');
    expect(field(view, 'Listing Title').value).toBe('My flat');
    expect(field(view, 'Listing Title').hasAttribute('disabled')).toBe(false);
    await dispatch(forms(view)[1], 'submit');
    expect(router.push).toHaveBeenCalledWith('/owner/properties/create/photos');
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}').title).toBe('My flat');
  });
});
