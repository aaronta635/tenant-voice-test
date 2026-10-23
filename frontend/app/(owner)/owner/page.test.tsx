import { cleanup, click, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerDashboard } from '@/app/lib/api';
import type { OnboardingProgress } from '@/app/lib/onboarding';
import { isPageRoute } from '@/app/test-utils/app-routes';
import { myProfile } from '@/app/test-utils/my-profile';
import { suggestion, suggestions } from '@/app/test-utils/provider-suggestions';
import OwnerHomePage from './page';

const place = vi.hoisted(() => ({ saved: null as unknown as OnboardingProgress }));
const mocks = vi.hoisted(() => ({ owner: vi.fn() }));
const suggested = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    profiles: { me: async () => myProfile({ full_name: 'Leo Landlord' }, { landlord: true }) },
    dashboard: { owner: mocks.owner },
  },
}));
vi.mock('@/app/lib/onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/onboarding')>()),
  onboardingApi: { get: async () => place.saved, save: async () => place.saved },
}));
vi.mock('@/app/lib/provider-suggestions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/provider-suggestions')>()),
  getProviderSuggestions: suggested.get,
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

function dashboardOf(over: Partial<OwnerDashboard> = {}): OwnerDashboard {
  return {
    property_count: 2, available_count: 1, rented_count: 1, application_count: 4, new_application_count: 1,
    active_lease_count: 1, occupancy_pct: 50, active_complaint_count: 3, upcoming_inspection_count: 6,
    upcoming_inspections: [
      { id: 'b-1', kind: 'booking', listing_id: 'l-1', listing_title: 'Harbour flat', starts_at: '2026-11-07T23:00:00Z', duration_minutes: 30, label: 'Open home booking' },
      { id: 'i-1', kind: 'inspection', listing_id: 'l-2', listing_title: 'Garden house', starts_at: '2026-11-10T00:30:00Z', duration_minutes: null, label: 'Routine inspection' },
    ],
    review_count: 12, rating_avg: 4.5, reviews_awaiting_reply: 2, favourite_count: 7, view_count: 120, views_available: true,
    view_days: 30,
    listings: [
      { id: 'l-1', title: 'Harbour flat', listing_status: 'leased', occupied: true, application_count: 3, new_application_count: 1,
        view_count: 100, favourite_count: 5, review_count: 12, rating_avg: 4.5, upcoming_inspection_count: 1 },
      { id: 'l-2', title: 'Garden house', listing_status: 'published', occupied: false, application_count: 1, new_application_count: 0,
        view_count: 20, favourite_count: 2, review_count: 0, rating_avg: null, upcoming_inspection_count: 5 },
    ],
    unread_messages: 4, pending_connections: 1, unread_notifications: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  suggested.get.mockReset().mockResolvedValue(suggestions());
  mocks.owner.mockReset();
  mocks.owner.mockResolvedValue(dashboardOf());
  place.saved = { role: 'landlord', step: 'publish', completed_at: '2026-10-20T00:00:00Z' };
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the landlord dashboard', () => {
  it('offers to finish a setup the landlord skipped', async () => {
    place.saved = { role: 'landlord', step: 'welcome', completed_at: null };
    const view = await render(<OwnerHomePage />);

    expect(textOf(view)).toContain('Welcome back, Leo!');
    expect(textOf(view)).toContain('Finish setting up your profile');
    expect(getByName(view, 'a', 'Finish setup').getAttribute('href')).toBe('/owner/onboarding');
  });

  it('renders each quick link once, with no key React warns about', async () => {
    // Two quick links lead to /owner/properties: keyed by their address, React logged a duplicate key.
    place.saved = { role: 'landlord', step: 'publish', completed_at: '2026-10-20T00:00:00Z' };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const view = await render(<OwnerHomePage />);

      expect(getByName(view, 'a', /Ratings & Reviews/).getAttribute('href')).toBe('/owner/properties');
      expect(getByName(view, 'a', /^Properties/).getAttribute('href')).toBe('/owner/properties');
      expect(errors.mock.calls.filter((call) => String(call[0]).includes('same key'))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it('says nothing about setup once it is finished', async () => {
    const view = await render(<OwnerHomePage />);

    expect(textOf(view)).not.toContain('Finish setting up your profile');
  });

  it("shows the server's figures for the portfolio", async () => {
    const view = await render(<OwnerHomePage />);
    const text = textOf(view);

    expect(text).toContain('Occupancy50%1 of 2 homes under an active lease');
    expect(text).toContain('Active complaints3View complaints');
    // The soonest inspection, in Sydney's summer time: 23:00 UTC is 10am the next day.
    expect(text).toContain('Upcoming inspections6Next: Sun, 8 Nov, 10:00 am');
    expect(text).toContain('New applications14 applications in total');
    expect(text).toContain('Average rating4.512 published reviews · 2 awaiting your reply');
    expect(text).toContain('Saved by tenants7');
    expect(text).toContain('Listing views120Last 30 days, one a day for each viewer');
    expect(getByName(view, 'a', 'View complaints').getAttribute('href')).toBe('/owner/complaints');
  });

  it('shows a dash for views the server cannot count yet, and every other figure', async () => {
    mocks.owner.mockResolvedValue(dashboardOf({
      view_count: null, views_available: false,
      listings: dashboardOf().listings.map((listing) => ({ ...listing, view_count: null })),
    }));
    const view = await render(<OwnerHomePage />);
    const text = textOf(view);

    expect(text).toContain('Listing views—Not counted yet');
    expect(text).toContain('Views, 30 days—');
    expect(text).toContain('Saved by tenants7');
  });

  it('lists the inspections to come, and says how many more there are', async () => {
    const view = await render(<OwnerHomePage />);
    const text = textOf(view);

    expect(text).toContain('Open home booking · Harbour flatSun, 8 Nov, 10:00 am');
    expect(text).toContain('Routine inspection · Garden houseTue, 10 Nov, 11:30 am');
    expect(text).toContain('And 4 more.');
  });

  it("shows each listing's figures, with a link to its analytics", async () => {
    const view = await render(<OwnerHomePage />);
    const text = textOf(view);

    expect(text).toContain('Harbour flatActive leaseLeased');
    expect(text).toContain('Views, 30 days100Saved5Applications3 (1 new)Rating4.5 (12)Inspections ahead1');
    expect(text).toContain('Garden housePublished');
    expect(text).toContain('Rating' + 'No reviews');
    const link = getByName(view, 'a', 'View analytics for Garden house');
    expect(link.getAttribute('href')).toBe('/owner/properties/l-2/analytics');
    expect(isPageRoute('/owner/properties/l-2/analytics')).toBe(true);
  });

  it('invites an owner with no properties to list one', async () => {
    mocks.owner.mockResolvedValue(dashboardOf({ property_count: 0, occupancy_pct: null, listings: [], upcoming_inspections: [], upcoming_inspection_count: 0 }));
    const view = await render(<OwnerHomePage />);

    expect(textOf(view)).toContain('No properties yet');
    expect(getByName(view, 'a', 'List a property').getAttribute('href')).toBe('/owner/properties/create');
    expect(isPageRoute('/owner/properties/create')).toBe(true);
  });

  it('says when the figures cannot be loaded, and loads them again', async () => {
    mocks.owner.mockRejectedValueOnce(new Error('offline'));
    const view = await render(<OwnerHomePage />);

    expect(textOf(view)).toContain("Your figures couldn't be loaded");
    expect(textOf(view)).not.toContain('Occupancy');
    await click(getByName(view, 'button', 'Try again'));

    expect(textOf(view)).toContain('Occupancy50%');
    expect(mocks.owner).toHaveBeenCalledTimes(2);
  });

  it('suggests the three providers best placed for the owner\'s properties, with the way to the rest', async () => {
    place.saved = { role: 'landlord', step: 'publish', completed_at: '2026-10-20T00:00:00Z' };
    suggested.get.mockResolvedValue(suggestions([
      suggestion(),
      suggestion({ id: 'p-2', slug: 'local-cleaners', display_name: 'Local Cleaners' }),
    ]));
    const view = await render(<OwnerHomePage />);

    expect(suggested.get).toHaveBeenCalledWith({ category: null, propertyId: null, limit: 3 });
    expect(textOf(getByName(view, 'h2', 'Suggested providers'))).toBe('Suggested providers');
    expect(textOf(view)).toContain('2 providers for your property in Newtown, NSW 2042.');
    expect(getByName(view, 'a', 'View profile: Local Cleaners').getAttribute('href')).toBe('/providers/local-cleaners');
    expect(getByName(view, 'a', 'See all suggestions').getAttribute('href')).toBe('/owner/recommendations');
  });
});
