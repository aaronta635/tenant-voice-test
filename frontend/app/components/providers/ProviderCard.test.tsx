import { cleanup, getByName, render } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicProvider } from '@/app/lib/api';
import { renderMarkup } from '@/app/test-utils/static-markup';
import ProviderCard from './ProviderCard';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/image', () => ({ default: () => null }));

afterEach(cleanup);

function provider(overrides: Partial<PublicProvider>): PublicProvider {
  return {
    id: 'p1', slug: 'amelia', business_name: 'Amelia Whitlock', category_name: 'Tradies', from_price: 85, price_unit: 'per hour',
    service_count: 1, rating_avg: 0, review_count: 0, verifications: [], availability_note: null,
    profiles: { full_name: 'Amelia Whitlock', avatar_url: null, location: 'Newtown', state: 'NSW', postcode: '2042', phone: null },
    ...overrides,
  } as PublicProvider;
}

describe('ProviderCard price', () => {
  it('says a provider without active services has none listed instead of a fixed price', () => {
    const { text } = renderMarkup(<ProviderCard provider={provider({ from_price: null, price_unit: null, service_count: 0 })} />);
    expect(text).toContain('No services listed yet');
    expect(text).not.toMatch(/fixed price|—/);
  });

  it('labels a listed price with its pricing basis', () => {
    expect(renderMarkup(<ProviderCard provider={provider({})} />).text).toContain('$85 per hour');
  });
});

describe('ProviderCard profile link', () => {
  const profileLink = (listingHref?: string) => renderMarkup(<ProviderCard provider={provider({})} listingHref={listingHref} />).links.find((link) => link.text === 'View profile')?.href;

  it('names the listing it is on, so the profile can link back to the same filters', () => {
    expect(profileLink('/categories/tradies?location=Newtown')).toBe(`/providers/amelia?from=${encodeURIComponent('/categories/tradies?location=Newtown')}`);
  });

  it('links to the plain profile elsewhere', () => {
    expect(profileLink()).toBe('/providers/amelia');
  });
});

describe('ProviderCard profile link contrast', () => {
  it('keeps "View profile" at AA contrast, also under the pointer', async () => {
    const link = getByName(await render(<ProviderCard provider={provider({})} />), 'a', 'View profile');
    expect(lowContrastText(link)).toEqual([]);
    expect(lowContrastText(hovered(link))).toEqual([]);
  });
});

describe('ProviderCard badges', () => {
  const VERIFIED = 'aria-label="Verified by TenantVoice"';

  it('shows the rating in the rating pill, with the review count', () => {
    const { text } = renderMarkup(<ProviderCard provider={provider({ rating_avg: 4.75, review_count: 12 })} />);

    expect(text).toContain('4.8 (12) Rated 4.8 out of 5 from 12 reviews');
    expect(text).not.toMatch(/No ratings yet|No reviews yet/);
  });

  it('says "No ratings yet" before the first review', () => {
    const { text } = renderMarkup(<ProviderCard provider={provider({ rating_avg: 0, review_count: 0 })} />);

    expect(text).toContain('No ratings yet');
    expect(text).not.toContain('Rated');
  });

  it('shows the verified seal only for a verified account', () => {
    expect(renderMarkup(<ProviderCard provider={{ ...provider({}), verified: true }} />).html).toContain(VERIFIED);
    expect(renderMarkup(<ProviderCard provider={{ ...provider({}), verified: false }} />).html).not.toContain(VERIFIED);
    // A listing that does not say so shows none: a document alone never earns the seal.
    expect(renderMarkup(<ProviderCard provider={provider({ verifications: ['ID', 'Insured'] })} />).html).not.toContain(VERIFIED);
  });

  it('keeps the whole card at AA contrast, rated or not', async () => {
    const view = await render(
      <div>
        <ProviderCard provider={{ ...provider({ rating_avg: 4.5, review_count: 3, verifications: ['ID'] }), verified: true }} />
        <ProviderCard provider={provider({})} />
      </div>,
    );

    expect(lowContrastText(view)).toEqual([]);
  });
});
