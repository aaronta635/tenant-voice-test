'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  api,
  safe,
  type Booking,
  type Conversation,
  type Profile,
  type ProviderDashboard,
  type Review,
} from '@/app/lib/api';
import {
  formatMoney,
  formatPercent,
  formatSchedule,
  initialsOf,
  messageTimestamp,
} from '@/app/lib/format';

const ACTIVE_STATUSES = new Set(['new_enquiry', 'confirmed', 'in_progress']);

export default function ProviderOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<ProviderDashboard | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [me, dashboard, bookingList, conversationList, reviewList] = await Promise.all([
        safe(api.profiles.me(), null),
        safe<ProviderDashboard | null>(api.dashboard.provider(), null),
        safe(api.bookings.list(), []),
        safe(api.conversations.list(), []),
        safe(api.providers.myReviews(), []),
      ]);
      if (!active) return;
      setProfile(me);
      setStats(dashboard);
      setBookings(bookingList);
      setConversations(conversationList);
      setReviews(reviewList);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const upcoming = useMemo(
    () =>
      bookings
        .filter((b) => ACTIVE_STATUSES.has(b.status) && b.scheduled_date)
        .sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? ''))
        .slice(0, 4),
    [bookings],
  );

  // Calendar highlights come from the booking dates in the current month.
  const { monthLabel, days, highlighted, leadingBlanks } = useMemo(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const prefix = (first.getDay() + 6) % 7; // Monday-first grid
    const marks = new Set(
      bookings
        .map((b) => b.scheduled_date)
        .filter((d): d is string => !!d)
        .filter((d) => d.startsWith(now.toISOString().slice(0, 7)))
        .map((d) => Number(d.slice(8, 10))),
    );
    return {
      monthLabel: now.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
      days: Array.from({ length: total }, (_, i) => i + 1),
      highlighted: marks,
      leadingBlanks: prefix,
    };
  }, [bookings]);

  const statCards = stats
    ? [
        {
          label: 'Active bookings',
          value: String(stats.active_bookings),
          hint: `${stats.due_this_week} due this week`,
        },
        {
          label: 'New enquiries',
          value: String(stats.new_enquiries),
          hint: stats.new_enquiries > 0 ? 'Respond to keep your rank' : 'All caught up',
        },
        {
          label: 'This month',
          value: formatMoney(stats.month_earnings),
          hint:
            stats.month_change_pct === null
              ? 'No comparison yet'
              : `${formatPercent(stats.month_change_pct)} vs last month`,
        },
        {
          label: 'Avg rating',
          value: stats.rating_avg ? stats.rating_avg.toFixed(2) : '—',
          hint: `${stats.review_count} reviews`,
        },
      ]
    : [];

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">Provider workspace</p>
          <h1 className="text-[36px] font-extrabold tracking-tight text-[#1b1b1f]">
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-[#5f6b76]">
            Here&apos;s what&apos;s happening with your services today.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/profile"
            className="inline-flex h-10 items-center rounded-full border border-[#efeff2] bg-white px-4 text-sm font-semibold text-[#1b1b1f]"
          >
            My profile
          </Link>
          <Link
            href="/dashboard/bookings"
            className="inline-flex h-10 items-center rounded-full border border-[#efeff2] bg-white px-4 text-sm font-semibold text-[#1b1b1f]"
          >
            View bookings
          </Link>
          <Link
            href="/dashboard/services"
            className="inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-bold text-white"
          >
            Manage services
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="text-[#5f6b76]">Loading your workspace…</p>
      ) : !stats ? (
        <EmptyCard
          title="No provider profile yet"
          body="Complete onboarding to create your provider profile — the dashboard fills in from your live bookings, messages and reviews."
          href="/dashboard/onboarding"
          cta="Start onboarding"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {statCards.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[18px] border border-[#efeff2] bg-white p-5 shadow-[0_1px_1px_rgba(14,42,72,0.04)]"
              >
                <p className="text-xs font-bold tracking-wide text-[#8c97a2] uppercase">
                  {stat.label}
                </p>
                <p className="mt-2 text-3xl font-extrabold text-[#1b1b1f]">{stat.value}</p>
                <p className="mt-1 text-sm text-[#5f6b76]">{stat.hint}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <section className="rounded-[20px] border border-[#efeff2] bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#1b1b1f]">{monthLabel}</h2>
                <span className="text-xs font-semibold text-[#8c97a2]">Calendar</span>
              </div>
              <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[#8c97a2]">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <span key={d}>{d.charAt(0)}</span>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1">
                {Array.from({ length: leadingBlanks }).map((_, i) => (
                  <span key={`pad-${i}`} />
                ))}
                {days.map((day) => {
                  const booked = highlighted.has(day);
                  return (
                    <span
                      key={day}
                      title={booked ? 'Booking scheduled' : undefined}
                      className={`flex aspect-square items-center justify-center rounded-full text-xs font-semibold ${
                        booked ? 'bg-primary text-white' : 'text-[#5f6b76] hover:bg-[#eeeffd]'
                      }`}
                    >
                      {day}
                    </span>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[20px] border border-[#efeff2] bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#1b1b1f]">Upcoming jobs</h2>
                <Link href="/dashboard/bookings" className="text-sm font-semibold text-primary">
                  See all →
                </Link>
              </div>
              {upcoming.length === 0 ? (
                <p className="mt-6 text-sm text-[#8c97a2]">Nothing scheduled yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {upcoming.map((job) => (
                    <li
                      key={job.id}
                      className="flex items-center gap-3 rounded-[14px] border border-[#f4f4f8] px-3 py-3"
                    >
                      <div className="flex size-10 items-center justify-center rounded-full bg-[#eeeffd] text-xs font-bold text-[#0e2a48]">
                        {initialsOf(job.client_name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-[#1b1b1f]">
                          {job.client_name ?? 'Client'}
                        </p>
                        <p className="truncate text-xs text-[#5f6b76]">
                          {job.service_title ?? 'Service'} ·{' '}
                          {formatSchedule(job.scheduled_date, job.scheduled_time)}
                        </p>
                      </div>
                      <StatusPill status={job.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-[20px] border border-[#efeff2] bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#1b1b1f]">Recent messages</h2>
                <Link href="/dashboard/messages" className="text-sm font-semibold text-primary">
                  Inbox →
                </Link>
              </div>
              {conversations.length === 0 ? (
                <p className="mt-6 text-sm text-[#8c97a2]">No conversations yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {conversations.slice(0, 4).map((thread) => (
                    <li
                      key={thread.id}
                      className="flex gap-3 border-b border-[#f4f4f8] pb-3 last:border-0"
                    >
                      <div className="flex size-10 items-center justify-center rounded-full bg-[#eeeffd] text-xs font-bold text-[#0e2a48]">
                        {initialsOf(thread.counterpart_name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-[#1b1b1f]">
                            {thread.counterpart_name ?? 'Client'}
                          </p>
                          <span className="text-xs text-[#8c97a2]">
                            {messageTimestamp(thread.last_message_at)}
                          </span>
                        </div>
                        {thread.context ? (
                          <p className="truncate text-xs text-[#8c97a2]">{thread.context}</p>
                        ) : null}
                        <p className="mt-0.5 truncate text-sm text-[#5f6b76]">
                          {thread.last_message ?? 'No messages yet'}
                        </p>
                      </div>
                      {thread.unread_count > 0 ? (
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-[20px] border border-[#efeff2] bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#1b1b1f]">Latest reviews</h2>
                <Link href="/dashboard/reviews" className="text-sm font-semibold text-primary">
                  Manage →
                </Link>
              </div>
              {reviews.length === 0 ? (
                <p className="mt-6 text-sm text-[#8c97a2]">No reviews yet.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {reviews.slice(0, 3).map((review) => (
                    <li key={review.id} className="rounded-[14px] bg-[#fafafe] p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-[#1b1b1f]">
                          {review.client_name ?? 'Verified client'}
                        </p>
                        <span className="text-sm font-semibold text-[#0e2a48]">
                          {'★'.repeat(review.rating)}
                        </span>
                      </div>
                      {review.comment ? (
                        <p className="mt-1 line-clamp-2 text-sm text-[#5f6b76]">{review.comment}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new_enquiry: 'bg-[#eeeffd] text-primary',
    confirmed: 'bg-[#fff4e5] text-[#b86e00]',
    in_progress: 'bg-[#e6f4ed] text-[#1b7c4f]',
  };
  const labels: Record<string, string> = {
    new_enquiry: 'New',
    confirmed: 'Confirmed',
    in_progress: 'Active',
  };
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${styles[status] ?? 'bg-[#f4f4f8] text-[#5f6b76]'}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function EmptyCard({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-[20px] border border-dashed border-[#c5cad3] bg-white p-10 text-center">
      <p className="font-bold text-[#1b1b1f]">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[#5f6b76]">{body}</p>
      <Link
        href={href}
        className="mt-5 inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-bold text-white"
      >
        {cta}
      </Link>
    </div>
  );
}
