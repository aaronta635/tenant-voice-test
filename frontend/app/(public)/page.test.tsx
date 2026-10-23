import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, PlatformStats, Property, PublicProvider } from '@/app/lib/api';
import { PROVIDER_MARKETPLACE_HREF } from '@/app/lib/home-search';
import type { SessionRole } from '@/app/lib/session-role';
import { prerenderMarkup, renderMarkup } from '@/app/test-utils/static-markup';
import LandingPage from './page';

type Source<T> = () => Promise<T>;
const data = vi.hoisted(() => ({
  categories: (async () => []) as Source<Category[]>,
  providers: (async () => []) as Source<PublicProvider[]>,
  stats: (async () => null) as Source<PlatformStats | null>,
  listings: (async () => []) as Source<Property[]>,
  role: null as SessionRole | null,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    categories: { list: () => data.categories() },
    providers: { listPublic: () => data.providers() },
    content: { platformStats: () => data.stats() },
    properties: { listPublic: () => data.listings() },
  },
}));
vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getSessionRole: async () => data.role,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

function category(slug: string, name: string, badge: string | null = null): Category {
  return { slug, category: slug, name, description: `${name} near you.`, icon_bg: null, badge, sort_order: 1, provider_count: 1, from_price: 99 };
}

function provider(overrides: Partial<PublicProvider>): PublicProvider {
  return {
    id: 'p1', slug: 'amelia', business_name: 'Amelia Whitlock', category_name: 'Tradies', from_price: 85, price_unit: 'fixed',
    service_count: 2, rating_avg: 0, review_count: 0, verifications: [], availability_note: null,
    profiles: { full_name: 'Amelia Whitlock', avatar_url: null, location: 'Newtown', state: 'NSW', postcode: '2042', phone: null },
    ...overrides,
  } as PublicProvider;
}

