import { cleanup, click, descendants, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ListingStatus, type Property } from '@/app/lib/api';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import PropertyListingsPage from './page';

const navigation = vi.hoisted(() => ({ page: null as FakeHistory | null }));
const mockApi = vi.hoisted(() => ({ properties: { listMine: vi.fn() } }));

vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useSearchParams: () => {
      const search = useSyncExternalStore(
        (listener) => navigation.page?.subscribe(listener) ?? (() => {}),
        () => navigation.page?.search ?? '',
      );
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
// next/image needs the Next runtime; a plain img shows the same source.
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/app/lib/api')>()), api: mockApi }));

function listing(id: string, listingStatus: ListingStatus, over: Partial<Property> = {}): Property {
  return {
    id, owner_id: 'owner-1', title: `Home ${id}`, description: null, address: `${id} Harbour Street, Wollongong, NSW, 2500`,
    street_address: `${id} Harbour Street`, suburb: 'Wollongong', state: 'NSW', postcode: '2500', property_type: 'apartment',
    bedrooms: 2, bathrooms: 1, parking: 1, price: 650, bond: null, lease_term: null, available_from: null, amenities: [],
    photo_urls: [], status: 'available', listing_status: listingStatus, rating_avg: 0, review_count: 0,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', application_count: 0, new_application_count: 0,
    ...over,
  };
}

const LISTINGS = [
  listing('a', 'published', { application_count: 3, new_application_count: 1 }),
  listing('b', 'applications_closed'),
  listing('c', 'paused'),
  listing('d', 'draft'),
  listing('e', 'leased', { application_count: 1 }),
];

let leavePage = () => {};
async function open(href = '/owner/properties') {
  const page = createFakeHistory(href);
  leavePage = page.install(window);
  navigation.page = page;
  const view = await render(<PropertyListingsPage />);
  return { page, view };
}

const cards = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'ARTICLE');
const titles = (view: FakeElement) => cards(view).map((card) => textOf(descendants(card).find((element) => element.tagName === 'H2') as FakeElement));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockApi.properties.listMine.mockResolvedValue(LISTINGS);
});
afterEach(async () => {
  await cleanup();
  leavePage();
  navigation.page = null;
  vi.unstubAllGlobals();
});

describe('the owner listings page', () => {
  it('names each listing’s status and its applications, with where to manage, edit and view it', async () => {
    const { view } = await open();

    expect(titles(view)).toEqual(['Home a', 'Home b', 'Home c', 'Home d', 'Home e']);
    const [published, closed, paused] = cards(view);
    expect(textOf(published)).toContain('Published');
    expect(textOf(published)).toContain('3 applications · 1 new');
    expect(textOf(closed)).toContain('Applications closed');
    expect(textOf(paused)).toContain('No applications yet');
    expect(getByName(published, 'a', 'Edit Home a').getAttribute('href')).toBe('/owner/properties/a/edit');
    expect(getByName(published, 'a', 'Manage Home a').getAttribute('href')).toBe('/owner/properties/a');
    // Only a listing anyone may open has a public page.
    expect(getByName(closed, 'a', 'View the public page of Home b').getAttribute('href')).toBe('/properties/b');
    expect(descendants(paused).filter((element) => textOf(element) === 'View public page')).toEqual([]);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('filters by status, with a count on each, and keeps the filter in the address', async () => {
    const { page, view } = await open();

    expect(descendants(view).filter((element) => element.getAttribute('aria-pressed') !== null).map(textOf)).toEqual([
      'All (5)', 'Published (1)', 'Applications closed (1)', 'Paused (1)', 'Draft (1)', 'Leased (1)',
    ]);
    await click(getByName(view, 'button', 'Paused (1)'));
    await act(async () => { page.land(); });
    await settle();

    expect(page.stack()).toEqual(['>/owner/properties?status=paused']);
    expect(titles(view)).toEqual(['Home c']);
    expect(getByName(view, 'button', 'Paused (1)').getAttribute('aria-pressed')).toBe('true');
  });

  it('opens on the status a link names', async () => {
    const { view } = await open('/owner/properties?status=leased');

    expect(titles(view)).toEqual(['Home e']);
  });

  it('says when nothing has the chosen status', async () => {
    mockApi.properties.listMine.mockResolvedValue([listing('a', 'published')]);
    const { view } = await open('/owner/properties?status=draft');

    expect(textOf(view)).toContain('You have no draft listings.');
  });

  it('shows the loading, empty and error states, and retries', async () => {
    mockApi.properties.listMine.mockReturnValueOnce(new Promise(() => {}));
    const loading = await open();
    expect(textOf(loading.view)).toContain('Loading your properties…');
    await cleanup();
    leavePage();

    mockApi.properties.listMine.mockResolvedValueOnce([]);
    const empty = await open();
    expect(textOf(empty.view)).toContain('No properties yet');
    expect(getByName(empty.view, 'a', 'Add your first property').getAttribute('href')).toBe('/owner/properties/create');
    await cleanup();
    leavePage();

    mockApi.properties.listMine.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const failed = await open();
    expect(textOf(failed.view)).toContain('The service is temporarily unavailable.');
    await click(getByName(failed.view, 'button', 'Try again'));
    expect(titles(failed.view)).toHaveLength(5);
  });
});
