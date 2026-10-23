import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Availability, ProviderService, PublicProvider, Review } from '@/app/lib/api';
import { safeNextPath } from '@/app/lib/auth-redirect';
import PublicProviderProfileView from './PublicProviderProfileView';

const mockApi = vi.hoisted(() => ({
  providers: { busyTimes: vi.fn() }, bookings: { create: vi.fn() }, conversations: { startMarketplace: vi.fn() },
  profiles: { me: vi.fn() }, connections: { request: vi.fn(), respond: vi.fn(), remove: vi.fn() },
}));
const connections = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('@/app/lib/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/connections')>()),
  getConnectionState: connections.state,
}));
const navigation = vi.hoisted(() => ({ search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => '/providers/harbour-plumbing',
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/image', () => ({ default: () => null }));

const provider = {
  id: 'prov-1', profile_id: 'owner-1', slug: 'harbour-plumbing', business_name: 'Harbour Plumbing', category: 'tradie',
  category_name: 'Tradies', category_slug: 'tradies', tagline: null, bio: null, years_experience: null, languages: [],
  specialties: [], gallery_urls: [], service_radius_km: null, response_time: null, availability_note: null,
  rating_avg: 0, review_count: 0, completed_jobs: 0, created_at: '2026-01-01T00:00:00Z', verifications: [],
  profiles: { full_name: 'Hana Harbour', avatar_url: null, location: 'Newtown', state: 'NSW', postcode: '2042', phone: null },
} as unknown as PublicProvider;

function service(id: string, title: string, duration_minutes: number) {
  return { id, title, duration_minutes, is_active: true, price: 120, pricing_type: 'flat', description: null } as ProviderService;
}
const services = [service('svc-quick', 'Quick fix', 60), service('svc-full', 'Full service', 240)];
// 9am to 5pm every day: a 60-minute job can start up to 4pm, a 240-minute one up to 1pm.
const availability = Array.from({ length: 7 }, (_, day) => ({
  id: `day-${day}`, provider_id: 'prov-1', day_of_week: day, start_time: '09:00:00', end_time: '17:00:00', is_available: true,
})) as Availability[];

function renderProfile(listingHref?: string) {
  return render(<PublicProviderProfileView provider={provider} services={services} reviews={[]} availability={availability} portfolio={[]} listingHref={listingHref} />);
}

const field = (view: FakeElement, tag: string, suffix: string) => descendants(view).find((element) => element.tagName === tag && element.id.endsWith(suffix)) as FakeElement;
const firstSlotAt = (view: FakeElement, time: string) => field(view, 'SELECT', '-date').options.map((option) => option.value).find((value) => value.endsWith(`|${time}`)) as string;

async function choose(select: FakeElement, value: string) {
  select.value = value;
  await dispatch(select, 'change');
}

/** The service, time and suburb the card holds, as its "Sign in to book" link carries them. */
function bookingRequest(view: FakeElement) {
  const href = getByName(view, 'a', 'Sign in to book').getAttribute('href') as string;
  const next = new URL(href, 'https://tenantvoice.invalid').searchParams.get('next') as string;
  return Object.fromEntries(new URL(next, 'https://tenantvoice.invalid').searchParams);
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.search = '';
  document.cookie = '';
  mockApi.providers.busyTimes.mockResolvedValue([]);
  mockApi.bookings.create.mockResolvedValue({ id: 'booking-1' });
  connections.state.mockResolvedValue({ user_id: 'owner-1', state: 'none', connection_id: null });
});
afterEach(cleanup);

describe('"Book this service" on a provider profile', () => {
  it('switches the booking card to that service and keeps a chosen time it still fits, and the suburb', async () => {
    const view = await renderProfile();
    const tenAm = firstSlotAt(view, '10:00:00');
    await choose(field(view, 'SELECT', '-date'), tenAm);
    await typeInto(field(view, 'INPUT', '-suburb'), 'Newtown');

    await click(getByName(view, 'button', 'Book Full service'));

    expect(bookingRequest(view)).toEqual({ service: 'svc-full', slot: tenAm, suburb: 'Newtown' });
    expect(field(view, 'SELECT', '-date').value).toBe(tenAm);
  });

  it('clears a chosen time the new service no longer fits and says why', async () => {
    const view = await renderProfile();
    await choose(field(view, 'SELECT', '-date'), firstSlotAt(view, '16:00:00'));

    await click(getByName(view, 'button', 'Book Full service'));

    expect(bookingRequest(view)).toEqual({ service: 'svc-full' });
    expect(field(view, 'SELECT', '-date').value).toBe('');
    expect(textOf(view)).toContain('The previous time does not fit this service. Please choose a new time.');
  });

  it('applies the same service again after the visitor picked another one in the card', async () => {
    const view = await renderProfile();
    await click(getByName(view, 'button', 'Book Quick fix'));
    await choose(field(view, 'SELECT', '-service'), 'svc-full');

    await click(getByName(view, 'button', 'Book Quick fix'));

    expect(bookingRequest(view).service).toBe('svc-quick');
  });

  it('keeps the time a visitor returned from sign-in with while the open times still load', async () => {
    mockApi.providers.busyTimes.mockReturnValue(new Promise(() => {}));
    navigation.search = 'service=svc-quick&slot=2030-01-07%7C16%3A00%3A00&suburb=Newtown';
    const view = await renderProfile();

    await click(getByName(view, 'button', 'Book Full service'));

    expect(bookingRequest(view)).toEqual({ service: 'svc-full', slot: '2030-01-07|16:00:00', suburb: 'Newtown' });
    expect(textOf(view)).not.toContain('does not fit');
  });

  it('starts a new request for the service after one was sent', async () => {
    document.cookie = 'tv_token=live-access';
    const view = await renderProfile();
    await choose(field(view, 'SELECT', '-date'), firstSlotAt(view, '10:00:00'));
    await typeInto(field(view, 'INPUT', '-suburb'), 'Newtown');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
    expect(textOf(view)).toContain('Request sent');

    await click(getByName(view, 'button', 'Book Full service'));

    expect(textOf(view)).not.toContain('Request sent');
    expect(field(view, 'SELECT', '-service').value).toBe('svc-full');
    expect(field(view, 'INPUT', '-suburb').value).toBe('Newtown');
  });
});

describe('the #booking anchor', () => {
  it('is the booking form that sign-in returns the visitor to', async () => {
    const view = await renderProfile();
    const targets = descendants(view).filter((element) => element.id === 'booking');
    expect(targets).toHaveLength(1);
    expect(descendants(targets[0]).some((element) => element.tagName === 'H2' && textOf(element) === 'Request a booking')).toBe(true);
  });
});

describe('sharing a provider profile', () => {
  // The page as a visitor reaches it from a filtered listing and back from sign-in.
  const address = `https://tenantvoice.example/providers/harbour-plumbing?service=svc-quick&from=${encodeURIComponent('/categories/tradies?location=Newtown')}#booking`;
  beforeEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: new URL(address) });
  });
  afterEach(() => {
    Reflect.deleteProperty(window, 'location');
    vi.unstubAllGlobals();
  });

  // React DOM reads navigator.userAgent when it loads, so the stubs come after the first render.
  it('shares the profile\'s own address, without the listing or booking in it', async () => {
    const view = await renderProfile('/categories/tradies?location=Newtown');
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    await click(getByName(view, 'button', 'Share'));
    expect(share).toHaveBeenCalledWith({ title: 'Harbour Plumbing', url: 'https://tenantvoice.example/providers/harbour-plumbing' });
  });

  it('copies that address where the browser cannot share', async () => {
    const view = await renderProfile('/categories/tradies?location=Newtown');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await click(getByName(view, 'button', 'Share'));
    expect(writeText).toHaveBeenCalledWith('https://tenantvoice.example/providers/harbour-plumbing');
    expect(textOf(view)).toContain('Profile link copied.');
  });

  it.each([
    ['refuses to copy', () => ({ clipboard: { writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) } })],
    ['has no clipboard, as on a page served over http', () => ({})],
  ])('gives that address to copy by hand when the browser %s', async (_case, browser) => {
    const view = await renderProfile('/categories/tradies?location=Newtown');
    vi.stubGlobal('navigator', browser());
    await click(getByName(view, 'button', 'Share'));
    // Not the address bar, which holds the listing and the booking choices.
    const alerts = descendants(view).filter((element) => element.getAttribute('role') === 'alert').map(textOf).filter(Boolean);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('https://tenantvoice.example/providers/harbour-plumbing');
    expect(alerts[0]).not.toContain('?');
  });

  it('takes back "Profile link copied." when a later copy fails', async () => {
    const view = await renderProfile('/categories/tradies?location=Newtown');
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException('Write permission denied.', 'NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const share = getByName(view, 'button', 'Share');
    await click(share);
    expect(textOf(share)).toBe('Copied');
    expect(textOf(view)).toContain('Profile link copied.');

    await click(share);

    expect(textOf(share)).toBe('Share');
    expect(textOf(view)).not.toContain('Profile link copied.');
    expect(textOf(view)).toContain('Could not share this profile. Copy this link: https://tenantvoice.example/providers/harbour-plumbing');
  });

  it('takes back "Profile link copied." when opening a conversation then fails', async () => {
    document.cookie = 'tv_token=live-access';
    mockApi.conversations.startMarketplace.mockRejectedValue(new Error('offline'));
    const view = await renderProfile('/categories/tradies?location=Newtown');
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const share = getByName(view, 'button', 'Share');
    await click(share);
    expect(textOf(view)).toContain('Profile link copied.');

    await click(getByName(view, 'button', 'Message'));

    expect(textOf(share)).toBe('Share');
    expect(textOf(view)).not.toContain('Profile link copied.');
    expect(textOf(view)).toContain('Could not open a conversation.');
  });
});

