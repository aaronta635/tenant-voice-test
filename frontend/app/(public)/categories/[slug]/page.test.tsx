import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Category, type ProviderFilters, type PublicProvider } from '@/app/lib/api';
import { renderMarkup } from '@/app/test-utils/static-markup';
import CategoryListingPage from './page';

const data = vi.hoisted(() => ({ categoryError: null as Error | null, providers: [] as PublicProvider[], calls: [] as ProviderFilters[], query: '' }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    categories: {
      get: async (slug: string): Promise<Category> => {
        if (data.categoryError) throw data.categoryError;
        return { slug, category: 'tradie', name: 'Tradies', description: 'Licensed trades.', icon_bg: null, badge: null, sort_order: 1, provider_count: data.providers.length, from_price: 120 };
      },
    },
    providers: {
      // Like GET /providers: at most 100 rows a request, from `offset`.
      listPublic: async (filters: ProviderFilters = {}) => {
        data.calls.push(filters);
        const { limit = 20, offset = 0 } = filters;
        return data.providers.slice(offset, offset + Math.min(limit, 100));
      },
    },
  },
}));
vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getRoleHomeHref: async () => '/',
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => '/categories/tradies',
  useSearchParams: () => new URLSearchParams(data.query),
}));

function provider(rank: number, location: string): PublicProvider {
  return {
    id: `p${rank}`, slug: `provider-${rank}`, business_name: `Provider ${rank}`, tagline: null, headline: null, specialties: [], verifications: [],
    availability_note: null, rating_avg: 4, review_count: 1, from_price: 120, price_unit: 'fixed', category_name: 'Tradies', service_count: 1,
    profiles: { full_name: `Provider ${rank}`, avatar_url: null, location, state: 'NSW', postcode: null, phone: null },
  } as unknown as PublicProvider;
}

async function listingPage(query = '') {
  data.query = query;
  return renderMarkup(await CategoryListingPage({ params: Promise.resolve({ slug: 'tradies' }) }));
}

beforeEach(() => {
  data.categoryError = null;
  data.providers = [];
  data.calls = [];
});

describe('category load failure', () => {
  it('keeps a page heading and a way back to the categories', async () => {
    data.categoryError = new ApiError(500, 'Internal Server Error');
    const { headings, links } = await listingPage();
    expect(headings).toEqual(['h1 Provider category', "h2 Couldn't load this category"]);
    expect(links).toContainEqual({ href: '/categories', text: 'All categories' });
  });
});

describe('category provider listing', () => {
  it('lists and counts every provider in the category, not only the first 100', async () => {
    data.providers = Array.from({ length: 130 }, (_, index) => provider(index + 1, index + 1 === 110 ? 'Parramatta' : 'Newtown'));
    const { links, text } = await listingPage('location=Parramatta');
    expect(text).toContain('1 of 130 providers matching Parramatta');
    expect(links.some((link) => new URL(link.href, 'https://tenantvoice.invalid').pathname === '/providers/provider-110')).toBe(true);
    expect(data.calls.every((filters) => filters.category === 'tradies')).toBe(true);
  });
});
