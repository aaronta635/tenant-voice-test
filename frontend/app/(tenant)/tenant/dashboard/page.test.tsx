import { cleanup, click, descendants, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDashboard } from '@/app/lib/api';
import { isPageRoute } from '@/app/test-utils/app-routes';
import { myProfile } from '@/app/test-utils/my-profile';
import TenantDashboardPage from './page';

const mocks = vi.hoisted(() => ({ tenant: vi.fn() }));
vi.mock('@/app/components/tenant/TenantShell', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    profiles: {
      me: async () => myProfile({ completion: { ...myProfile().completion!, score: 53, status: 'almost_ready' } }),
    },
    notifications: {
      list: async () => [{
        id: 'n1', title: 'Your application for Unit-4/12-Kingfisher-Lane-Wollongong-NSW-2500 was approved', body: null,
        link: '/tenant/applications', is_read: false, created_at: '2026-10-23T00:00:00Z',
      }],
    },
    dashboard: { tenant: mocks.tenant },
  },
}));
vi.mock('@/app/lib/onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/onboarding')>()),
  onboardingApi: { get: async () => ({ role: 'tenant', step: 'budget', completed_at: null }), save: async () => ({}) },
}));
// The tenant's scorecards (R43), whose own tests are components/tenant/TenantScorecards.test.tsx.
vi.mock('@/app/lib/scorecards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/scorecards')>()),
  scorecards: { list: async () => [] },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const NONE: TenantDashboard = {
  has_tenancy: false, listing_id: null, listing_title: null, lease: null, next_payment: null, overdue_count: 0,
  overdue_amount: 0, open_maintenance: 0, upcoming_inspections: 0, next_inspections: [], rental_history: [],
  rental_history_complete: true,
};

