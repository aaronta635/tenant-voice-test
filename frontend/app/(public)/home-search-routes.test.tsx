import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicProvider } from '@/app/lib/api';
import { searchHref, type SearchType } from '@/app/lib/home-search';
import { componentNamed, find } from '@/app/test-utils/shallow-render';
import { renderMarkup } from '@/app/test-utils/static-markup';
import CategoriesIndexPage from './categories/page';
import PublicPropertiesPage from './properties/page';

// Each homepage search type opens a page that already lists that data; these
// tests open those pages with the URLs the homepage builds.
const data = vi.hoisted(() => ({ providers: [] as PublicProvider[], query: '' }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    categories: { list: async () => [] },
    providers: { listPublic: async ({ offset = 0 }: { offset?: number } = {}) => (offset ? [] : data.providers) },
  },
}));
vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getRoleHomeHref: async () => '/',
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => '/categories',
  useSearchParams: () => new URLSearchParams(data.query),
}));
// The listings load client-side; the page only hands them the query.
vi.mock('@/app/components/rental/PropertyMarketplace', () => ({ default: function PropertyMarketplace() { return null; } }));

function provider(name: string, headline: string): PublicProvider {
  return {
    id: name, slug: name.toLowerCase().replace(/\s+/g, '-'), business_name: name, tagline: null, headline, specialties: [], verifications: [],
    availability_note: null, rating_avg: 4, review_count: 1, from_price: 120, price_unit: 'fixed', category_name: 'Cleaning', service_count: 1,
    profiles: { full_name: name, avatar_url: null, location: 'Newtown', state: 'NSW', postcode: null, phone: null },
  } as unknown as PublicProvider;
}

/** The homepage's URL for this search, as the path and the query the page receives. */
function opened(type: SearchType, text: string) {
  const url = new URL(searchHref(type, text), 'https://tenantvoice.test');
  data.query = url.search.slice(1);
  return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
}

beforeEach(() => {
  data.providers = [provider('Harbour Cleans', 'Bond cleans across the inner west'), provider('Sparks Electrical', 'Licensed electrician')];
});

describe('a homepage properties search', () => {
  it('opens the rentals page with its text as the listing search', async () => {
    const { path, query } = opened('properties', 'Newtown');
    expect(path).toBe('/properties');
    const page = await PublicPropertiesPage({ searchParams: Promise.resolve(query) });
    expect(find(page, componentNamed('PropertyMarketplace')).props.initialQuery).toBe('Newtown');
  });

  it('searches the first text when a link repeats it, instead of failing', async () => {
    const page = await PublicPropertiesPage({ searchParams: Promise.resolve({ q: ['Newtown', 'Glebe'] }) });
    expect(find(page, componentNamed('PropertyMarketplace')).props.initialQuery).toBe('Newtown');
  });

  it('opens the rentals page unfiltered without text', async () => {
    const { query } = opened('properties', '');
    const page = await PublicPropertiesPage({ searchParams: Promise.resolve(query) });
    expect(find(page, componentNamed('PropertyMarketplace')).props.initialQuery).toBe('');
  });
});

describe('a homepage services search', () => {
  it('opens the provider marketplace listing only the providers that match', async () => {
    const { path, query } = opened('services', 'bond clean');
    expect(path).toBe('/categories');
    const { text } = renderMarkup(await CategoriesIndexPage({ searchParams: Promise.resolve(query) }));
    expect(text).toContain('Harbour Cleans');
    expect(text).not.toContain('Sparks Electrical');
  });
});