describe('the category under a provider\'s name', () => {
  const categoryLine = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'P' && textOf(element).startsWith('Service provider')).map(textOf);

  it('names the category', async () => {
    expect(categoryLine(await renderProfile())).toEqual(['Service provider · Tradies']);
  });

  it('falls back to the marketplace card\'s wording for a provider with no category', async () => {
    // A listed row from the mobile app can have no category at all.
    const view = await render(<PublicProviderProfileView provider={{ ...provider, category: null, category_name: null, category_slug: null }} services={services} reviews={[]} availability={availability} portfolio={[]} />);
    expect(categoryLine(view)).toEqual(['Service provider · Property services']);
  });
});

describe('the reviews on a provider profile', () => {
  const review = (id: string, rating: number) => ({ id, rating, client_name: 'Mia', comment: null, provider_reply: null, replied_at: null, created_at: '2026-02-01T00:00:00Z' }) as Review;
  const renderWithReviews = (reviews: Review[]) => render(<PublicProviderProfileView provider={{ ...provider, rating_avg: 5, review_count: reviews.length }} services={services} reviews={reviews} availability={availability} portfolio={[]} />);
  const shown = (view: FakeElement) => textOf(descendants(view).find((element) => element.getAttribute('role') === 'status' && textOf(element).startsWith('Showing')) as FakeElement);

  it('counts a single review as one review', async () => {
    expect(shown(await renderWithReviews([review('r1', 5)]))).toBe('Showing 1 of 1 review');
  });

  it('counts the reviews a rating filter leaves', async () => {
    const view = await renderWithReviews([review('r1', 5), review('r2', 4)]);
    expect(shown(view)).toBe('Showing 2 of 2 reviews');
    await choose(descendants(view).find((element) => element.tagName === 'SELECT' && element.options.some((option) => textOf(option) === 'All ratings')) as FakeElement, '4');
    expect(shown(view)).toBe('Showing 1 of 1 review');
  });

  it('marks a reported review, which stays up until a moderator decides', async () => {
    const view = await renderWithReviews([review('r1', 5), { ...review('r2', 1), is_flagged: true }]);
    const articles = descendants(view).filter((element) => element.tagName === 'ARTICLE' && textOf(element).startsWith('Mia'));

    expect(articles.map((article) => textOf(article).includes('Reported · under review'))).toEqual([false, true]);
    expect(lowContrastText(view)).toEqual([]);
  });
});

