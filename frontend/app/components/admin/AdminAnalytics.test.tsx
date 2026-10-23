import { cleanup, click, descendants, fire, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analytics } from '@/app/lib/admin-activity-api';
import { ApiError } from '@/app/lib/api';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import AdminAnalytics from './AdminAnalytics';
import { periodLabel, scaleTop } from './ColumnChart';

const mocks = vi.hoisted(() => ({ analytics: vi.fn() }));
vi.mock('@/app/lib/admin-activity-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-activity-api')>()),
  adminActivityApi: { analytics: mocks.analytics },
}));
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => '/admin/analytics',
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

const periods = ['2026-10-18', '2026-10-19', '2026-10-20'];

function analyticsOf(over: Partial<Analytics> = {}): Analytics {
  return {
    days: 30, granularity: 'day', start: '2026-10-18', end: '2026-10-20', periods,
    series: [
      { key: 'users', label: 'New accounts', counts: [1, 0, 2], total: 3 },
      { key: 'listings', label: 'New listings', counts: [0, 0, 1], total: 1 },
      { key: 'applications', label: 'Applications', counts: [0, 2, 0], total: 2 },
      { key: 'complaints', label: 'Complaints', counts: [1, 0, 3], total: 4 },
      { key: 'reviews', label: 'Reviews', counts: [0, 0, 0], total: 0 },
    ],
    totals: { users: 140, listings: 32, applications: 51, complaints: 9, reviews: 1200 },
    complaints_by_category: [{ code: 'SAFETY', label: 'Safety', count: 2 }, { code: 'OTHER', label: 'Other', count: 1 }],
    complaints_by_status: [{ status: 'OPEN', label: 'Open', count: 3 }, { status: 'WITHDRAWN', label: 'Withdrawn', count: 0 }],
    reviews_by_status: [{ status: 'PUBLISHED', label: 'Published', count: 0 }],
    ...over,
  };
}