function leased(over: Partial<TenantDashboard> = {}): TenantDashboard {
  return {
    ...NONE,
    has_tenancy: true, listing_id: 'l-1', listing_title: 'Harbour flat',
    lease: {
      agreement_id: 'a-1', listing_id: 'l-1', listing_title: 'Harbour flat', address: '1 Harbour Street, Wollongong, NSW 2500',
      rent_amount: 1300, rent_frequency: 'FORTNIGHTLY', start_date: '2026-03-01', end_date: '2027-02-28', first_due_date: '2026-03-01',
    },
    next_payment: {
      charge_id: 'c-1', period_start: '2026-10-09', period_end: '2026-10-22', due_date: '2026-10-09', amount_due: 1300,
      amount_paid: 200, amount_outstanding: 1100, status: 'OVERDUE',
    },
    overdue_count: 1, overdue_amount: 1100, open_maintenance: 2, upcoming_inspections: 1,
    next_inspections: [{ id: 'i-1', kind: 'inspection', listing_id: 'l-1', listing_title: 'Harbour flat', starts_at: '2026-11-10T00:30:00Z', duration_minutes: null, label: 'Routine inspection' }],
    rental_history: [
      { id: 'app-1', source: 'tenantvoice', listing_id: 'l-1', title: 'Harbour flat', address: '1 Harbour Street, Wollongong, NSW, 2500',
        start_date: '2026-03-01', end_date: '2027-03-01', current: true, weekly_rent: 650, landlord_name: 'Olivia Owner' },
      { id: 'first-home', source: 'self_reported', listing_id: null, title: null, address: '4 River Road, Penrith, NSW',
        start_date: '2019-02-01', end_date: '2021-01-31', current: false, weekly_rent: 390, landlord_name: 'Pat Lee' },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mocks.tenant.mockReset();
  mocks.tenant.mockResolvedValue(NONE);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

const classesOf = (element: FakeElement) => element.className.split(/\s+/);

describe('the tenant dashboard', () => {
  it('shows the completion the server worked out, as the completion page does', async () => {
    // Name, email, phone, suburb and state are filled in: counting those fields said 83%.
    const view = await render(<TenantDashboardPage />);

    expect(textOf(view)).toContain('53% Complete');
  });

  it('lets the tenant request a scorecard and see their requests', async () => {
    const view = await render(<TenantDashboardPage />);
    const button = descendants(view).find((element) => element.tagName === 'BUTTON' && textOf(element) === 'Request scorecard');

    expect(button).toBeDefined();
    expect(textOf(view)).toContain('No scorecard requests yet.');
    expect(descendants(view).some((element) => element.id === 'scorecards')).toBe(true);
  });

  it("keeps the tiles to a phone's width: their column shrinks and the text is cut, not the page widened", async () => {
    const view = await render(<TenantDashboardPage />);
    const tile = descendants(view).find((element) => element.tagName === 'A' && element.getAttribute('href') === '/tenant/properties');

    expect(tile?.parentElement?.className.split(' ')).toContain('grid-cols-1');
  });

  it('offers to finish a setup the tenant skipped or closed', async () => {
    const view = await render(<TenantDashboardPage />);

    expect(textOf(view)).toContain('Finish setting up your profile');
    expect(textOf(view)).toContain('Pick up at "Rent and timing".');
  });

  it('shows the active lease and the next rent payment, with no demo label', async () => {
    mocks.tenant.mockResolvedValue(leased());
    const view = await render(<TenantDashboardPage />);
    const text = textOf(view);

    expect(text).toContain('Current leaseHarbour flat1 Harbour Street, Wollongong, NSW 2500');
    expect(text).toContain('$1,300 per fortnight · from 1 Mar 2026 to 28 Feb 2027');
    expect(text).toContain('Next rent payment$1,100.00OverdueDue 9 Oct 2026, for 9 Oct 2026 to 22 Oct 2026 · $200.00 of $1,300.00 paid');
    expect(text).toContain('Overdue: $1,100.00 across 1 charge.');
    expect(text).toContain('Open repairs: 2 · Upcoming inspections: 1');
    expect(text).not.toMatch(/demo/i);
  });

  it('says when nothing is due, or when the first rent falls due', async () => {
    mocks.tenant.mockResolvedValue(leased({ next_payment: null, overdue_count: 0, overdue_amount: 0 }));
    const paidUp = await render(<TenantDashboardPage />);
    expect(textOf(paidUp)).toContain('Next rent paymentNothing is due right now.');
    await cleanup();

    const lease = { ...leased().lease!, first_due_date: '2099-01-10' };
    mocks.tenant.mockResolvedValue(leased({ lease, next_payment: null, overdue_count: 0, overdue_amount: 0 }));
    const first = await render(<TenantDashboardPage />);
    expect(textOf(first)).toContain('Your first rent is due 10 Jan 2099.');
    expect(textOf(first)).not.toContain('Overdue');
  });

  it('lists the inspections to come in Sydney time', async () => {
    mocks.tenant.mockResolvedValue(leased());
    const view = await render(<TenantDashboardPage />);

    expect(textOf(view)).toContain('Upcoming inspectionsRoutine inspection · Harbour flatTue, 10 Nov, 11:30 am');
  });

  it('lists the tenancies on TenantVoice and the ones the tenant added', async () => {
    mocks.tenant.mockResolvedValue(leased());
    const view = await render(<TenantDashboardPage />);
    const history = descendants(view).find((element) => element.tagName === 'H2' && textOf(element) === 'Rental history')!.parentElement!.parentElement!;
    const items = descendants(history).filter((element) => element.tagName === 'LI').map(textOf);

    expect(items).toEqual([
      'Harbour flatOn TenantVoice1 Harbour Street, Wollongong, NSW, 25001 Mar 2026 to now · $650 per week',
      '4 River Road, Penrith, NSWAdded by you1 Feb 2019 to 31 Jan 2021 · $390 per week',
    ]);
    expect(getByName(view, 'a', 'Add an address').getAttribute('href')).toBe('/tenant/address-history');
    expect(isPageRoute('/tenant/address-history')).toBe(true);
  });

  it('says when the TenantVoice tenancies could not be read', async () => {
    mocks.tenant.mockResolvedValue(leased({ rental_history: [leased().rental_history[1]], rental_history_complete: false }));
    const view = await render(<TenantDashboardPage />);

    expect(textOf(view)).toContain("Your tenancies on TenantVoice couldn't be loaded right now. The addresses you added are shown.");
    expect(textOf(view)).toContain('4 River Road, Penrith, NSW');
  });

  it('shows a tenant without a lease where it will appear', async () => {
    mocks.tenant.mockResolvedValue({ ...NONE, open_maintenance: 1 });
    const view = await render(<TenantDashboardPage />);
    const text = textOf(view);

    expect(text).toContain('No active tenancy');
    expect(text).toContain('1 repair is still open.');
    expect(text).toContain('No tenancies yet.');
    expect(text).not.toContain('Upcoming inspections');
  });

  it('says when the tenancy cannot be loaded, rather than that there is none', async () => {
    mocks.tenant.mockRejectedValueOnce(new Error('offline'));
    const view = await render(<TenantDashboardPage />);

    expect(textOf(view)).toContain("Your tenancy couldn't be loaded");
    expect(textOf(view)).not.toContain('No active tenancy');
    mocks.tenant.mockResolvedValue(leased());
    await click(getByName(view, 'button', 'Try again'));

    expect(textOf(view)).toContain('Current lease');
  });
});

describe('the tenant dashboard on a phone', () => {
  // Measured in Chrome at 320px: the tiles' descriptions, kept on one line, made the grid's one
  // column 374px wide, so the page scrolled sideways from 320 to 390px.
  it('keeps the tiles to the screen: one column that may shrink, and descriptions that wrap', async () => {
    const view = await render(<TenantDashboardPage />);

    const tile = getByName(view, 'a', 'Ratings & ReviewsWrite and submit rental reviews');
    expect(classesOf(tile)).toContain('min-w-0');
    expect(classesOf(tile.parentElement as FakeElement)).toEqual(expect.arrayContaining(['grid', 'grid-cols-1', 'md:grid-cols-2']));
    const description = descendants(tile).find((element) => textOf(element) === 'Write and submit rental reviews')!;
    expect(classesOf(description)).toContain('line-clamp-2');
    expect(classesOf(description)).not.toContain('truncate');
    expect(classesOf(descendants(view).find((element) => element.tagName === 'ASIDE')!)).toContain('min-w-0');
  });

  it('wraps a long name, listing title or notice rather than running off the screen', async () => {
    const view = await render(<TenantDashboardPage />);

    expect(classesOf(descendants(view).find((element) => element.tagName === 'H1')!)).toContain('break-words');
    const notice = descendants(view).find((element) => element.tagName === 'P' && textOf(element).startsWith('Your application for'))!;
    expect(classesOf(notice)).toContain('break-words');
    expect(classesOf(notice.parentElement as FakeElement)).toContain('min-w-0');
  });
});

describe('the tenant dashboard links', () => {
  it('shows View Messages, View All and Finish Setup at AA contrast, also under the pointer', async () => {
    const view = await render(<TenantDashboardPage />);

    for (const link of [getByName(view, 'a', 'View Messages'), getByName(view, 'a', 'View All'), getByName(view, 'a', 'Finish Setup ›')]) {
      expect(lowContrastText(link)).toEqual([]);
      expect(lowContrastText(hovered(link))).toEqual([]);
    }
  });

  it('underlines the text links, which sit beside text of a near colour', async () => {
    const view = await render(<TenantDashboardPage />);

    expect(getByName(view, 'a', 'View All').getAttribute('href')).toBe('/tenant/notifications');
    expect(classesOf(getByName(view, 'a', 'View All'))).toContain('underline');
    expect(getByName(view, 'a', 'Finish Setup ›').getAttribute('href')).toBe('/tenant/profile-completion');
    expect(classesOf(getByName(view, 'a', 'Finish Setup ›'))).toContain('underline');
  });

  it('makes each quick action one link, with no button inside it', async () => {
    const view = await render(<TenantDashboardPage />);

    for (const [name, href] of [['View Messages', '/tenant/messages'], ['Recommendations', '/tenant/recommendations'],
      ['Submit Repair Request', '/tenant/maintenance']]) {
      const link = getByName(view, 'a', name);
      expect(link.getAttribute('href')).toBe(href);
      expect(descendants(link).filter((element) => element.tagName === 'BUTTON')).toEqual([]);
    }
  });
});
