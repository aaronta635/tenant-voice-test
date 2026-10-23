import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLACEHOLDER_LINES, PRIVATE_SECTIONS } from '@/app/components/public-profiles/PrivateDetails';
import { ApiError } from '@/app/lib/api';
import { roleForSignUp } from '@/app/lib/auth-redirect';
import type { PublicProfileDetail } from '@/app/lib/public-profiles';
import { renderMarkup } from '@/app/test-utils/static-markup';
import PublicProfilePage from './page';

const data = vi.hoisted(() => ({ profile: null as unknown, error: null as Error | null, role: null as string | null, loaded: [] as string[] }));
vi.mock('@/app/lib/public-profiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/public-profiles')>()),
  getPublicProfile: async (id: string) => {
    data.loaded.push(id);
    if (data.error) throw data.error;
    return data.profile;
  },
}));
vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getSessionRole: async () => data.role,
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined }),
  redirect: (url: string) => { throw new Error(`redirect ${url}`); },
  notFound: () => { throw new Error('not found'); },
}));

const TENANT = 'a1000000-0000-4000-8000-000000000001';
const LANDLORD = 'a2000000-0000-4000-8000-000000000001';
const PROVIDER = 'a4000000-0000-4000-8000-000000000001';

function detail(over: Partial<PublicProfileDetail>): PublicProfileDetail {
  return {
    id: TENANT, role: 'tenant', role_label: 'Tenant', display_name: 'Zara Q.', business_name: null,
    avatar_url: 'https://cdn.example/zara.png', areas: ['Newtown', 'Glebe'], about: 'Quiet nurse who keeps a tidy home.',
    verified: true, rating_avg: 4.5, review_count: 2, budget_min: 500, budget_max: 800, move_in_month: '2026-11',
    categories: [], pricing_summary: null, service_area: null, provider_slug: null,
    reviews: [
      { id: 'r1', rating: 5, title: 'Great tenant', body: 'Paid on time.', reviewer_label: 'Verified landlord',
        reply: 'Thank you!', replied_at: '2026-03-02T00:00:00+00:00', created_at: '2026-03-01T00:00:00+00:00',
        reported: false },
      { id: 'r2', rating: 4, title: null, body: 'Tidy and quiet.', reviewer_label: 'Service provider',
        reply: null, replied_at: null, created_at: '2026-02-01T00:00:00+00:00', reported: false },
    ],
    ...over,
  };
}

async function openProfile(slug: string) {
  return renderMarkup(await PublicProfilePage({ params: Promise.resolve({ slug }) }));
}

/** The markup under each blur. */
function placeholders(html: string) {
  return [...html.matchAll(/data-private-placeholder=""[^>]*>([\s\S]*?)<\/div>/g)].map(([, inner]) => inner);
}

beforeEach(() => {
  data.profile = detail({});
  data.error = null;
  data.role = null;
  data.loaded = [];
});

describe('/public/<slug> routing', () => {
  it('still opens a provider page for a provider slug, without asking for a profile', async () => {
    await expect(openProfile('amelia-whitlock')).rejects.toThrow('redirect /providers/amelia-whitlock');
    expect(data.loaded).toEqual([]);
  });

  it("sends a provider's id to their marketplace page", async () => {
    data.profile = detail({ id: PROVIDER, role: 'provider', role_label: 'Service provider', provider_slug: 'sparky-electrical' });
    await expect(openProfile(PROVIDER)).rejects.toThrow('redirect /providers/sparky-electrical');
  });

  it('answers not found for a hidden or unknown member', async () => {
    data.error = new ApiError(404, 'Profile not found');
    await expect(openProfile(TENANT)).rejects.toThrow('not found');
  });

  it('keeps a heading and a way back when the profile cannot load', async () => {
    data.error = new ApiError(503, 'Service Unavailable');
    const { headings, links } = await openProfile(TENANT);
    expect(headings).toEqual(['h1 Public profile', "h2 Couldn't load this profile"]);
    expect(links).toContainEqual({ href: '/search?type=profiles&role=all', text: 'Find profiles' });
  });
});

