import { cleanup, descendants, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Booking, Conversation, Profile, ProviderDashboard, ServiceProvider } from '@/app/lib/api';
import ProviderOverviewPage from './page';

const mockApi = vi.hoisted(() => ({
  profiles: { me: vi.fn() },
  providers: { mine: vi.fn(), myReviews: vi.fn() },
  dashboard: { provider: vi.fn() },
  bookings: { list: vi.fn() },
  conversations: { list: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const ME = { id: 'sam', role: 'service_provider', full_name: 'Sam Provider' } as Profile;
const PROVIDER = { id: 'prov-1', profile_id: 'sam', is_published: true, profile_completion: 100 } as ServiceProvider;
const STATS: ProviderDashboard = {
  active_bookings: 0, new_enquiries: 0, due_this_week: 0, overdue_bookings: 0, completed_bookings: 0,
  month_earnings: 0, previous_month_earnings: 0, month_change_pct: null, rating_avg: 0, review_count: 0,
  awaiting_reply: 0, unread_messages: 0, profile_completion: 100, service_count: 0, published_service_count: 0,
  draft_service_count: 0, booking_conversion_pct: null, total_enquiries: 0,
};

function thread(overrides: Partial<Conversation>): Conversation {
  return {
    id: 't1', kind: 'marketplace', client_id: 'mei', provider_id: 'prov-1', owner_id: null, tenant_id: null,
    property_id: null, booking_id: null, subject: null, last_message_at: '2026-10-21T00:00:00Z',
    created_at: '2026-10-20T00:00:00Z', counterpart_id: 'mei', counterpart_name: 'Mei Tanaka',
    counterpart_role: 'tenant', counterpart_avatar_url: null, context: null, last_message: 'Hello',
    last_message_sender_id: 'mei', unread_count: 0, booking: null,
    ...overrides,
  };
}

/** The <section> headed `heading`. */
function section(view: FakeElement, heading: string) {
  const found = descendants(view).find((element) => element.tagName === 'SECTION'
    && descendants(element).some((child) => child.tagName === 'H2' && textOf(child) === heading));
  if (!found) throw new Error(`No section headed ${heading}`);
  return found;
}

function items(container: FakeElement) {
  return descendants(container).filter((element) => element.tagName === 'LI');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.profiles.me.mockResolvedValue(ME);
  mockApi.providers.mine.mockResolvedValue(PROVIDER);
  mockApi.dashboard.provider.mockResolvedValue(STATS);
  mockApi.bookings.list.mockResolvedValue([] as Booking[]);
  mockApi.conversations.list.mockResolvedValue([]);
  mockApi.providers.myReviews.mockResolvedValue([]);
});
afterEach(cleanup);

describe('Overview recent messages', () => {
  it("marks the provider's own last message instead of showing it under the client's name", async () => {
    mockApi.conversations.list.mockResolvedValue([
      thread({ id: 't1', last_message: 'Yes, see you at 10am', last_message_sender_id: 'sam' }),
      thread({ id: 't2', counterpart_name: 'Tom Client', last_message: 'Can you quote?', last_message_sender_id: 'tom' }),
      thread({ id: 't3', counterpart_name: 'Ana Owner', last_message: '', last_message_sender_id: 'ana' }),
      thread({ id: 't4', counterpart_name: 'Lee New', last_message: null, last_message_sender_id: null }),
    ]);
    const view = await render(<ProviderOverviewPage />);
    const [own, theirs, attachment, empty] = items(section(view, 'Recent messages')).map(textOf);

    expect(own).toContain('Mei Tanaka');
    expect(own).toContain('You: Yes, see you at 10am');
    expect(theirs).toContain('Can you quote?');
    expect(theirs).not.toContain('You:');
    expect(attachment).toContain('Sent an attachment');
    expect(empty).toContain('No messages yet');
  });

  it('says a thread is unread in words and keeps its dot in forced colours', async () => {
    mockApi.conversations.list.mockResolvedValue([
      thread({ id: 't1', unread_count: 2 }),
      thread({ id: 't2', counterpart_name: 'Tom Client', unread_count: 0 }),
    ]);
    const view = await render(<ProviderOverviewPage />);
    const [unread, read] = items(section(view, 'Recent messages'));
    const dot = descendants(unread).find((element) => element.className.split(/\s+/).includes('size-2'));

    expect(textOf(unread)).toMatch(/Unread$/);
    expect(textOf(read)).not.toContain('Unread');
    expect(dot?.className.split(/\s+/)).toContain('forced-colors:bg-[Highlight]');
  });
});

function booking(overrides: Partial<Booking>): Booking {
  return {
    id: 'b1', client_id: 'mei', provider_id: 'prov-1', service_id: 's1', status: 'confirmed',
    property_address: null, property_suburb: null, scheduled_date: '2026-10-21', scheduled_time: '09:00:00',
    price: 150, notes: null, completion_report: null, created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z', client_name: 'Mei Tanaka', client_avatar_url: null, provider_name: null,
    service_title: 'Bond clean', review_rating: null, unread_count: 0, conversation_id: null,
    ...overrides,
  };
}

describe('Overview with a fixed clock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T01:00:00Z')); // 12:00 pm, Wednesday 21 October, in Sydney
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads out what each calendar day holds as text, with no aria-label on the days', async () => {
    mockApi.bookings.list.mockResolvedValue([
      booking({ id: 'today-job', status: 'in_progress', scheduled_date: '2026-10-21' }),
      booking({ id: 'enquiry', status: 'new_enquiry', scheduled_date: '2026-10-23' }),
    ]);
    const view = await render(<ProviderOverviewPage />);
    const calendar = section(view, 'October 2026');
    const days = descendants(calendar).filter((element) => element.hasAttribute('title'));

    expect(days).toHaveLength(31);
    expect(textOf(days[0])).toBe('Thursday 1');
    expect(textOf(days[20])).toBe('Wednesday 21, today, confirmed booking');
    expect(textOf(days[22])).toBe('Friday 23, unaccepted enquiry');
    // Only the month buttons are named; the single-letter weekdays are for sight only.
    const named = descendants(calendar).filter((element) => element.hasAttribute('aria-label'));
    expect(named.map((element) => element.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    const letters = descendants(calendar).find((element) => textOf(element) === 'MTWTFSS');
    expect(letters?.getAttribute('aria-hidden')).toBe('true');
  });

  it('says an enquiry is past its date, and calls only accepted jobs past their day overdue', async () => {
    mockApi.bookings.list.mockResolvedValue([
      booking({ id: 'stale-enquiry', client_name: 'Ana Owner', status: 'new_enquiry', scheduled_date: '2026-10-19' }),
      booking({ id: 'late-job', client_name: 'Tom Client', status: 'confirmed', scheduled_date: '2026-10-20' }),
      booking({ id: 'started-today', status: 'in_progress', scheduled_date: '2026-10-21', scheduled_time: '08:00:00' }),
    ]);
    const view = await render(<ProviderOverviewPage />);
    const [stale, late, startedToday] = items(section(view, 'Upcoming and overdue jobs')).map(textOf);

    expect(stale).toContain('Ana Owner');
    expect(stale).toContain('Date passed');
    expect(stale).not.toContain('Overdue');
    expect(late).toContain('Overdue');
    expect(late).not.toContain('Date passed');
    expect(startedToday).not.toMatch(/Overdue|Date passed/);
  });
});