describe('signing in from a provider profile', () => {
  it('preselects no account type, since landlords and providers book too', async () => {
    const view = await renderProfile();
    const url = new URL(getByName(view, 'a', 'Sign in').getAttribute('href') as string, 'https://tenantvoice.invalid');
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.has('role')).toBe(false);
    expect(url.searchParams.get('next')).toBe('/providers/harbour-plumbing');
  });
});

describe('"← Providers" on a provider profile', () => {
  const listing = '/categories/tradies?location=Newtown&rating=4.0%2B';
  const nextOf = (link: FakeElement) => new URL(link.getAttribute('href') as string, 'https://tenantvoice.invalid').searchParams.get('next');

  it('returns to the filtered listing the profile was opened from', async () => {
    const view = await renderProfile(listing);
    expect(getByName(view, 'a', '← Providers').getAttribute('href')).toBe(listing);
  });

  it('falls back to the provider\'s category listing', async () => {
    const view = await renderProfile();
    expect(getByName(view, 'a', '← Providers').getAttribute('href')).toBe('/categories/tradies');
  });

  it('keeps that listing through sign-in from the profile and from the booking card', async () => {
    navigation.search = `from=${encodeURIComponent(listing)}`;
    const view = await renderProfile(listing);
    expect(nextOf(getByName(view, 'a', 'Sign in'))).toBe(`/providers/harbour-plumbing?from=${encodeURIComponent(listing)}`);
    expect(bookingRequest(view).from).toBe(listing);
    await click(getByName(view, 'button', 'Message Hana'));
    expect(navigation.push).toHaveBeenCalledWith(getByName(view, 'a', 'Sign in to book').getAttribute('href'));
  });

  it('leaves out a ?from= the page refused, so sign-in still returns to the booking', async () => {
    // Keywords "100%" give a listing link that safeNextPath refuses, so the page passes no listingHref.
    navigation.search = `from=${encodeURIComponent('/categories/tradies?search=100%25')}`;
    const view = await renderProfile();
    const tenAm = firstSlotAt(view, '10:00:00');
    await choose(field(view, 'SELECT', '-date'), tenAm);
    await typeInto(field(view, 'INPUT', '-suburb'), 'Newtown');

    const signIn = getByName(view, 'a', 'Sign in to book');
    const back = new URL(safeNextPath(nextOf(signIn)) ?? '/refused', 'https://tenantvoice.invalid');
    expect(`${back.pathname}${back.hash}`).toBe('/providers/harbour-plumbing#booking');
    expect(Object.fromEntries(back.searchParams)).toEqual({ service: 'svc-quick', slot: tenAm, suburb: 'Newtown' });
    // The signed-out "Message Hana" goes through the same sign-in.
    await click(getByName(view, 'button', 'Message Hana'));
    expect(navigation.push).toHaveBeenCalledWith(signIn.getAttribute('href'));
  });
});