describe('a public profile', () => {
  it('shows the public fields and published reviews', async () => {
    const { headings, text, links, html } = await openProfile(TENANT);

    expect(headings).toEqual(['h1 Zara Q.', 'h2 About', 'h2 Private details', 'h2 Reviews', 'h3 Great tenant']);
    expect(html).toContain('aria-label="Verified by TenantVoice"');
    expect(text).toContain('4.5 (2) Rated 4.5 out of 5 from 2 reviews');
    expect(text).toContain('Newtown · Glebe');
    expect(text).toContain('Weekly budget $500–$800');
    expect(text).toContain('Move-in Nov 2026');
    expect(text).toContain('Verified landlord 5 out of 5 stars');
    expect(text).toContain('Response from Zara Q.');
    expect(links).toContainEqual({ href: '/search?type=profiles&role=tenant', text: '← Find profiles' });
  });

  it('says so when there are no reviews or badge yet', async () => {
    data.profile = detail({ reviews: [], review_count: 0, rating_avg: null, verified: false });
    const { text, html } = await openProfile(TENANT);
    expect(text).toContain('No ratings yet');
    expect(text).toContain('No reviews yet');
    expect(html).not.toContain('Verified');
  });

  it('blurs fixed filler for the private sections, never the member’s values', async () => {
    const zara = await openProfile(TENANT);
    data.profile = detail({
      id: LANDLORD, role: 'landlord', role_label: 'Agent', display_name: 'Andy Agent', business_name: 'Harbour Realty',
      areas: ['North Shore'], about: 'Leasing agent.', budget_min: null, budget_max: null, move_in_month: null,
    });
    const andy = await openProfile(LANDLORD);

    const filler = PLACEHOLDER_LINES.map((line) => `<p class="text-sm text-text-body">${line}</p>`).join('');
    expect(placeholders(zara.html)).toEqual(PRIVATE_SECTIONS.tenant.map(() => filler));
    expect(placeholders(andy.html)).toEqual(PRIVATE_SECTIONS.landlord.map(() => filler));
    for (const value of ['Zara', 'Newtown', 'Glebe', 'Quiet nurse', '500', '800', 'Nov', 'cdn.example', 'Andy', 'Harbour', 'North Shore']) {
      expect(placeholders(zara.html).join('') + placeholders(andy.html).join('')).not.toContain(value);
    }
    expect(zara.html).toMatch(/aria-hidden="true" data-private-placeholder=""/);
  });

  it('asks a signed-out visitor to sign in or sign up, then return to the profile', async () => {
    const { text, links } = await openProfile(TENANT);

    expect(text).toContain('Sign in or create an account to see more');
    const next = encodeURIComponent(`/public/${TENANT}`);
    expect(links).toContainEqual({ href: `/login?next=${next}`, text: 'Sign in to connect' });
    expect(links).toContainEqual({ href: `/register?role=landlord&next=${next}`, text: 'Create an account' });
    expect(text).not.toContain('Connect with Zara Q.');
  });

  it('signs up a landlord from a tenant profile and a tenant from a landlord profile, never a provider by default', async () => {
    data.profile = detail({ id: LANDLORD, role: 'landlord', role_label: 'Landlord', display_name: 'Lena Landlord' });
    const { links } = await openProfile(LANDLORD);

    const next = encodeURIComponent(`/public/${LANDLORD}`);
    expect(links).toContainEqual({ href: `/register?role=tenant&next=${next}`, text: 'Create an account' });
    expect(roleForSignUp('tenant', `/public/${LANDLORD}`)).toBe('Client');
    expect(roleForSignUp('landlord', `/public/${TENANT}`)).toBe('Owner');
  });

  it('shows a signed-in member the same profile, with the spot for connecting', async () => {
    const signedOut = await openProfile(TENANT);
    data.role = 'Owner';
    const signedIn = await openProfile(TENANT);

    expect(signedIn.text).toContain('Connect with Zara Q.');
    // The button reads the member's state once it runs in the browser.
    expect(signedIn.text).toContain('Checking your connection…');
    expect(signedIn.html).toContain('data-connect-slot=""');
    expect(signedIn.text).not.toContain('Sign in or create an account');
    expect(signedIn.headings).toEqual(signedOut.headings);
    expect(placeholders(signedIn.html)).toEqual(placeholders(signedOut.html));
  });
});
