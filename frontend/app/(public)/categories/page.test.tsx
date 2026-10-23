import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Category, type ProviderFilters, type PublicProvider } from '@/app/lib/api';
import { renderMarkup } from '@/app/test-utils/static-markup';
import CategoriesIndexPage from './page';

const data = vi.hoisted(() => ({ categories: [] as Category[], providers: [] as PublicProvider[], providersError: null as Error | null, query: '' }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    categories: { list: async () => data.categories },
    providers: {
      // Like GET /providers: at most 100 rows a request, from `offset`.
      listPublic: async ({ limit = 20, offset = 0 }: ProviderFilters = {}) => {
        if (data.providersError) throw data.providersError;
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
  usePathname: () => '/categories',
  useSearchParams: () => new URLSearchParams(data.query),
}));

function category(slug: string, name: string): Category {
  return { slug, category: slug, name, description: `${name} near you.`, icon_bg: null, badge: null, sort_order: 1, provider_count: 1, from_price: 99 };
}

function provider(rank: number, location: string): PublicProvider {
  return {
    id: `p${rank}`, slug: `provider-${rank}`, business_name: `Provider ${rank}`, tagline: null, headline: null, specialties: [], verifications: [],
    availability_note: null, rating_avg: 4, review_count: 1, from_price: 120, price_unit: 'fixed', category_name: 'Tradies', service_count: 1,
    profiles: { full_name: `Provider ${rank}`, avatar_url: null, location, state: 'NSW', postcode: null, phone: null },
  } as unknown as PublicProvider;
}

async function categoriesPage(query: Record<string, string> = {}) {
  data.query = new URLSearchParams(query).toString();
  return renderMarkup(await CategoriesIndexPage({ searchParams: Promise.resolve(query) }));
}

beforeEach(() => {
  data.categories = [category('tradies', 'Tradies'), category('co-host-inspector', 'Co-Host Inspector')];
  data.providers = [];
  data.providersError = null;
});

describe('categories index headings', () => {
  it('titles each category card one level below the page heading', async () => {
    expect((await categoriesPage()).headings).toEqual(['h1 Every service category', 'h2 Tradies', 'h2 Co-Host Inspector']);
  });
});

describe('provider search failure', () => {
  it('keeps the page heading and a way back to the categories', async () => {
    data.providersError = new ApiError(500, 'Internal Server Error');
    const { headings, links } = await categoriesPage({ location: 'Sydney' });
    expect(headings).toEqual(['h1 Find providers', "h2 Couldn't load providers"]);
    expect(links).toContainEqual({ href: '/categories', text: 'All categories' });
  });
});

describe('all-categories provider search', () => {
  it('searches every published provider, not only the 100 highest rated', async () => {
    data.providers = Array.from({ length: 150 }, (_, index) => provider(index + 1, index + 1 === 120 ? 'Parramatta' : 'Newtown'));
    const { links, text } = await categoriesPage({ location: 'Parramatta' });
    expect(text).toContain('1 of 150 providers matching Parramatta');
    expect(links.some((link) => new URL(link.href, 'https://tenantvoice.invalid').pathname === '/providers/provider-120')).toBe(true);
  });
});
