import { cleanup, descendants, render } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicProfile } from '@/app/lib/public-profiles';
import { renderMarkup } from '@/app/test-utils/static-markup';
import ProfileCard from './ProfileCard';
import ProfilePagination, { pageList } from './ProfilePagination';

vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink(() => undefined),
}));

afterEach(cleanup);

const TENANT = 'a1000000-0000-4000-8000-000000000001';
const AGENT = 'a3000000-0000-4000-8000-000000000001';
const PROVIDER = 'a4000000-0000-4000-8000-000000000001';
const VERIFIED = 'role="img" aria-label="Verified by TenantVoice"';

// renderMarkup puts a space where the sr-only name starts.
const linkTexts = (links: { href: string; text: string }[]) => links.map(({ href, text }) => ({ href, text: text.replace(' :', ':') }));

function profile(over: Partial<PublicProfile>): PublicProfile {
  return {
    id: TENANT, role: 'tenant', role_label: 'Tenant', display_name: 'Jane D.', business_name: null, avatar_url: null,
    areas: [], about: null, verified: false, rating_avg: null, review_count: 0, budget_min: null, budget_max: null,
    move_in_month: null, categories: [], pricing_summary: null, service_area: null, provider_slug: null, ...over,
  };
}

const tenant = profile({
  areas: ['Newtown', 'Glebe'], budget_min: 500, budget_max: 800, move_in_month: '2026-11', about: 'Quiet nurse who keeps a tidy home.',
});
const agent = profile({
  id: AGENT, role: 'landlord', role_label: 'Agent', display_name: 'Andy Agent', business_name: 'Harbour Realty',
  areas: ['North Shore'], verified: true, rating_avg: 4.5, review_count: 2,
});
const provider = profile({
  id: PROVIDER, role: 'provider', role_label: 'Service provider', display_name: 'Sparky Electrical', categories: ['Tradies', 'Pest control'],
  service_area: 'Inner West', pricing_summary: 'From $120 a call-out', provider_slug: 'sparky-electrical', rating_avg: 5, review_count: 1,
});

describe('ProfileCard', () => {
  it("shows a tenant's budget, move-in month and areas, and opens their public profile", () => {
    const { text, links, headings } = renderMarkup(<ProfileCard profile={tenant} />);

    expect(headings).toEqual(['h3 Jane D.']);
    expect(text).toContain('Newtown · Glebe');
    expect(text).toContain('No ratings yet');
    expect(text).toContain('Weekly budget $500–$800');
    expect(text).toContain('Move-in Nov 2026');
    expect(text).toContain('Quiet nurse who keeps a tidy home.');
    expect(renderMarkup(<ProfileCard profile={tenant} />).html).not.toContain(VERIFIED);
    expect(linkTexts(links)).toEqual([{ href: `/public/${TENANT}`, text: 'View profile: Jane D.' }]);
  });

  it('shows the verified seal and the rating pill only when the API says so', () => {
    const { text, html, headings } = renderMarkup(<ProfileCard profile={agent} />);

    expect(text).toContain('Agent · Harbour Realty');
    expect(html).toContain(VERIFIED);
    expect(headings).toEqual(['h3 Andy Agent']);  // the seal names itself, apart from the heading
    expect(text).toContain('4.5 (2) Rated 4.5 out of 5 from 2 reviews');
    expect(text).not.toContain('No ratings yet');
    expect(text).not.toContain('Weekly budget');
    expect(renderMarkup(<ProfileCard profile={{ ...agent, verified: false }} />).html).not.toContain(VERIFIED);
  });

  it("shows a provider's services, area and pricing, and opens their marketplace page", () => {
    const { text, links, html } = renderMarkup(<ProfileCard profile={provider} />);

    expect(html).toMatch(/<ul aria-label="Services"[^>]*><li[^>]*>Tradies<\/li><li[^>]*>Pest control<\/li><\/ul>/);
    expect(text).toContain('Service area Inner West');
    expect(text).toContain('Pricing From $120 a call-out');
    expect(text).toContain('5.0 (1) Rated 5.0 out of 5 from 1 review');
    expect(text).not.toContain('Move-in');
    expect(linkTexts(links)).toEqual([{ href: '/providers/sparky-electrical', text: 'View profile: Sparky Electrical' }]);
  });

  it('says so when a member lists no area', () => {
    expect(renderMarkup(<ProfileCard profile={profile({})} />).text).toContain('Area not listed');
  });
});

describe('ProfilePagination', () => {
  it('lists every page up to seven, then the ends and the pages around the current one', () => {
    expect(pageList(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageList(1, 10)).toEqual([1, 2, 3, 4, 'gap', 10]);
    expect(pageList(6, 10)).toEqual([1, 'gap', 5, 6, 7, 'gap', 10]);
    expect(pageList(10, 10)).toEqual([1, 'gap', 7, 8, 9, 10]);
  });

  it('links the pages either side and marks the current one', () => {
    const { links, text } = renderMarkup(<ProfilePagination page={2} totalPages={3} hrefFor={(page) => `/search?page=${page}`} />);

    expect(links.map((link) => link.href)).toEqual(['/search?page=1', '/search?page=1', '/search?page=3', '/search?page=3']);
    expect(text).toContain('Page 2');
    expect(renderMarkup(<ProfilePagination page={1} totalPages={1} hrefFor={String} />).html).toBe('');
  });
});

describe('profile search contrast', () => {
  it('keeps every card, badge and page link at AA contrast, also under the pointer', async () => {
    const view = await render(
      <div>
        <ProfileCard profile={tenant} />
        <ProfileCard profile={agent} />
        <ProfileCard profile={provider} />
        <ProfilePagination page={2} totalPages={9} hrefFor={(page) => `/search?page=${page}`} />
      </div>,
    );

    expect(descendants(view).some((element) => element.getAttribute('aria-current') === 'page')).toBe(true);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