describe('the booking card\'s sign-in return path', () => {
  const listing = '/categories/tradies?location=Newtown';
  /** Where login sends the visitor back to: the link's ?next=, as safeNextPath accepts it. */
  const returnTo = (view: FakeElement) => {
    const next = new URL(getByName(view, 'a', 'Sign in to book').getAttribute('href') as string, 'https://tenantvoice.invalid').searchParams.get('next');
    return new URL(safeNextPath(next) ?? '/refused', 'https://tenantvoice.invalid');
  };

  it.each(['100% Newtown', 'Newtown\\NSW'])('leaves out the suburb %s, which login would refuse, and keeps the rest', async (suburb) => {
    const view = await renderProfile(listing);
    const tenAm = firstSlotAt(view, '10:00:00');
    await choose(field(view, 'SELECT', '-date'), tenAm);
    await typeInto(field(view, 'INPUT', '-suburb'), suburb);

    const back = returnTo(view);
    expect(`${back.pathname}${back.hash}`).toBe('/providers/harbour-plumbing#booking');
    expect(Object.fromEntries(back.searchParams)).toEqual({ service: 'svc-quick', slot: tenAm, from: listing });
    // The signed-out "Message Hana" goes through the same sign-in.
    await click(getByName(view, 'button', 'Message Hana'));
    expect(navigation.push).toHaveBeenCalledWith(getByName(view, 'a', 'Sign in to book').getAttribute('href'));
  });

  it('keeps a suburb login accepts, punctuation and all', async () => {
    const view = await renderProfile();
    await typeInto(field(view, 'INPUT', '-suburb'), "St Mary's, NSW 2760");
    expect(Object.fromEntries(returnTo(view).searchParams)).toEqual({ service: 'svc-quick', suburb: "St Mary's, NSW 2760" });
  });

  it('leaves out a time from a broken link the same way, and keeps the suburb', async () => {
    navigation.search = 'service=svc-full&slot=100%25&suburb=Newtown';
    const view = await renderProfile();
    expect(Object.fromEntries(returnTo(view).searchParams)).toEqual({ service: 'svc-full', suburb: 'Newtown' });
  });
});

