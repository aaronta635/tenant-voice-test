import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api';
import {
  budgetLabel,
  getPublicProfile,
  isProfileId,
  moveInLabel,
  parseProfileSearch,
  profileSearchHref,
  publicProfileHref,
  ratingSummary,
  searchPublicProfiles,
  searchTypeHref,
} from './public-profiles';

const MEMBER = 'a1000000-0000-4000-8000-000000000001';

afterEach(() => { vi.unstubAllGlobals(); });

describe('the /search URL contract', () => {
  it('reads role, text, location and page, defaulting to every role on page one', () => {
    expect(parseProfileSearch(new URLSearchParams())).toEqual({ role: 'all', q: '', location: '', page: 1 });
    expect(parseProfileSearch(new URLSearchParams('type=profiles&role=landlord&q=Harbour&location=Newtown&page=3')))
      .toEqual({ role: 'landlord', q: 'Harbour', location: 'Newtown', page: 3 });
    // A server page's searchParams object, with a repeated key.
    expect(parseProfileSearch({ role: ['tenant', 'provider'], q: 'jane' })).toEqual({ role: 'tenant', q: 'jane', location: '', page: 1 });
  });

  it('falls back for a role or page it does not know', () => {
    for (const role of ['owner', 'service_provider', 'admin', 'TENANT']) {
      expect(parseProfileSearch(new URLSearchParams({ role })).role).toBe('all');
    }
    for (const page of ['0', '-2', '1.5', 'two', '']) {
      expect(parseProfileSearch(new URLSearchParams({ page })).page).toBe(1);
    }
  });

  it('writes the contract the homepage links with', () => {
    expect(profileSearchHref({ role: 'all', q: '', location: '', page: 1 })).toBe('/search?type=profiles&role=all');
    expect(profileSearchHref({ role: 'tenant', q: 'jane doe', location: '', page: 1 })).toBe('/search?type=profiles&role=tenant&q=jane+doe');
    expect(profileSearchHref({ role: 'provider', q: ' ', location: 'Inner West', page: 2 }))
      .toBe('/search?type=profiles&role=provider&location=Inner+West&page=2');
    const href = profileSearchHref({ role: 'landlord', q: 'a&b=c', location: '', page: 1 });
    expect(parseProfileSearch(new URL(href, 'https://tenantvoice.test').searchParams).q).toBe('a&b=c');
  });

  it('sends rental and service searches to their own pages', () => {
    expect(searchTypeHref({ type: 'properties', q: 'Bondi' })).toBe('/properties?q=Bondi');
    expect(searchTypeHref({ type: 'properties' })).toBe('/properties');
    expect(searchTypeHref({ type: 'services', q: 'pest control' })).toBe('/categories?search=pest+control');
    expect(searchTypeHref({ type: 'services', q: '  ' })).toBe('/categories');
    for (const type of [undefined, 'profiles', 'renter-profiles', 'reviews']) expect(searchTypeHref({ type, q: 'x' })).toBeNull();
  });
});

describe('profile links', () => {
  it('opens providers on their marketplace page and everyone else on their public profile', () => {
    expect(publicProfileHref({ id: MEMBER, role: 'provider', provider_slug: 'sparky-electrical' })).toBe('/providers/sparky-electrical');
    expect(publicProfileHref({ id: MEMBER, role: 'provider', provider_slug: null })).toBe(`/providers/${MEMBER}`);
    expect(publicProfileHref({ id: MEMBER, role: 'tenant', provider_slug: null })).toBe(`/public/${MEMBER}`);
    expect(publicProfileHref({ id: MEMBER, role: 'landlord', provider_slug: null })).toBe(`/public/${MEMBER}`);
  });

  it('tells a member id from a provider slug', () => {
    expect(isProfileId(MEMBER)).toBe(true);
    expect(isProfileId(MEMBER.toUpperCase())).toBe(true);
    expect(isProfileId('sparky-electrical')).toBe(false);
    expect(isProfileId(`${MEMBER}x`)).toBe(false);
  });
});

describe('profile labels', () => {
  it('shows a budget range, either end alone, or nothing', () => {
    expect(budgetLabel(500, 800)).toBe('$500–$800');
    expect(budgetLabel(650, 650)).toBe('$650');
    expect(budgetLabel(500, null)).toBe('From $500');
    expect(budgetLabel(null, 800)).toBe('Up to $800');
    expect(budgetLabel(null, null)).toBeNull();
  });

  it('shows the move-in month and never a day', () => {
    expect(moveInLabel('2026-11')).toBe('Nov 2026');
    expect(moveInLabel('2026-11-21')).toBeNull();
    expect(moveInLabel(null)).toBeNull();
  });

  it('summarises published reviews, or nothing before the first one', () => {
    expect(ratingSummary({ rating_avg: 4.5, review_count: 2 })).toBe('4.5 · 2 reviews');
    expect(ratingSummary({ rating_avg: 5, review_count: 1 })).toBe('5.0 · 1 review');
    expect(ratingSummary({ rating_avg: null, review_count: 0 })).toBeNull();
  });
});

describe('public profile requests', () => {
  /** A signed-in visitor's browser, and its requests: any other call sends the token. */
  async function signedIn(body: unknown) {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { cookie: 'tv_token=visitor-access; tv_role=Owner' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/profiles/me');
    expect(request(fetchMock, 0).init.headers).toEqual({ Authorization: 'Bearer visitor-access' });
    return fetchMock;
  }
  function request(fetchMock: ReturnType<typeof vi.fn>, index: number) {
    const [url, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
    return { url: new URL(url), init };
  }

  it('asks for one page of twelve without the visitor token', async () => {
    const fetchMock = await signedIn({ items: [], total: 0, limit: 12, offset: 12 });
    await searchPublicProfiles({ role: 'tenant', q: ' jane ', location: '', page: 2 });

    const { url, init } = request(fetchMock, 1);
    expect(url.pathname).toMatch(/\/public\/profiles$/);
    expect(Object.fromEntries(url.searchParams)).toEqual({ role: 'tenant', q: 'jane', limit: '12', offset: '12' });
    expect(init.headers).toEqual({});
  });

  it('asks for one profile by id without the visitor token', async () => {
    const fetchMock = await signedIn({ id: MEMBER });
    await getPublicProfile(MEMBER);

    const { url, init } = request(fetchMock, 1);
    expect(url.pathname).toMatch(new RegExp(`/public/profiles/${MEMBER}$`));
    expect(init.headers).toEqual({});
  });
});
