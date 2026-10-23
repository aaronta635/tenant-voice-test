'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  orNotFound,
  type ServiceProvider,
  type Booking,
  type Conversation,
  type Profile,
  type ProviderDashboard,
  type Review,
} from '@/app/lib/api';
import {
  formatMoneyExact,
  formatPercent,
  formatSchedule,
  initialsOf,
  messageTimestamp,
} from '@/app/lib/format';

import DemoLabel from '@/app/components/demo/DemoLabel';
import StatCard from '@/app/components/ui/StatCard';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import CalendarDay from '@/app/components/provider/CalendarDay';
import { conversationPreview } from '@/app/lib/conversation-preview';
import { bookingIsOverdue, enquiryDatePassed, localDateKey, providerJobs, upcomingBookings } from '@/app/lib/provider-schedule';

export default function ProviderOverviewPage() {
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(`${localDateKey()}T12:00:00`));
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<ProviderDashboard | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await api.profiles.me();
        if (!active) return;
        setProfile(me);
        const mine = await orNotFound<ServiceProvider | null>(api.providers.mine(), null);
        if (!active) return;
        setProvider(mine);
        if (!mine) return;
        const [dashboard, bookingList, conversationList, reviewList] = await Promise.all([
          api.dashboard.provider(), api.bookings.list(), api.conversations.list(), api.providers.myReviews(),
        ]);
        if (!active) return;
        setStats(dashboard);
        setBookings(bookingList);
        setConversations(conversationList);
        setReviews(reviewList);
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load your workspace.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt]);

  // Match the stat cards, which count only bookings made with this provider.
  const providerId = provider?.id;
  const jobs = useMemo(() => providerJobs(bookings, providerId), [bookings, providerId]);
  const upcoming = useMemo(
    () => upcomingBookings(jobs).slice(0, 4),
    [jobs],
  );

  // Calendar highlights come from the booking dates in the current month.
  const { monthLabel, days, highlighted, enquiries, leadingBlanks } = useMemo(() => {
    const now = calendarMonth;
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prefix = (first.getDay() + 6) % 7; // Monday-first grid
    const marks = new Set(
      jobs
        .filter((b) => ['confirmed', 'in_progress'].includes(b.status))
        .map((b) => b.scheduled_date)
        .filter((d): d is string => !!d)
        .filter((d) => d.startsWith(monthPrefix))
        .map((d) => Number(d.slice(8, 10))),
    );
    return {
      monthLabel: now.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
      days: Array.from({ length: total }, (_, i) => i + 1),
      highlighted: marks,
      enquiries: new Set(jobs.filter((booking) => booking.status === 'new_enquiry' && booking.scheduled_date?.startsWith(monthPrefix)).map((booking) => Number(booking.scheduled_date!.slice(8, 10)))),
      leadingBlanks: prefix,
    };
  }, [jobs, calendarMonth]);

  const statCards = stats
    ? [
        {
          label: 'Active bookings',
          value: String(stats.active_bookings),
          hint: `${stats.due_this_week} due in the next 7 days${stats.overdue_bookings ? ` · ${stats.overdue_bookings} overdue` : ""}`,
        },
        {
          label: 'New enquiries',
          value: String(stats.new_enquiries),
          hint: stats.new_enquiries > 0 ? 'Awaiting your response' : 'All caught up',
        },
        {
          label: 'Earned this month',
          value: formatMoneyExact(stats.month_earnings),
          hint:
            stats.month_change_pct === null
              ? 'No comparison yet'
              : `${formatPercent(stats.month_change_pct)} vs same period last month`,
        },
        {
          label: 'Avg rating',
          value: stats.rating_avg ? stats.rating_avg.toFixed(1) : '—',
          hint: `${stats.review_count} review${stats.review_count === 1 ? '' : 's'}`,
        },
      ]
    : [];

  const firstName = profile?.full_name?.split(' ')[0];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary-strong">
            Provider workspace
          </p>
          <h1 className="font-heading text-h2 font-semibold text-text-dark">
            Overview
          </h1>
          <p className="mt-1 text-sm text-[#565d6d]">
            {firstName ? `${provider?.is_published ? 'Welcome back' : 'Welcome'}, ${firstName}. ` : ''}Here&apos;s what&apos;s happening with your services today.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/services"
            className="inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-4 text-sm font-bold text-white"
          >
            Manage services
          </Link>
        </div>
      </div>

      {loading ? (
        <p role="status" className="text-[#5f6b76]">Loading your workspace…</p>
      ) : error ? (
        <LoadErrorCard message={error} onRetry={() => {
          setError(null);
          setLoading(true);
          setAttempt((value) => value + 1);
        }} />
      ) : !stats ? (
        <EmptyCard
          title="No provider profile yet"
          body="Complete onboarding to create your provider profile — the dashboard fills in from your live bookings, messages and reviews."
          href="/dashboard/onboarding"
          cta="Start onboarding"
        />
      ) : (
        <>
          {provider ? <div className={`rounded-xl border p-4 text-sm ${provider.is_published ? 'border-border bg-white' : 'border-warning bg-warning/10 text-warning'}`}><p className="font-semibold">{provider.is_published ? 'Profile live on the marketplace' : 'Your profile is not published yet'} · {provider.profile_completion}% complete</p>{!provider.is_published ? <Link href="/dashboard/onboarding" className="mt-2 inline-block font-bold underline">Continue setup and publish</Link> : null}</div> : null}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {statCards.map((stat) => <StatCard key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} />)}
          </div>
          <DemoLabel variant="notice" reason="Earnings are simulated ledger totals: completing a booking records a payment and a platform fee, but no money moves." />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-white shadow-sm p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-[#1b1b1f]" aria-live="polite">{monthLabel}</h2>
                <div className="flex gap-1"><button aria-label="Previous month" className="size-11 rounded-lg border border-control-border" onClick={() => setCalendarMonth((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}>←</button><button aria-label="Current month" className="min-h-11 rounded-lg border border-control-border px-3 text-sm" onClick={() => setCalendarMonth(new Date(`${localDateKey()}T12:00:00`))}>Today</button><button aria-label="Next month" className="size-11 rounded-lg border border-control-border" onClick={() => setCalendarMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}>→</button></div>
              </div>
              {/* Each day reads out its own weekday, so the letters are only for sight. */}
              <div aria-hidden="true" className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-[#5f6b76]">
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
                  const enquiry = enquiries.has(day);
                  const date = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const today = date === localDateKey();
                  return <CalendarDay key={day} date={date} day={day} today={today} booked={booked} enquiry={enquiry} />;
                })}
              </div>
              <p className="mt-3 text-xs text-text-muted">Filled: confirmed jobs · Dashed: enquiries · Outlined: today</p>
            </section>

            <section className="rounded-xl border border-border bg-white shadow-sm p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#1b1b1f]">Upcoming and overdue jobs</h2>
                <Link href="/dashboard/bookings" className="text-sm font-semibold text-primary-strong">
                  See all →
                </Link>
              </div>
              {upcoming.length === 0 ? (
                <p className="mt-6 text-sm text-[#5f6b76]">Nothing scheduled yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {upcoming.map((job) => (
                    <li
                      key={job.id}
                      className="flex items-center gap-3 rounded-[14px] border border-[#f4f4f8] px-3 py-3"
                    >
                      <div aria-hidden="true" className="flex size-10 items-center justify-center shrink-0 rounded-full bg-surface text-xs font-bold text-navy">
                        {initialsOf(job.client_name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-[#1b1b1f]">
                          {job.client_name ?? 'Client'}
                        </p>
                        <p className="text-xs text-[#5f6b76]">
                          {job.service_title ?? 'Service'}<br />
                          {formatSchedule(job.scheduled_date, job.scheduled_time)}
                          {bookingIsOverdue(job) ? <span className="ml-2 font-bold text-warning">Overdue</span> : null}
                          {enquiryDatePassed(job) ? <span className="ml-2 font-bold text-warning">Date passed</span> : null}
                        </p>
                      </div>
                      <StatusPill status={job.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-white shadow-sm p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#1b1b1f]">Recent messages</h2>
                <Link href="/dashboard/messages" className="text-sm font-semibold text-primary-strong">
                  Inbox →
                </Link>
              </div>
              {conversations.length === 0 ? (
                <p className="mt-6 text-sm text-[#5f6b76]">No conversations yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {conversations.slice(0, 4).map((thread) => (
                    <li
                      key={thread.id}
                      className="flex gap-3 border-b border-[#f4f4f8] pb-3 last:border-0"
                    >
                      <div aria-hidden="true" className="flex size-10 items-center justify-center shrink-0 rounded-full bg-surface text-xs font-bold text-navy">
                        {initialsOf(thread.counterpart_name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-[#1b1b1f]">
                            <Link href={`/dashboard/messages?thread=${thread.id}`} className="hover:text-primary-strong hover:underline">
                              {thread.counterpart_name ?? 'Client'}
                            </Link>
                          </p>
                          <span className="text-xs text-[#5f6b76]">
                            {messageTimestamp(thread.last_message_at)}
                          </span>
                        </div>
                        {thread.context ? (
                          <p className="truncate text-xs text-[#5f6b76]">{thread.context}</p>
                        ) : null}
                        <p className="mt-0.5 truncate text-sm text-[#5f6b76]">
                          {conversationPreview(thread, profile?.id) ?? 'No messages yet'}
                        </p>
                      </div>
                      {thread.unread_count > 0 ? (
                        // Forced colours drop background colours but keep system ones such as Highlight.
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-primary forced-colors:bg-[Highlight]">
                          <span className="sr-only">Unread</span>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-border bg-white shadow-sm p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#1b1b1f]">Latest reviews</h2>
                <Link href="/dashboard/reviews" className="text-sm font-semibold text-primary-strong">
                  Manage →
                </Link>
              </div>
              {reviews.length === 0 ? (
                <p className="mt-6 text-sm text-[#5f6b76]">No reviews yet.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {reviews.slice(0, 3).map((review) => (
                    <li key={review.id} className="rounded-[14px] bg-[#fafafe] p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-[#1b1b1f]">
                          {review.client_name ?? 'Verified client'}
                        </p>
                        <span
                          className="text-sm font-semibold text-[#0e2a48]"
                          role="img"
                          aria-label={`${review.rating} out of 5 stars`}
                        >
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
    new_enquiry: 'bg-[#eeeffd] text-primary-strong',
    confirmed: 'bg-[#fff4e5] text-warning',
    in_progress: 'bg-[#e6f4ed] text-[#1b7c4f]',
  };
  const labels: Record<string, string> = {
    new_enquiry: 'New enquiry',
    confirmed: 'Confirmed',
    in_progress: 'In progress',
  };
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-bold ${styles[status] ?? 'bg-[#f4f4f8] text-[#5f6b76]'}`}
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
    <div className="rounded-xl border border-dashed border-[#c5cad3] bg-white shadow-sm p-10 text-center">
      <p className="font-bold text-[#1b1b1f]">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[#5f6b76]">{body}</p>
      <Link
        href={href}
        className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-5 text-sm font-bold text-white"
      >
        {cta}
      </Link>
    </div>
  );
}
