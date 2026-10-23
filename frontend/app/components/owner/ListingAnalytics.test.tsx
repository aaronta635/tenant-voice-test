import { cleanup, click, descendants, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { ListingAnalytics as Analytics } from '@/app/lib/dashboards';
import { isPageRoute } from '@/app/test-utils/app-routes';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import ListingAnalytics from './ListingAnalytics';

const mocks = vi.hoisted(() => ({ listing: vi.fn() }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { dashboard: { listing: mocks.listing } },
}));
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    useParams: () => ({ id: 'l-1' }),
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

function analyticsOf(over: Partial<Analytics> = {}): Analytics {
  return {
    property_id: 'l-1', title: 'Harbour flat', listing_status: 'leased', published_at: '2026-09-01T00:00:00Z',
    days: 7, start: '2026-10-17', end: '2026-10-23',
    views: {
      available: true, total: 41, period: 9,
      daily: ['17', '18', '19', '20', '21', '22', '23'].map((day, index) => ({ date: `2026-10-${day}`, count: [1, 0, 0, 3, 0, 2, 3][index] })),
    },
    favourites: { total: 5, period: 2 },
    applications: { total: 6, period: 2, new: 1, reviewing: 2, shortlisted: 1, approved: 1, declined: 1, withdrawn: 1, expired: 0 },
    inspections: {
      bookings: 4, pending: 1, accepted: 2, reschedule_requested: 0, rejected: 0, cancelled: 1, upcoming_count: 1,
      upcoming: [{ id: 'b-1', kind: 'booking', listing_id: 'l-1', listing_title: 'Harbour flat', starts_at: '2026-11-07T23:00:00Z', duration_minutes: 30, label: 'Open home booking' }],
    },
    reviews: {
      count: 3, rating_avg: 3.67, awaiting_reply: 2,
      distribution: [{ rating: 5, count: 1 }, { rating: 4, count: 0 }, { rating: 3, count: 2 }, { rating: 2, count: 0 }, { rating: 1, count: 0 }],
    },
    lease: { agreement_id: 'a-1', start_date: '2026-09-15', end_date: '2027-09-14', rent_amount: 2800, rent_frequency: 'MONTHLY' },
    ...over,
  };
}

