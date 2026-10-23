import { cleanup, click, descendants, getByName, render, settle, textOf } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { ComplaintSummary, HousingOverview as Overview } from '@/app/lib/housing-api';
import HousingComplaints from './HousingComplaints';
import HousingOverview from './HousingOverview';

const mocks = vi.hoisted(() => ({ overview: vi.fn(), complaints: vi.fn(), download: vi.fn() }));
vi.mock('@/app/lib/housing-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/housing-api')>()),
  housingApi: { overview: mocks.overview, complaints: mocks.complaints },
}));
vi.mock('@/app/lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/csv')>()),
  downloadCsv: mocks.download,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const count = (key: string, label: string, value: number) => ({ key, label, count: value });
const STATUSES = [count('OPEN', 'Open', 2), count('IN_REVIEW', 'In review', 1), count('ESCALATED', 'Escalated', 0), count('RESOLVED', 'Resolved', 3), count('CLOSED', 'Closed', 0)];
const COMPLAINTS: ComplaintSummary = {
  total: 6, open: 3, statuses: STATUSES,
  severities: [count('LOW', 'Low', 1), count('MEDIUM', 'Medium', 3), count('HIGH', 'High', 2), count('CRITICAL', 'Critical', 0)],
  categories: [{ code: 'MAINTENANCE', label: 'Maintenance', total: 6, statuses: STATUSES, median_days_to_resolve: 2.5 }],
  median_days_to_resolve: 2.5,
};
const OVERVIEW: Overview = {
  complaints: COMPLAINTS,
  reviews: {
    total: 4, statuses: [count('PUBLISHED', 'Published', 3)], visible: 3, property_reviews: 2, verified: 1, average_rating: 3.67,
    average_landlord_rating: 2.5, distribution: [count('1', '1 star', 0), count('4', '4 stars', 2)],
  },
  red_flags: { events: [count('OPEN', 'Open', 1)], open_events: 1, alerts: [count('New', 'New', 2)], open_alerts: 2 },
  referrals: { total: 2, open: 1, statuses: [count('REFERRED', 'New', 1), count('CLOSED', 'Closed', 1)] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.overview.mockResolvedValue(OVERVIEW);
  mocks.complaints.mockResolvedValue(COMPLAINTS);
});
afterEach(cleanup);

describe('the portal overview', () => {
  it('counts complaints, reviews, red flags and referrals', async () => {
    let finish!: (value: Overview) => void;
    mocks.overview.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = await render(<HousingOverview />);
    expect(descendants(view).some((element) => element.getAttribute('aria-label') === 'Loading the overview')).toBe(true);

    finish(OVERVIEW);
    await settle();

    expect(textOf(view)).toContain('Open complaints3Of 6 lodged');
    expect(textOf(view)).toContain('Average rating3.7 out of 5Over 3 reviews shown');
    expect(textOf(view)).toContain('Open red flags31 events, 2 regulatory alerts');
    expect(textOf(view)).toContain('Open referrals1Of 2 referred');
    expect(textOf(view)).toContain('Maintenance2103062.5');
    expect(getByName(view, 'a', 'Open the referrals').getAttribute('href')).toBe('/housing/referrals');
  });

  it('downloads the complaint table as shown', async () => {
    const view = await render(<HousingOverview />);

    await click(getByName(view, 'button', 'Download CSV of complaints by category and status'));

    expect(mocks.download.mock.calls[0][1]).toBe(
      'Category,Open,In review,Escalated,Resolved,Closed,Total,Median days to resolve\r\nMaintenance,2,1,0,3,0,6,2.5\r\n',
    );
  });

  it('offers a retry when it cannot load', async () => {
    mocks.overview.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<HousingOverview />);

    expect(textOf(view)).toContain("Couldn't load the overview");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Open complaints3');
  });

  it('keeps its text at AA contrast, also under the pointer', async () => {
    const view = await render(<HousingOverview />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe('complaint status and tribunal outcomes', () => {
  it('shows the real statuses, and the tribunal outcomes only as labelled examples', async () => {
    const view = await render(<HousingComplaints />);

    expect(textOf(view)).toContain('Complaints lodged6');
    expect(textOf(view)).toContain('Median time to resolve2.5 days');
    expect(textOf(view)).toContain('Demo: Sample tribunal outcomes: TenantVoice receives no NCAT decisions yet.');
    const examples = descendants(view).filter((element) => element.hasAttribute('data-demo-label'));
    expect(examples).toHaveLength(5); // the notice and a pill on each of the four examples
    expect(lowContrastText(view)).toEqual([]);
  });

  it('marks every example as a sample in its CSV', async () => {
    const view = await render(<HousingComplaints />);

    await click(getByName(view, 'button', 'Download CSV of tribunal outcomes (examples)'));

    const rows = mocks.download.mock.calls[0][1].trim().split('\r\n').slice(1);
    expect(rows).toHaveLength(4);
    expect(rows.every((row: string) => row.endsWith(',"Sample, not a real outcome"'))).toBe(true);
  });

  it('still shows the labelled examples when the statuses cannot load', async () => {
    mocks.complaints.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<HousingComplaints />);

    expect(textOf(view)).toContain("Couldn't load the complaint statuses");
    expect(textOf(view)).toContain('Tribunal outcomes (examples)');
  });
});
