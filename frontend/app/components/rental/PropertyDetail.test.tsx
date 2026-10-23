import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { ApiError, type ListingViewer, type Property, type Review } from '@/app/lib/api';
import { roleForSignIn, safeNextPath } from '@/app/lib/auth-redirect';
import { createFakeHistory } from '@/app/test-utils/fake-history';
import PropertyDetail from './PropertyDetail';

const page = vi.hoisted(() => ({ propertyId: 'pr-42' }));
const mockApi = vi.hoisted(() => ({
  properties: { getPublic: vi.fn(), reviews: vi.fn(), like: vi.fn(), unlike: vi.fn() },
  conversations: { startRental: vi.fn() },
  applications: { create: vi.fn() },
}));
const profiles = vi.hoisted(() => ({ getMyProfile: vi.fn() }));
const documents = vi.hoisted(() => ({ checklist: vi.fn() }));
const inspections = vi.hoisted(() => ({ publicSlots: vi.fn(), openSlots: vi.fn(), myBookings: vi.fn(), book: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ propertyId: page.propertyId }),
  usePathname: () => `/properties/${page.propertyId}`,
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <span role="img" aria-label={alt} data-src={src} /> }));
vi.mock('@/app/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/app/lib/api')>()), api: mockApi }));
vi.mock('@/app/lib/my-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/my-profile')>()),
  getMyProfile: profiles.getMyProfile,
}));
vi.mock('@/app/lib/profile-documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/profile-documents')>()),
  documentsApi: documents,
}));
vi.mock('@/app/lib/inspections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/inspections')>()),
  inspectionsApi: inspections,
}));

const STREET = '12 Kingfisher Lane';
const SIGNED_OUT: ListingViewer = { role: null, is_owner: false, liked: false, application: null };
const TENANT: ListingViewer = { role: 'tenant', is_owner: false, liked: false, application: null };