let leavePage = () => {};
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/owner/properties/l-1/analytics${search}`);
  leavePage = navigation.page.install(window);
}

const figure = (view: FakeElement, title: string) =>
  descendants(view).find((element) => element.tagName === 'FIGURE' && textOf(element).startsWith(title))!;

beforeEach(() => {
  vi.clearAllMocks();
  openPage();
  mocks.listing.mockResolvedValue(analyticsOf({ days: 30 }));
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

describe("a listing's analytics", () => {
  it('asks for the range in the URL, 30 days unless it names another', async () => {
    openPage('?days=7');
    mocks.listing.mockResolvedValue(analyticsOf());
    const view = await render(<ListingAnalytics />);

    expect(mocks.listing).toHaveBeenCalledWith('l-1', 7);
    expect(textOf(view)).toContain("17 Oct 2026 to 23 Oct 2026, by Sydney's calendar");
    expect(textOf(view)).toContain('Harbour flatLeased');

    openPage('?days=365');
    await cleanup();
    await render(<ListingAnalytics />);
    expect(mocks.listing).toHaveBeenLastCalledWith('l-1', 30);
  });

  it('shows the figures of the range and of all time', async () => {
    const view = await render(<ListingAnalytics />);

    const tiles = descendants(view).find((element) => element.getAttribute('aria-label') === 'Last 30 days')!;
    expect(descendants(tiles).filter((element) => element.tagName === 'LI').map(textOf)).toEqual([
      'Views9All time: 41',
      'Saved by tenants52 in this range',
      'Applications2All time: 6',
      'Inspections ahead14 open-home bookings in all',
      'Average rating3.73 published reviews',
    ]);
  });

  it('says the views are not counted yet when the server cannot read them, and shows the rest', async () => {
    mocks.listing.mockResolvedValue(analyticsOf({ days: 30, views: { available: false, total: null, period: null, daily: [] } }));
    const view = await render(<ListingAnalytics />);

    const tiles = descendants(view).find((element) => element.getAttribute('aria-label') === 'Last 30 days')!;
    expect(descendants(tiles).filter((element) => element.tagName === 'LI').map(textOf)[0]).toBe('Views—Not counted yet');
    expect(textOf(view)).toContain('Listing views are not counted yet. The other figures are up to date.');
    expect(textOf(view)).toContain('Saved by tenants52 in this range');
  });

  it('draws the views day by day, with the numbers in a table', async () => {
    const view = await render(<ListingAnalytics />);
    const chart = figure(view, 'Views per day');

    expect(textOf(chart)).toContain('9 views');
    const rows = descendants(chart).filter((element) => element.tagName === 'TR').map(textOf);
    expect(rows.slice(0, 3)).toEqual(['DayViews', '17 Oct1', '18 Oct0']);
    expect(rows.at(-1)).toBe('23 Oct3');
  });

  it('draws 90 days a week at a time, so each column stays wide enough to see', async () => {
    const daily = Array.from({ length: 90 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 6, 26 + index)).toISOString().slice(0, 10), count: index % 7 === 0 ? 2 : 0,
    }));
    mocks.listing.mockResolvedValue(analyticsOf({ days: 90, start: '2026-07-26', end: '2026-10-23', views: { available: true, total: 26, period: 26, daily } }));
    const view = await render(<ListingAnalytics />);
    const chart = figure(view, 'Views per week');

    const rows = descendants(chart).filter((element) => element.tagName === 'TR').map(textOf);
    expect(rows.length - 1).toBe(13);
    expect(rows.slice(0, 2)).toEqual(['WeekViews', 'Week of 26 July2']);
    expect(textOf(chart)).toContain('26 views');
  });

  it('breaks down the applications, bookings and reviews', async () => {
    const view = await render(<ListingAnalytics />);
    const bars = (title: string) => descendants(figure(view, title))
      .filter((element) => element.tagName === 'DIV' && element.className.startsWith('grid')).map(textOf);

    expect(bars('Applications by stage')).toEqual(['New1', 'Reviewing2', 'Approved1', 'Declined1', 'Withdrawn1', 'Expired0']);
    expect(textOf(view)).toContain('1 of those reviewing is shortlisted.');
    expect(bars('Open-home bookings')).toEqual(['Waiting for you1', 'Accepted2', 'New time asked0', 'Declined0', 'Cancelled1']);
    expect(textOf(view)).toContain('Coming upOpen home bookingSun, 8 Nov, 10:00 am');
    expect(bars('Published reviews by rating')).toEqual(['5 stars1', '4 stars0', '3 stars2', '2 stars0', '1 star0']);
    expect(textOf(view)).toContain('2 reviews await your reply.');
  });

  it('names the active lease, or says the home is not occupied yet', async () => {
    const view = await render(<ListingAnalytics />);
    expect(textOf(view)).toContain('Active lease$2,800 per month, from 15 Sept 2026 to 14 Sept 2027.');

    await cleanup();
    mocks.listing.mockResolvedValue(analyticsOf({ days: 30, lease: null }));
    const empty = await render(<ListingAnalytics />);
    expect(textOf(empty)).toContain('No active lease. This home counts as occupied once a rent agreement for it is activated.');
  });

  it('says so when nothing has happened yet', async () => {
    mocks.listing.mockResolvedValue(analyticsOf({
      days: 30,
      applications: { total: 0, period: 0, new: 0, reviewing: 0, shortlisted: 0, approved: 0, declined: 0, withdrawn: 0, expired: 0 },
      inspections: { bookings: 0, pending: 0, accepted: 0, reschedule_requested: 0, rejected: 0, cancelled: 0, upcoming_count: 0, upcoming: [] },
      reviews: { count: 0, rating_avg: null, awaiting_reply: 0, distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0 })) },
    }));
    const view = await render(<ListingAnalytics />);
    const text = textOf(view);

    expect(text).toContain('No applications yet.');
    expect(text).toContain('No open-home bookings yet.');
    expect(text).toContain('No inspections booked ahead.');
    expect(text).toContain('No published reviews yet.');
    expect(text).toContain('Average ratingNew0 published reviews');
  });

  it('opens another range from the URL, keeping the last figures dimmed while it loads', async () => {
    const view = await render(<ListingAnalytics />);
    let finish: (value: Analytics) => void = () => {};
    mocks.listing.mockReturnValueOnce(new Promise<Analytics>((resolve) => { finish = resolve; }));

    await click(getByName(view, 'a', 'Last 90 days'));
    await act(async () => { navigation.page.land(); });
    await settle();

    expect(navigation.page.location.search).toBe('?days=90');
    expect(mocks.listing).toHaveBeenLastCalledWith('l-1', 90);
    const frame = descendants(view).find((element) => element.getAttribute('aria-busy') === 'true')!;
    expect(frame.className).toContain('opacity-60');
    expect(textOf(frame)).toContain('All time: 41');

    await act(async () => { finish(analyticsOf({ days: 90 })); });
    await settle();
    expect(descendants(view).some((element) => element.getAttribute('aria-busy') === 'true')).toBe(false);
  });

  it("says when the listing is not the owner's", async () => {
    mocks.listing.mockRejectedValue(new ApiError(404, 'Property not found'));
    const view = await render(<ListingAnalytics />);

    expect(textOf(view)).toContain('This listing could not be found');
    expect(getByName(view, 'a', 'Back to properties').getAttribute('href')).toBe('/owner/properties');
  });

  it('offers a retry when the analytics cannot load', async () => {
    mocks.listing.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<ListingAnalytics />);

    expect(textOf(view)).toContain("Couldn't load the analytics");
    expect(textOf(view)).toContain('The service is temporarily unavailable.');
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Views per day');
  });

  it('links to pages that exist, and keeps AA contrast', async () => {
    const view = await render(<ListingAnalytics />);

    for (const link of descendants(view).filter((element) => element.tagName === 'A')) {
      expect(isPageRoute(link.getAttribute('href')!.split('?')[0]), link.getAttribute('href')!).toBe(true);
    }
    expect(lowContrastText(view)).toEqual([]);
  });
});
