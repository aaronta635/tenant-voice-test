import { cleanup, click, descendants, getByName, render, textOf, type FakeElement } from './test-dom';
import { lowContrastText } from './test-contrast';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, ProviderFinance } from '@/app/lib/api';
import FilterChip from './FilterChip';
import ComplaintsPage from '@/app/(dashboard)/dashboard/complaints/page';
import ReviewsPage from '@/app/(dashboard)/dashboard/reviews/page';
import FinancesPage from '@/app/(dashboard)/dashboard/finances/page';
import BookingList from '@/app/components/bookings/BookingList';
import ConversationsView from '@/app/components/messaging/ConversationsView';

vi.mock('next/link', () => ({
  default: ({ href, scroll, children, ...props }: { href: string; scroll?: boolean; children: ReactNode }) => (
    <a href={href} data-scroll={scroll === undefined ? undefined : String(scroll)} {...props}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const thread = {
  id: 't1', kind: 'marketplace', counterpart_name: 'Cleo Client', counterpart_role: 'tenant', context: null,
  last_message: 'Can you quote?', last_message_at: '2026-10-21T01:00:00Z', unread_count: 0, booking: null,
} as Conversation;
const finance: ProviderFinance = {
  available_balance: 0, pending_payments: 0, month_earnings: 0, total_payouts: 0, upcoming_payouts: 0,
  ytd_earnings: 0, lifetime_earnings: 0, yoy_change_pct: null, monthly: [],
};
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    complaints: { listAgainstMe: async () => [] },
    providers: { mine: async () => ({ id: 'provider-1', is_published: true }), myReviews: async () => [] },
    bookings: { list: async () => [] },
    dashboard: { providerFinance: async () => finance },
    finance: { transactions: async () => [], invoices: async () => [] },
    conversations: { list: async () => [thread] },
    profiles: { me: async () => ({ id: 'provider-user', role: 'service_provider' }) },
  },
}));

afterEach(cleanup);

const chipsIn = (group: FakeElement) => descendants(group).filter((element) => ['BUTTON', 'A'].includes(element.tagName));
const isSelected = (chip: FakeElement) => chip.getAttribute('aria-pressed') === 'true' || chip.getAttribute('aria-current') === 'page';
const checkMarks = (chip: FakeElement) => chip.querySelectorAll('svg');

async function chipClasses() {
  const view = await render(<div><FilterChip selected>On</FilterChip><FilterChip selected={false}>Off</FilterChip></div>);
  const [selected, other] = view.querySelectorAll('button').map((chip) => chip.className);
  await cleanup();
  return { selected, other };
}

describe('FilterChip', () => {
  it('marks the selected chip with a check mark and bold text as well as its fill', async () => {
    const view = await render(<div><FilterChip selected>All</FilterChip><FilterChip selected={false}>Unread</FilterChip></div>);
    const [selected, other] = view.querySelectorAll('button');

    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(other.getAttribute('aria-pressed')).toBe('false');
    expect(checkMarks(selected)).toHaveLength(1);
    expect(checkMarks(selected)[0].getAttribute('aria-hidden')).toBe('true');
    expect(checkMarks(other)).toHaveLength(0);
    expect(selected.className.split(' ')).toContain('font-bold');
    expect(other.className.split(' ')).not.toContain('font-bold');
    expect(textOf(selected)).toBe('All');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('keeps one size and shape in both states', async () => {
    const view = await render(<div><FilterChip selected>All</FilterChip><FilterChip selected={false}>Unread</FilterChip></div>);
    const shape = (chip: FakeElement) => chip.className.split(' ').filter((utility) => /^(min-h-|rounded-|px-|py-|text-sm$|border$)/.test(utility));
    const [selected, other] = view.querySelectorAll('button');

    expect(shape(selected)).toEqual(['min-h-11', 'rounded-full', 'border', 'px-4', 'py-2', 'text-sm']);
    expect(shape(other)).toEqual(shape(selected));
  });

  it('links to a section and marks only the current one', async () => {
    const view = await render(<nav><FilterChip href="/dashboard/finances?section=overview" selected>Overview</FilterChip><FilterChip href="/dashboard/finances?section=invoices" selected={false}>Invoices</FilterChip></nav>);
    const [current, other] = view.querySelectorAll('a');

    expect(current.getAttribute('href')).toBe('/dashboard/finances?section=overview');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(other.hasAttribute('aria-current')).toBe(false);
    expect(current.hasAttribute('aria-pressed')).toBe(false);
    expect(checkMarks(current)).toHaveLength(1);
  });
});

describe('provider filter rows', () => {
  const rows: [string, () => ReactElement, string][] = [
    ['Reviews', () => <ReviewsPage />, 'Filter reviews'],
    ['Complaints', () => <ComplaintsPage />, 'Filter complaints'],
    ['Bookings', () => <BookingList />, 'Booking status'],
    ['Finance sections', () => <FinancesPage />, 'Finance sections'],
    ['Finance period', () => <FinancesPage />, 'Earnings period'],
    ['Messages', () => <ConversationsView title="Messages" emptyMessage="No conversations yet." showFilters />, 'Filter conversations'],
  ];

  it.each(rows)('%s use the shared chip, with one selected chip that has a check mark', async (_page, page, label) => {
    const { selected, other } = await chipClasses();
    const view = await render(page());
    const chips = chipsIn(descendants(view).find((element) => element.getAttribute('aria-label') === label) as FakeElement);

    expect(chips.length).toBeGreaterThan(1);
    expect(chips.filter(isSelected)).toHaveLength(1);
    for (const chip of chips) {
      expect(chip.className).toBe(isSelected(chip) ? selected : other);
      expect(checkMarks(chip)).toHaveLength(isSelected(chip) ? 1 : 0);
    }
    expect(lowContrastText(view)).toEqual([]);
  });

  it('moves the check mark with the selection', async () => {
    const view = await render(<ComplaintsPage />);
    await click(getByName(view, 'button', 'Open'));

    expect(getByName(view, 'button', 'Open').getAttribute('aria-pressed')).toBe('true');
    expect(checkMarks(getByName(view, 'button', 'Open'))).toHaveLength(1);
    expect(checkMarks(getByName(view, 'button', 'All'))).toHaveLength(0);
  });

  it('keeps the finance sections from scrolling the page to the top', async () => {
    const view = await render(<FinancesPage />);
    const sections = chipsIn(descendants(view).find((element) => element.getAttribute('aria-label') === 'Finance sections') as FakeElement);

    expect(sections.map((chip) => chip.getAttribute('data-scroll'))).toEqual(['false', 'false', 'false', 'false']);
  });
});