describe('Overview rating card', () => {
  /** The stat card's label, value and hint, in order. */
  async function ratingCard() {
    const view = await render(<ProviderOverviewPage />);
    const label = descendants(view).find((element) => element.tagName === 'P' && textOf(element) === 'Avg rating');
    return label?.parentElement?.children.map(textOf);
  }

  it('counts one review in the singular', async () => {
    mockApi.dashboard.provider.mockResolvedValue({ ...STATS, rating_avg: 5, review_count: 1 });
    expect(await ratingCard()).toEqual(['Avg rating', '5.0', '1 review']);
  });

  it('counts other numbers of reviews in the plural', async () => {
    mockApi.dashboard.provider.mockResolvedValue({ ...STATS, rating_avg: 4.67, review_count: 3 });
    expect(await ratingCard()).toEqual(['Avg rating', '4.7', '3 reviews']);
    await cleanup();
    mockApi.dashboard.provider.mockResolvedValue(STATS);
    expect(await ratingCard()).toEqual(['Avg rating', '—', '0 reviews']);
  });
});

describe('Overview avatars', () => {
  it('hides the initials from screen readers, which read the name beside them', async () => {
    mockApi.bookings.list.mockResolvedValue([booking({})]);
    mockApi.conversations.list.mockResolvedValue([thread({})]);
    const view = await render(<ProviderOverviewPage />);

    for (const heading of ['Upcoming and overdue jobs', 'Recent messages']) {
      const [row] = items(section(view, heading));
      const initials = descendants(row).filter((element) => textOf(element) === 'MT');
      expect(textOf(row)).toContain('Mei Tanaka');
      expect(initials).toHaveLength(1);
      expect(initials[0].getAttribute('aria-hidden')).toBe('true');
    }
  });
});
