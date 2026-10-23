import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type PublicProvider } from '@/app/lib/api';
import { renderMarkup } from '@/app/test-utils/static-markup';
import ProviderProfilePage from './page';

const data = vi.hoisted(() => ({ provider: null as unknown, profile: null as unknown, profiles: [] as string[] }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    providers: {
      getPublic: async () => {
        if (!data.provider) throw new ApiError(503, 'Service Unavailable');
        return data.provider;
      },
      services: async () => [],
      reviews: async () => [],
      availability: async () => [],
      portfolio: async () => [],
    },
  },
}));
vi.mock('@/app/lib/public-profiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/public-profiles')>()),
  getPublicProfile: async (id: string) => {
    data.profiles.push(id);
    if (!data.profile) throw new ApiError(404, 'Profile not found');
    return data.profile;
  },
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined }),
}));

function profilePage(searchParams: { from?: string | string[] } = {}) {
  return ProviderProfilePage({ params: Promise.resolve({ slug: 'amelia-whitlock' }), searchParams: Promise.resolve(searchParams) });
}

beforeEach(() => { data.provider = null; data.profile = null; data.profiles = []; });

describe('provider load failure', () => {
  it('keeps a page heading and a way back to the categories', async () => {
    const { headings, links } = renderMarkup(await profilePage());
    expect(headings).toEqual(['h1 Provider profile', "h2 Couldn't load this provider"]);
    expect(links).toContainEqual({ href: '/categories', text: 'All categories' });
  });
});

describe('the way back to the listing', () => {
  const listingOf = async (searchParams: { from?: string | string[] }) => ((await profilePage(searchParams)) as ReactElement<{ listingHref?: string }>).props.listingHref;

  it('hands the profile the filtered listing it was opened from', async () => {
    data.provider = { id: 'p1', slug: 'amelia-whitlock' } as PublicProvider;
    expect(await listingOf({ from: '/categories/tradies?location=Newtown' })).toBe('/categories/tradies?location=Newtown');
  });

  it('drops a ?from= that is not one of our listings', async () => {
    data.provider = { id: 'p1', slug: 'amelia-whitlock' } as PublicProvider;
    expect(await listingOf({ from: 'https://evil.example/categories' })).toBeUndefined();
    expect(await listingOf({})).toBeUndefined();
  });
});

describe('the verified badge on a provider page', () => {
  const verifiedOf = async () => ((await profilePage()) as ReactElement<{ provider: { verified?: boolean } }>).props.provider.verified;

  it("comes from the provider account's public profile", async () => {
    data.provider = { id: 'p1', profile_id: 'owner-1', slug: 'amelia-whitlock' } as PublicProvider;
    data.profile = { id: 'owner-1', verified: true };

    expect(await verifiedOf()).toBe(true);
    expect(data.profiles).toEqual(['owner-1']);
  });

  it('is left off when the account is not verified, or has no public profile', async () => {
    data.provider = { id: 'p1', profile_id: 'owner-1', slug: 'amelia-whitlock' } as PublicProvider;
    data.profile = { id: 'owner-1', verified: false };
    expect(await verifiedOf()).toBe(false);

    data.profile = null;  // not listed, or the read failed: the page still opens
    expect(await verifiedOf()).toBe(false);
  });
});