describe('text contrast on a provider profile', () => {
  it.each([
    ['signed out', '', 'a', 'Sign in to book'],
    ['signed in', 'tv_token=live-access', 'button', 'Request to book'],
  ])('keeps every text run at AA contrast for a visitor %s, "Message" and the booking button included', async (_state, cookie, tag, action) => {
    document.cookie = cookie;
    const view = await renderProfile();
    expect(textOf(getByName(view, 'button', 'Message'))).toBe('Message');
    expect(textOf(getByName(view, tag, action))).toBe(action);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe('trust badges and connecting on a provider profile', () => {
  const seal = (view: FakeElement) => descendants(view).find((element) => element.getAttribute('aria-label') === 'Verified by TenantVoice');
  const connect = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'BUTTON' && element.getAttribute('aria-label') === 'Connect with Harbour Plumbing');

  it('shows the rating pill under the name, and the seal of a verified account beside it', async () => {
    const view = await render(<PublicProviderProfileView provider={{ ...provider, rating_avg: 4.75, review_count: 12, verified: true }} services={services} reviews={[]} availability={availability} portfolio={[]} />);

    expect(textOf(view)).toContain('Rated 4.8 out of 5 from 12 reviews');
    expect(seal(view)?.getAttribute('role')).toBe('img');
    expect(textOf(descendants(view).find((element) => element.tagName === 'H1') as FakeElement)).toBe('Harbour Plumbing');
  });

  it('shows "No ratings yet" and no seal for an unverified provider without reviews', async () => {
    const view = await renderProfile();

    expect(textOf(view)).toContain('No ratings yet');
    expect(seal(view)).toBeUndefined();
  });

  it('asks a signed-out visitor to sign in to connect, and come back to the profile', async () => {
    const listing = '/categories/tradies?location=Newtown';
    const view = await renderProfile(listing);
    const href = getByName(view, 'a', 'Sign in to connect').getAttribute('href') as string;

    expect(new URL(href, 'https://tenantvoice.invalid').searchParams.get('next')).toBe(`/providers/harbour-plumbing?from=${encodeURIComponent(listing)}`);
    expect(connections.state).not.toHaveBeenCalled();
  });

  it("offers a signed-in member the Connect button for the provider's account", async () => {
    document.cookie = 'tv_token=live-access';
    const view = await renderProfile();

    expect(connections.state).toHaveBeenCalledWith('owner-1');
    expect(connect(view)).toHaveLength(1);
  });

  it("offers no Connect button on the provider's own profile", async () => {
    document.cookie = 'tv_token=live-access; tv_role=Provider';
    mockApi.profiles.me.mockResolvedValue({ id: 'owner-1' });
    const view = await renderProfile();

    expect(textOf(view)).toContain('Your public profile');
    expect(connect(view)).toEqual([]);
  });
});