let leavePage = () => {};
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/admin/analytics${search}`);
  leavePage = navigation.page.install(window);
}

const figure = (view: FakeElement, title: string) =>
  descendants(view).find((element) => element.tagName === 'FIGURE' && textOf(element).startsWith(title))!;
const plotOf = (chart: FakeElement) => descendants(chart).find((element) => element.getAttribute('role') === 'group')!;

beforeEach(() => {
  vi.clearAllMocks();
  openPage();
  mocks.analytics.mockResolvedValue(analyticsOf());
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

describe('the scale and the periods', () => {
  it('round the top of the scale up to a clean number and name each period', () => {
    expect([scaleTop(0), scaleTop(3), scaleTop(7), scaleTop(12), scaleTop(30), scaleTop(1200)]).toEqual([1, 3, 10, 20, 50, 2000]);
    // en-AU shortens September to "Sept" and keeps July whole.
    expect(periodLabel('2026-09-21', 'day')).toBe('21 Sept');
    expect(periodLabel('2026-07-20', 'week')).toBe('Week of 20 July');
    expect(periodLabel('2026-10-01', 'month')).toBe('Oct 2026');
  });
});

describe('the analytics page', () => {
  it('shows a figure for each kind of row, with its total of all time', async () => {
    const view = await render(<AdminAnalytics />);

    expect(mocks.analytics).toHaveBeenCalledWith(30);
    expect(textOf(view)).toContain('18 Oct 2026 to 20 Oct 2026');
    const tiles = descendants(view).find((element) => element.getAttribute('aria-label') === 'Last 30 days')!;
    expect(descendants(tiles).filter((element) => element.tagName === 'LI').map(textOf)).toEqual([
      'New accounts3All time: 140',
      'New listings1All time: 32',
      'Applications2All time: 51',
      'Complaints4All time: 9',
      'Reviews0All time: 1,200',
    ]);
  });

  it('draws each count over time, read one period at a time by pointer or keys, and in a table', async () => {
    const view = await render(<AdminAnalytics />);
    const chart = figure(view, 'Complaints');
    const plot = plotOf(chart);
    const columns = descendants(plot).filter((element) => element.getAttribute('data-period'));

    // Each column's length is its share of the scale's top (3, the largest count).
    expect(columns.map((column) => column.children[0].style.height)).toEqual(['33.33333333333333%', '0%', '100%']);
    // React makes onPointerEnter and onPointerLeave from pointerover and pointerout, onFocus from focusin.
    await act(async () => { fire(columns[0], 'pointerover'); });
    expect(textOf(chart)).toContain('1 complaint18 Oct');

    await act(async () => { fire(columns[0], 'pointerout', { relatedTarget: null }); });
    expect(textOf(chart)).not.toContain('1 complaint18 Oct');
    await act(async () => { fire(plot, 'focusin'); });
    expect(textOf(chart)).toContain('20 Oct: 3 complaints');
    await act(async () => { fire(plot, 'keydown', { key: 'ArrowLeft' }); });
    expect(textOf(chart)).toContain('19 Oct: 0 complaints');
    await act(async () => { fire(plot, 'keydown', { key: 'Home' }); });
    expect(textOf(chart)).toContain('18 Oct: 1 complaint');

    const rows = descendants(chart).filter((element) => element.tagName === 'TR').map(textOf);
    expect(rows).toEqual(['DayComplaints', '18 Oct1', '19 Oct0', '20 Oct3']);
    expect(textOf(figure(view, 'Reviews'))).toContain('None in this range.');
  });

  it('breaks the range down by category and status', async () => {
    const view = await render(<AdminAnalytics />);

    const byCategory = figure(view, 'Complaints by category');
    expect(descendants(byCategory).filter((element) => element.tagName === 'DIV' && element.className.startsWith('grid')).map(textOf)).toEqual([
      'Safety2', 'Other1']);
    expect(textOf(figure(view, 'Complaints by status'))).toContain('Withdrawn0');
    expect(textOf(figure(view, 'Reviews by status'))).toContain('No reviews in this range.');
  });

  it('opens another range from the URL, keeping the last figures dimmed while it loads', async () => {
    const view = await render(<AdminAnalytics />);
    let finish: (value: Analytics) => void = () => {};
    mocks.analytics.mockReturnValueOnce(new Promise<Analytics>((resolve) => { finish = resolve; }));

    await click(getByName(view, 'a', 'Last 12 months'));
    await act(async () => { navigation.page.land(); });
    await settle();

    expect(navigation.page.location.search).toBe('?days=365');
    expect(mocks.analytics).toHaveBeenLastCalledWith(365);
    const frame = descendants(view).find((element) => element.getAttribute('aria-busy') === 'true')!;
    expect(frame.className).toContain('opacity-60');
    expect(textOf(frame)).toContain('All time: 140');

    await act(async () => { finish(analyticsOf({ days: 365, granularity: 'month', periods: ['2026-10-01'], series: [] })); });
    await settle();
    expect(descendants(view).some((element) => element.getAttribute('aria-busy') === 'true')).toBe(false);
    expect(textOf(view)).toContain('Per month');
  });

  it('offers a retry when the analytics cannot load', async () => {
    mocks.analytics.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<AdminAnalytics />);

    expect(textOf(view)).toContain("Couldn't load the analytics");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('New accounts');
  });

  it('keeps the page at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminAnalytics />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

it('keeps the keyboard reading within the chart\'s periods, and stops it on leaving', async () => {
  const view = await render(<AdminAnalytics />);
  const chart = figure(view, 'New accounts');
  const plot = plotOf(chart);

  await act(async () => { fire(plot, 'focusin'); fire(plot, 'keydown', { key: 'ArrowRight' }); });
  expect(textOf(chart)).toContain('20 Oct: 2 new accounts');
  await act(async () => { fire(plot, 'keydown', { key: 'End' }); fire(plot, 'focusout'); });
  expect(textOf(chart)).not.toContain('20 Oct: 2 new accounts');
});
