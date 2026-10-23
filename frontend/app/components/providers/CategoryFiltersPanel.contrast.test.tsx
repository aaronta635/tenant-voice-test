import { cleanup, descendants, fire, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category, PublicProvider } from '@/app/lib/api';
import CategoryFiltersPanel from './CategoryFiltersPanel';

// Not in CategoryFiltersPanel.test.tsx: its shallow renderer replaces React's
// hooks for the whole file, and this check needs a rendered tree.
vi.mock('next/navigation', () => ({
  usePathname: () => '/categories/co-host-inspector',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/image', () => ({ default: () => null }));

afterEach(cleanup);

const coHost: Category = {
  slug: 'co-host-inspector', category: 'co_host_inspector', name: 'Co-Host Inspector', description: 'Pre-stay walkthroughs for Airbnb hosts.',
  icon_bg: null, badge: 'NEW', sort_order: 1, provider_count: 1, from_price: 120,
};
const inspector = {
  id: 'p1', slug: 'p1', business_name: 'Harbour Inspections', tagline: null, headline: null, specialties: [], verifications: [],
  availability_note: null, rating_avg: 4, review_count: 2, from_price: 120, price_unit: 'fixed',
  profiles: { full_name: 'Hana Harbour', avatar_url: null, location: 'Newtown', state: 'NSW', postcode: null, phone: null },
} as unknown as PublicProvider;

describe('CategoryFiltersPanel contrast', () => {
  it('keeps the co-host search, its highlighted suggestion and the chosen result view at AA contrast', async () => {
    const view = await render(<CategoryFiltersPanel category={coHost} providers={[inspector]} serviceTypes={[]} verificationOptions={[]} availabilityOptions={[]} priceCeiling={300} />);
    const area = descendants(view).find((element) => element.id.endsWith('-area')) as FakeElement;
    await typeInto(area, 'Newt');
    await act(async () => { fire(area, 'keydown', { key: 'ArrowDown' }); });

    const search = descendants(view).find((element) => element.tagName === 'FORM') as FakeElement;
    expect(descendants(search).filter((element) => element.getAttribute('aria-selected') === 'true').map(textOf)).toEqual(['Newtown']);
    expect(textOf(search)).toContain('Search');
    expect(lowContrastText(search)).toEqual([]);
    expect(lowContrastText(hovered(search))).toEqual([]);

    const chosen = descendants(view).filter((element) => element.getAttribute('aria-pressed') === 'true');
    expect(chosen.map(textOf)).toEqual(['Grid']);
    expect(lowContrastText(chosen[0])).toEqual([]);
    expect(lowContrastText(hovered(chosen[0]))).toEqual([]);
  });
});
