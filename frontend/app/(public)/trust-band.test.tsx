import { cleanup, descendants, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category, PlatformStats, Property, PublicProvider } from '@/app/lib/api';
import LandingPage from './page';

const category = { slug: 'tradies', category: 'tradies', name: 'Tradies', description: 'Tradies near you.', icon_bg: null, badge: null, sort_order: 1, provider_count: 1, from_price: 85 } as Category;
const provider = {
  id: 'p1', slug: 'amelia', business_name: 'Amelia Whitlock', category_name: 'Tradies', from_price: 85, price_unit: 'fixed',
  service_count: 2, rating_avg: 0, review_count: 0, verifications: ['ABN', 'Licence'], availability_note: null,
  profiles: { full_name: 'Amelia Whitlock', avatar_url: null, location: 'Newtown', state: 'NSW', postcode: '2042', phone: null },
} as PublicProvider;
const stats: PlatformStats = { verified_providers: 6, jobs_completed: 9, average_rating: 0, satisfaction_pct: 0, review_count: 0, category_count: 0 };
const listing = {
  id: 'prop-1', title: 'Sunny terrace near the park', address: '12 King St', suburb: 'Newtown', state: 'NSW', postcode: '2042',
  bedrooms: 3, bathrooms: 2, parking: 1, price: 820, photo_urls: ['https://images.example/terrace.jpg'], status: 'available',
} as Property;

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <span role="img" aria-label={alt} data-src={src} />,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getSessionRole: async () => null,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    categories: { list: async () => [category] },
    providers: { listPublic: async () => [provider] },
    content: { platformStats: async () => stats },
    properties: { listPublic: async () => [listing] },
  },
}));

afterEach(cleanup);

describe('landing trust band', () => {
  it('keeps its copy, figures and verification chips at AA contrast', async () => {
    const view = await render(await LandingPage());
    const band = descendants(view).find((element) => element.id === 'trust') as FakeElement;

    expect(textOf(band)).toContain('✓ ABN');
    expect(textOf(band)).toContain('Verified providers');
    expect(lowContrastText(band)).toEqual([]);
  });
});

describe('landing calls to action', () => {
  it('keeps the search, section links, listings and join buttons at AA contrast, also under the pointer', async () => {
    const view = await render(await LandingPage());
    for (const label of ['Search', 'Find providers', 'All categories →', 'View all rentals →', 'Sunny terrace near the park', 'Join as a tenant', 'Join as a provider']) {
      expect(textOf(view)).toContain(label);
    }
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