function listing(over: Partial<Property> = {}): Property {
  return {
    id: page.propertyId, owner_id: 'owner-1', title: 'Harbour flat', description: 'Sunny two bedroom flat.',
    address: 'Wollongong, NSW 2500', suburb: 'Wollongong', state: 'NSW', postcode: '2500', property_type: 'apartment',
    bedrooms: 2, bathrooms: 1, parking: 1, price: 650, bond: 2600, lease_term: '12 months', available_from: null,
    amenities: ['Balcony'], photo_urls: ['https://abcd.supabase.co/storage/v1/object/public/property-images/o/1.png'],
    status: 'available', listing_status: 'published', rating_avg: 0, review_count: 0,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    address_hidden: true, accepting_applications: true, like_count: 30,
    landlord: { id: 'owner-1', display_name: 'Olivia Owner', role_label: 'Landlord', avatar_url: null, verified: true, rating_avg: 4.5, review_count: 8 },
    viewer: SIGNED_OUT,
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const links = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'A');
const hrefOf = (view: FakeElement, text: string | RegExp) => getByName(view, 'a', text).getAttribute('href') as string;
const headings = (view: FakeElement) => descendants(view).filter((element) => /^H[1-3]$/.test(element.tagName)).map(textOf);

beforeEach(() => {
  vi.clearAllMocks();
  page.propertyId = 'pr-42';
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockApi.properties.getPublic.mockResolvedValue(listing());
  mockApi.properties.reviews.mockResolvedValue([]);
  inspections.publicSlots.mockResolvedValue([]);
  inspections.openSlots.mockResolvedValue([]);
  inspections.myBookings.mockResolvedValue([]);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the listing page signed out', () => {
  it("shows the suburb, never a street address or anyone's contact details", async () => {
    // Even a response that still held the street shows only the suburb to a signed-out visitor.
    mockApi.properties.getPublic.mockResolvedValue(listing({ address: `${STREET}, Wollongong, NSW, 2500`, address_hidden: undefined }));

    const view = await render(<PropertyDetail />);

    const text = textOf(view);
    expect(text).toContain('Wollongong, NSW 2500');
    expect(text).not.toContain('Kingfisher');
    expect(text).not.toMatch(/@|\b04\d{2}\b/);
    expect(text).toContain('Sign in to see the street address.');
    expect(text).toContain('Contact details stay private: message the landlord through TenantVoice.');
  });

  it('asks a guest to sign in as a tenant and come back, to apply, message or like', async () => {
    const view = await render(<PropertyDetail />);

    for (const [name, next] of [
      ['Sign in to apply', '/properties/pr-42?apply=1'],
      ['Create a free account', '/properties/pr-42?apply=1'],
      ['Sign in to message the landlord', '/properties/pr-42'],
      [/^Like · 30/, '/properties/pr-42'],
    ] as const) {
      const url = new URL(hrefOf(view, name), 'https://tenantvoice.invalid');
      expect(roleForSignIn(url.searchParams.get('role'), url.searchParams.get('next'))).toBe('Client');
      expect(safeNextPath(url.searchParams.get('next'))).toBe(next);
    }
    expect(descendants(view).filter((element) => element.tagName === 'BUTTON' && /Apply|Message/.test(textOf(element)))).toEqual([]);
  });

  it('calls the landlord a landlord, never an owner', async () => {
    mockApi.properties.reviews.mockResolvedValue([
      { id: 'rv-1', client_name: 'Mia', rating: 4, comment: 'Bright and quiet.', provider_reply: 'Thanks, Mia!' } as Review,
    ]);

    const view = await render(<PropertyDetail />);

    expect(textOf(view)).toMatch(/\blandlord\b/i);
    expect(textOf(view)).not.toMatch(/\bowners?\b/i);
  });

  it('keeps every text at AA contrast, hovered or not', async () => {
    const view = await render(<PropertyDetail />);

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe('the listing page signed in', () => {
  it('shows a tenant the street address the API sends', async () => {
    mockApi.properties.getPublic.mockResolvedValue(listing({
      address: `${STREET}, Wollongong, NSW, 2500`, address_hidden: false, viewer: TENANT,
    }));

    const view = await render(<PropertyDetail />);

    expect(textOf(view)).toContain(`${STREET}, Wollongong, NSW, 2500`);
    expect(textOf(view)).not.toContain('Sign in to see the street address');
  });

  it('lets a tenant like the listing and take it back', async () => {
    mockApi.properties.getPublic.mockResolvedValue(listing({ viewer: TENANT }));
    mockApi.properties.like.mockResolvedValue({ liked: true, like_count: 31 });
    mockApi.properties.unlike.mockResolvedValue({ liked: false, like_count: 30 });
    const view = await render(<PropertyDetail />);

    await click(getByName(view, 'button', 'Like this listing, 30 likes'));
    const liked = getByName(view, 'button', 'Liked, 31 likes');
    expect(liked.getAttribute('aria-pressed')).toBe('true');
    await click(liked);

    expect(mockApi.properties.like).toHaveBeenCalledWith('pr-42');
    expect(mockApi.properties.unlike).toHaveBeenCalledWith('pr-42');
    expect(getByName(view, 'button', 'Like this listing, 30 likes').getAttribute('aria-pressed')).toBe('false');
  });

  it('lets a tenant apply from the page and then says where the application stands', async () => {
    mockApi.properties.getPublic.mockResolvedValue(listing({ viewer: TENANT }));
    profiles.getMyProfile.mockResolvedValue(null);
    documents.checklist.mockResolvedValue({ documents: [] });
    mockApi.applications.create.mockResolvedValue({ id: 'app-9', status: 'new', stage: 'submitted', created_at: '2026-10-20T00:00:00Z' });
    const view = await render(<PropertyDetail />);

    await click(getByName(view, 'button', 'Apply for this property'));
    const dialog = descendants(view).find((element) => element.tagName === 'DIALOG') as FakeElement;
    expect(dialog.hasAttribute('open')).toBe(true);
    getByName(dialog, 'button', 'Send application');
    // The test DOM has no default actions, so the form is submitted as its submit button would.
    await dispatch(descendants(dialog).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(mockApi.applications.create).toHaveBeenCalledWith(expect.objectContaining({ property_id: 'pr-42', rent_offered: 650 }));
    expect(textOf(view)).toContain('Application sent. The landlord will see it with the listing.');
    expect(textOf(view)).toContain('You applied on 20 Oct 2026. Status: Submitted');
    expect(descendants(view).filter((element) => element.tagName === 'DIALOG')).toEqual([]);
  });

  it("says where a tenant's own application stands instead of offering to apply again", async () => {
    mockApi.properties.getPublic.mockResolvedValue(listing({
      viewer: { ...TENANT, liked: true, application: { id: 'app-1', stage: 'shortlisted', can_withdraw: true, created_at: '2026-10-01T00:00:00Z' } },
    }));

    const view = await render(<PropertyDetail />);

    expect(textOf(view)).toContain('You applied on 1 Oct 2026. Status: Shortlisted');
    expect(hrefOf(view, 'View my applications')).toBe('/tenant/applications');
    expect(descendants(view).filter((element) => textOf(element) === 'Apply for this property')).toEqual([]);
  });

  it('tells everyone a listing closed to applications takes none', async () => {
    mockApi.properties.getPublic.mockResolvedValue(listing({ listing_status: 'applications_closed', accepting_applications: false, viewer: TENANT }));

    const view = await render(<PropertyDetail />);

    expect(textOf(view)).toContain("The landlord isn't taking new applications for this listing.");
    expect(textOf(view)).toContain('Applications closed');
  });

  it("sends the listing's landlord to manage it rather than apply", async () => {
    mockApi.properties.getPublic.mockResolvedValue(listing({ viewer: { role: 'landlord', is_owner: true, liked: false, application: null } }));

    const view = await render(<PropertyDetail />);

    expect(hrefOf(view, 'Manage listing')).toBe('/owner/properties/pr-42');
    expect(textOf(view)).not.toContain('Message the landlord');
  });

  it('opens the apply form a tenant came back to after signing in, and drops ?apply from the address', async () => {
    const browser = createFakeHistory('/properties/pr-42?apply=1');
    const undo = browser.install(window);
    mockApi.properties.getPublic.mockResolvedValue(listing({ viewer: TENANT }));
    profiles.getMyProfile.mockReturnValue(new Promise(() => {}));
    documents.checklist.mockReturnValue(new Promise(() => {}));

    try {
      const view = await render(<PropertyDetail />);

      const dialog = descendants(view).find((element) => element.tagName === 'DIALOG') as FakeElement;
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(textOf(dialog)).toContain('Loading your saved profile…');
      expect(browser.stack()).toEqual(['>/properties/pr-42']);
    } finally {
      undo();
    }
  });
});

describe('the listing page states', () => {
  it('shows a loading state until the listing arrives', async () => {
    const pending = deferred<Property>();
    mockApi.properties.getPublic.mockReturnValue(pending.promise);

    const view = await render(<PropertyDetail />);

    expect(textOf(view)).toContain('Loading listing…');
    await act(async () => { pending.resolve(listing()); });
    await settle();
    expect(headings(view)[0]).toBe('Harbour flat');
  });

  it('shows not found for a listing nobody may open', async () => {
    mockApi.properties.getPublic.mockRejectedValue(new ApiError(404, 'Property not found'));

    const view = await render(<PropertyDetail backHref="/tenant/properties" />);

    expect(headings(view)).toEqual(['Listing not found']);
    expect(hrefOf(view, '← Back to rentals')).toBe('/tenant/properties');
  });

  it('shows an error with a retry, which loads the listing', async () => {
    mockApi.properties.getPublic.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));

    const view = await render(<PropertyDetail />);

    expect(headings(view)).toEqual(["Couldn't load this listing"]);
    expect(textOf(view)).toContain('The service is temporarily unavailable.');
    await click(getByName(view, 'button', 'Try again'));
    expect(headings(view)[0]).toBe('Harbour flat');
    expect(mockApi.properties.getPublic).toHaveBeenCalledTimes(2);
  });

  it('says what a listing has not added yet', async () => {
    mockApi.properties.getPublic.mockResolvedValue(listing({ description: null, amenities: [], bond: null, lease_term: null }));

    const text = textOf(await render(<PropertyDetail />));

    expect(text).toContain("The landlord hasn't added a description yet.");
    expect(text).toContain('No reviews yet for this listing.');
    expect(text).toContain('No inspection times published yet — message the landlord to arrange one.');
    expect(text).toContain('BondAsk the landlord');
  });

  it('names an unlisted landlord no further', async () => {
    mockApi.properties.getPublic.mockResolvedValue(listing({ landlord: null }));

    const view = await render(<PropertyDetail />);

    expect(textOf(view)).toContain('Listed by a TenantVoice landlord.');
    expect(links(view).filter((link) => link.getAttribute('href')?.startsWith('/public/'))).toEqual([]);
  });

  it("shows the landlord's badge, rating and profile", async () => {
    const view = await render(<PropertyDetail />);

    expect(getByName(view, 'span', 'Verified by TenantVoice')).toBeTruthy();
    expect(textOf(view)).toContain('Rated 4.5 out of 5 from 8 reviews');
    expect(hrefOf(view, 'View profile')).toBe('/public/owner-1');
  });

  it('says "No photo yet" for a listing without photos, never a stock photo, and shows its own otherwise', async () => {
    mockApi.properties.getPublic.mockResolvedValueOnce(listing({ photo_urls: [] }));
    const none = await render(<PropertyDetail />);
    expect(textOf(none)).toContain('No photo yet');
    // next/image is mocked as a span with data-src: no image at all stands in for the home.
    expect(descendants(none).filter((element) => element.hasAttribute('data-src')).length).toBe(0);
    expect(descendants(none).filter((element) => element.hasAttribute('data-demo-label'))).toEqual([]);
    await cleanup();

    const own = await render(<PropertyDetail />);
    expect(textOf(own)).not.toContain('No photo yet');
    expect(descendants(own).filter((element) => element.hasAttribute('data-demo-label'))).toEqual([]);
  });

  it('shows every photo of the listing, one at a time', async () => {
    const photos = ['https://cdn.example.test/1.jpg', 'https://cdn.example.test/2.jpg'];
    mockApi.properties.getPublic.mockResolvedValue(listing({ photo_urls: photos }));
    const view = await render(<PropertyDetail />);

    await click(getByName(view, 'button', 'Show photo 2 of 2'));

    expect(getByName(view, 'span', 'Photo 2 of 2 of Harbour flat').getAttribute('data-src')).toBe(photos[1]);
    expect(getByName(view, 'button', 'Show photo 2 of 2').getAttribute('aria-pressed')).toBe('true');
  });

  it("never shows one listing's details on another's page while it loads", async () => {
    let open: (id: string) => void = () => {};
    // A client navigation to another listing: the same page, a new id.
    function Navigable() {
      const [id, setId] = useState('pr-42');
      open = setId;
      page.propertyId = id;
      return <PropertyDetail />;
    }
    const view = await render(<Navigable />);
    expect(headings(view)[0]).toBe('Harbour flat');
    const next = deferred<Property>();
    mockApi.properties.getPublic.mockReturnValue(next.promise);

    await act(async () => { open('pr-43'); });
    await settle();

    expect(textOf(view)).not.toContain('Harbour flat');
    expect(textOf(view)).toContain('Loading listing…');
    await act(async () => { next.resolve(listing({ id: 'pr-43', title: 'Garden cottage' })); });
    await settle();
    expect(headings(view)[0]).toBe('Garden cottage');
    expect(mockApi.properties.getPublic).toHaveBeenLastCalledWith('pr-43');
  });
});