function listing(overrides: Partial<Property> = {}): Property {
  return {
    id: 'prop-1', owner_id: 'owner-1', title: 'Sunny terrace near the park', description: null, address: '12 King St',
    suburb: 'Newtown', state: 'NSW', postcode: '2042', property_type: 'House', bedrooms: 3, bathrooms: 2, parking: 1,
    price: 820, bond: 3280, lease_term: '12 months', available_from: null, amenities: [], photo_urls: [], status: 'available',
    rating_avg: 0, review_count: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const sevenCategories = ['Inspectors', 'Agents', 'Tradies', 'Cleaners', 'Accountants', 'Legal', 'Other'].map((name) => category(name.toLowerCase(), name));
const never = () => new Promise<never>(() => {});
const fails = async (): Promise<never> => { throw new Error('Could not connect.'); };

/** The page once every section has streamed in. */
async function landing() {
  return prerenderMarkup(await LandingPage());
}

beforeEach(() => {
  data.categories = async () => sevenCategories;
  data.providers = async () => [];
  data.stats = async () => ({ verified_providers: 6, jobs_completed: 9, average_rating: 0, satisfaction_pct: 0, review_count: 0, category_count: 0 });
  data.listings = async () => [];
  data.role = null;
});

describe('landing heading', () => {
  it('has one heading for the whole platform, naming every kind of member', async () => {
    const { headings, text } = await landing();
    expect(headings.filter((heading) => heading.startsWith('h1'))).toEqual(['h1 Rent, list and maintain property with confidence.']);
    expect(text).toContain('One platform for tenants, landlords and service providers.');
  });
});

describe('landing search', () => {
  it('offers one search for profiles, services and properties instead of the provider-only form', async () => {
    const { html } = await landing();
    expect(html).toMatch(/<form[^>]*role="search"/);
    expect(html).not.toMatch(/<form[^>]*action="\/categories"/);
    expect([...html.matchAll(/<option[^>]*value="(\w+)"/g)].map(([, value]) => value)).toEqual(['profiles', 'services', 'properties']);
  });

  it('opens the provider marketplace from Find providers, as the header does', async () => {
    expect((await landing()).links).toContainEqual({ href: PROVIDER_MARKETPLACE_HREF, text: 'Find providers' });
  });

  it('renders the search at once while every section is still loading', async () => {
    data.categories = never; data.providers = never; data.stats = never; data.listings = never;
    const { html, text } = renderMarkup(await LandingPage());
    expect(html).toMatch(/<form[^>]*role="search"/);
    expect(text).toContain('Loading categories…');
    expect(text).toContain('Loading rentals…');
    expect(text).toContain('Loading platform figures…');
  });
});

describe('landing sections', () => {
  it('keeps the other sections when one source fails', async () => {
    data.categories = fails;
    data.listings = async () => [listing()];
    const { text } = await landing();
    expect(text).toContain("Couldn't load categories");
    expect(text).toContain('Sunny terrace near the park');
    expect(text).toContain('6 Verified providers Listed on TenantVoice');
  });

  it('says when no rentals or categories are listed yet', async () => {
    data.categories = async () => [];
    const { text } = await landing();
    expect(text).toContain('No categories yet');
    expect(text).toContain('No rentals listed yet');
  });

  it('says when the rentals cannot be loaded', async () => {
    data.listings = fails;
    expect((await landing()).text).toContain("Couldn't load rentals");
  });

  it('links each rental to its public page and shows the suburb, not the street address', async () => {
    data.listings = async () => [listing()];
    const { links, text } = await landing();
    expect(links.map((link) => link.href)).toContain('/properties/prop-1');
    expect(text).toContain('$820 per week');
    expect(text).toContain('Newtown NSW 2042');
    expect(text).not.toContain('12 King St');
  });

  it('counts one bedroom or bathroom in the singular and leaves blanks blank', async () => {
    data.listings = async () => [listing({ bedrooms: 1, bathrooms: null, parking: null })];
    expect((await landing()).text).toContain('1 bed · — baths · 0 parking');
  });
});

describe('landing calls to join', () => {
  it('asks visitors to join with the account type each card names', async () => {
    const { links } = await landing();
    expect(links).toEqual(expect.arrayContaining([
      { href: '/register?role=tenant', text: 'Join as a tenant' },
      { href: '/register?role=landlord', text: 'Join as a landlord' },
      { href: '/register?role=service_provider', text: 'Join as a provider' },
    ]));
  });

  it('never opens sign-up without an account type, which would start a provider account', async () => {
    const signUps = (await landing()).links.filter((link) => link.href.startsWith('/register'));
    // The role cards and the closing call to join each name all three.
    expect(signUps).toHaveLength(6);
    for (const { href } of signUps) {
      expect(['tenant', 'landlord', 'service_provider']).toContain(new URL(href, 'https://tenantvoice.test').searchParams.get('role'));
    }
  });

  it('does not ask a signed-in member to join', async () => {
    data.role = 'Client';
    const { links, text } = await landing();
    expect(links.map((link) => link.href).filter((href) => href.startsWith('/register'))).toEqual([]);
    expect(text).not.toContain('Join the rental network');
  });
});

describe('landing trust figures', () => {
  it('counts the categories the page lists instead of the API placeholder', async () => {
    expect((await landing()).text).toContain('Across 7 service categories');
  });

  it('hides the rating and satisfaction figures until someone has left a review', async () => {
    const { text } = await landing();
    expect(text).not.toMatch(/0\.0 ★|average rating|client satisfaction/i);
    expect(text).toContain('6 Verified providers');
  });

  it('shows the rating and satisfaction once reviews exist', async () => {
    data.stats = async () => ({ verified_providers: 6, jobs_completed: 9, average_rating: 4.75, satisfaction_pct: 92, review_count: 12, category_count: 0 });
    const { text } = await landing();
    expect(text).toContain('4.8 ★ Average rating From 12 verified reviews');
    expect(text).toContain('92% Client satisfaction');
  });

  it('leaves the figures out when the API cannot be reached', async () => {
    data.stats = fails;
    const { text } = await landing();
    expect(text).not.toMatch(/Verified providers|Jobs completed/);
    expect(text).not.toContain('Loading platform figures…');
  });
});

describe('landing spotlight price', () => {
  it.each([
    ['per hour', 'Tradies · $85 per hour'],
    ['from', 'Tradies · from $85'],
    ['fixed', 'Tradies · $85'],
  ])('shows a %s price on its own terms instead of promising a fixed price', async (unit, line) => {
    data.providers = async () => [provider({ price_unit: unit })];
    const { text } = await landing();
    expect(text).toContain(`Upfront price, no quote games ${line} 2 services listed`);
    expect(text).not.toMatch(/fixed price/i);
  });
});

describe('landing category headings', () => {
  it('nests the category card titles under the category section heading', async () => {
    data.categories = async () => [category('tradies', 'Tradies')];
    const { html } = await landing();
    expect(html).toMatch(/<h2[^>]*>\s*Whatever your property needs, there&#x27;s a pro for it.\s*<\/h2>[\s\S]*<h3[^>]*>Tradies<\/h3>/);
  });
});
