'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StatePill, { type PillTone } from '@/app/components/admin/StatePill';
import UpcomingInspectionList from '@/app/components/dashboards/UpcomingInspectionList';
import FinishSetupPrompt from '@/app/components/onboarding/FinishSetupPrompt';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import TenantScorecards from '@/app/components/tenant/TenantScorecards';
import TenantShell from '@/app/components/tenant/TenantShell';
import { api, ApiError, safe, type NotificationItem, type Profile, type TenantDashboard } from '@/app/lib/api';
import {
  counted,
  RENT_FREQUENCY_LABELS,
  RENT_STATUS_LABELS,
  type RentalHistoryItem,
  type RentStatus,
} from '@/app/lib/dashboards';
import { formatDate, formatMoney, formatMoneyExact, relativeTime } from '@/app/lib/format';
import { completionScore, sydneyToday } from '@/app/lib/my-profile';

// Route configuration for the dashboard tiles (navigation, not content).
const dashboardLinks = [
  {
    title: 'Ratings & Reviews',
    body: 'Write and submit rental reviews',
    href: '/tenant/write-review',
    tone: 'bg-[#fef3c7] text-[#d08700]',
    icon: <StarIcon className="size-6" />,
  },
  {
    title: 'Properties',
    body: 'Browse homes, rooms, prices, and photos',
    href: '/tenant/properties',
    tone: 'bg-[#dbeafe] text-[#2563eb]',
    icon: <HomeIcon className="size-6" />,
  },
  {
    title: 'Rental Applications',
    body: 'Track submitted rental applications',
    href: '/tenant/applications',
    tone: 'bg-[#dcfce7] text-[#16a34a]',
    icon: <FileIcon className="size-6" />,
  },
  {
    title: 'In-App Chat',
    body: 'Message owners about inspections',
    href: '/tenant/messages',
    tone: 'bg-[#f3e8ff] text-[#9333ea]',
    icon: <MessageIcon className="size-6" />,
  },
  {
    title: 'Find Providers',
    body: 'Browse and message service providers',
    href: '/categories',
    tone: 'bg-[#e0e7ff] text-[#4338ca]',
    icon: <SearchIcon className="size-6" />,
  },
  {
    title: 'Search Profiles',
    body: 'Find owners, tenants, and providers',
    href: '/tenant/search-profile',
    tone: 'bg-[#ffedd5] text-[#f97316]',
    icon: <SearchIcon className="size-6" />,
  },
  {
    title: 'My Network',
    body: 'Your connections',
    href: '/tenant/network',
    tone: 'bg-[#ccfbf1] text-[#0d9488]',
    icon: <ConnectionsIcon className="size-6" />,
  },
];

// A charge's state in words; the tone only repeats it.
const RENT_STATUS_TONES: Record<RentStatus, PillTone> = {
  PAID: 'success',
  OVERDUE: 'danger',
  PARTIALLY_PAID: 'warning',
  UNPAID: 'neutral',
};

type Home = { data: TenantDashboard | null; error: string | null };

export default function TenantDashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activity, setActivity] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [home, setHome] = useState<Home | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const [me, feed] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe(api.notifications.list(false, 5), []),
      ]);
      if (!active) return;
      setProfile(me);
      setActivity(feed);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // GET /me/dashboard/tenant (tracker R35): every value comes from the tenant's
  // agreements, charges, payments, work orders and inspections.
  useEffect(() => {
    let active = true;
    api.dashboard.tenant().then(
      (data) => { if (active) setHome({ data, error: data ? null : 'Please try again.' }); },
      (error) => {
        if (active) setHome({ data: null, error: error instanceof ApiError ? error.message : 'Please try again.' });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const tenancy = home?.data ?? null;

  // Worked out by the server (GET /profiles/me), like on the completion page.
  const completion = completionScore(profile);
  const firstName = profile?.full_name?.split(' ')[0];

  return (
    <TenantShell>
      <main className="mx-auto grid w-full max-w-[1240px] gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 space-y-8">
          <Card className="rounded-[16px] border border-[#f1f5f9] bg-[rgba(248,250,252,0.8)] px-8 py-8">
            <h1 className="break-words font-heading text-2xl font-bold leading-8 text-[#171a1f]">
              Welcome back{firstName ? `, ${firstName}` : ''}!
            </h1>
            <p className="mt-2 text-sm text-[#565d6d]">
              Streamline your rental journey with ease.
            </p>
          </Card>

          <FinishSetupPrompt role="tenant" />

          <Card className="rounded-[16px] border border-[#dee1e6] p-5 sm:p-6">
            {!home ? (
              <p role="status" className="text-sm text-[#565d6d]">Loading your tenancy…</p>
            ) : !tenancy ? (
              <>
                <h2 className="font-heading text-lg font-semibold text-[#171a1f]">Your tenancy couldn&apos;t be loaded</h2>
                <p className="mt-2 text-sm text-[#565d6d]">{home.error}</p>
                <Button type="button" variant="secondary" className="mt-4" onClick={() => setAttempt((value) => value + 1)}>
                  Try again
                </Button>
              </>
            ) : tenancy.lease ? (
              <CurrentLease tenancy={tenancy} />
            ) : (
              <>
                <h2 className="font-heading text-lg font-semibold text-[#171a1f]">No active tenancy</h2>
                <p className="mt-2 text-sm text-[#565d6d]">
                  Once your rent agreement with an owner is active, your lease and rent show here.
                </p>
                {tenancy.open_maintenance ? (
                  <p className="mt-2 text-sm text-[#565d6d]">{counted(tenancy.open_maintenance, 'repair is', 'repairs are')} still open.</p>
                ) : null}
              </>
            )}
          </Card>

          {tenancy && tenancy.next_inspections.length ? (
            <Card className="rounded-[16px] border border-[#dee1e6] p-5 sm:p-6">
              <h2 className="font-heading text-lg font-semibold text-[#171a1f]">Upcoming inspections</h2>
              <div className="mt-2">
                <UpcomingInspectionList items={tenancy.next_inspections} />
              </div>
              {tenancy.upcoming_inspections > tenancy.next_inspections.length ? (
                <p className="mt-3 text-sm text-[#565d6d]">
                  And {tenancy.upcoming_inspections - tenancy.next_inspections.length} more.
                </p>
              ) : null}
            </Card>
          ) : null}

          {tenancy ? <RentalHistory items={tenancy.rental_history} complete={tenancy.rental_history_complete} /> : null}

          <TenantScorecards />

          <div>
            <h2 className="font-heading text-lg font-semibold text-[#171a1f]">Your Dashboard</h2>
            {/* One column that may shrink to the screen: in Chrome at 320px the descriptions, kept on one
                line then, stretched it to 374px and the page scrolled sideways. They wrap now, in two lines. */}
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {dashboardLinks.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className="group flex h-[90px] min-w-0 items-center rounded-[16px] border border-[#dee1e6] bg-white px-5 transition hover:border-primary/40 hover:shadow-[0_6px_18px_rgba(23,26,31,0.08)]"
                >
                  <span
                    className={`flex size-12 shrink-0 items-center justify-center rounded-[16px] ${item.tone}`}
                  >
                    {item.icon}
                  </span>
                  <span className="ml-4 min-w-0 flex-1">
                    <span className="block text-sm font-bold text-[#171a1f]">{item.title}</span>
                    <span className="mt-1 line-clamp-2 text-xs text-[#565d6d]">{item.body}</span>
                  </span>
                  <ChevronIcon className="ml-3 size-4 shrink-0 text-[#8c97a2] transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <aside className="min-w-0 space-y-6">
          <Card className="rounded-[16px] border border-[#dee1e6] p-6">
            <h2 className="text-base font-bold text-[#171a1f]">Quick Actions</h2>
            {/* Links styled as buttons: one tab stop each, never a button inside a link. */}
            <div className="mt-4 space-y-3">
              <ButtonLink
                href="/tenant/messages"
                fullWidth
                className="h-12 rounded-[12px] bg-[#f0f1ff] text-primary-strong shadow-none hover:bg-[#e7e9ff]"
              >
                <MessageIcon className="size-4" />
                View Messages
              </ButtonLink>
              <ButtonLink
                href="/tenant/recommendations"
                variant="ghost"
                fullWidth
                className="h-12 rounded-[12px] bg-[#f8f9fa] text-[#171a1f]"
              >
                <StarIcon className="size-4" />
                Recommendations
              </ButtonLink>
              <ButtonLink
                href="/tenant/maintenance"
                variant="ghost"
                fullWidth
                className="h-12 rounded-[12px] bg-[#f8f9fa] text-[#171a1f]"
              >
                Submit Repair Request
              </ButtonLink>
            </div>
          </Card>

          <Card className="rounded-[16px] border border-[#dee1e6] p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#171a1f]">Recent Activity</h2>
              <Link href="/tenant/notifications" className="text-xs font-medium text-primary-strong underline">
                View All
              </Link>
            </div>
            {loading ? (
              <p className="mt-5 text-sm text-[#565d6d]">Loading…</p>
            ) : activity.length === 0 ? (
              <p className="mt-5 text-sm text-[#565d6d]">No activity yet.</p>
            ) : (
              <ul className="mt-5">
                {activity.map((item, index) => (
                  <li
                    key={item.id}
                    className={`flex gap-4 py-4 ${index > 0 ? 'border-t border-[#f1f5f9]' : ''}`}
                  >
                    <ActivityIcon className="mt-1 size-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-[#171a1f]">{item.title}</p>
                      <p className="mt-1 text-xs text-[#565d6d]">
                        {relativeTime(item.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="rounded-[16px] border border-[#e7e4ff] bg-[#f5f2ff] p-6">
            <h2 className="text-base font-bold text-[#171a1f]">Profile Completion</h2>
            <div className="mt-7 h-2.5 rounded-full bg-[#e5e7eb]">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${completion}%` }}
              />
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="font-medium text-[#565d6d]">{completion}% Complete</span>
              <Link href="/tenant/profile-completion" className="font-medium text-primary-strong underline">
                Finish Setup ›
              </Link>
            </div>
          </Card>
        </aside>
      </main>
    </TenantShell>
  );
}

function CurrentLease({ tenancy }: { tenancy: TenantDashboard }) {
  const lease = tenancy.lease!;
  const next = tenancy.next_payment;
  const firstDue = lease.first_due_date && lease.first_due_date > sydneyToday() ? lease.first_due_date : null;
  return (
    <>
      <h2 className="font-heading text-lg font-semibold text-[#171a1f]">Current lease</h2>
      <p className="mt-2 break-words font-medium text-[#171a1f]">{lease.listing_title || 'Your home'}</p>
      {lease.address ? <p className="mt-1 break-words text-sm text-[#565d6d]">{lease.address}</p> : null}
      <p className="mt-2 text-sm text-[#171a1f]">
        {formatMoney(lease.rent_amount)} {RENT_FREQUENCY_LABELS[lease.rent_frequency]} · from {formatDate(lease.start_date)}
        {lease.end_date ? ` to ${formatDate(lease.end_date)}` : ', no end date'}
      </p>

      <div className="mt-5 rounded-[12px] border border-[#eef0f4] bg-white p-4">
        <h3 className="text-sm font-semibold text-[#171a1f]">Next rent payment</h3>
        {next ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-xl font-semibold text-[#171a1f]">{formatMoneyExact(next.amount_outstanding)}</p>
            <StatePill tone={RENT_STATUS_TONES[next.status]}>{RENT_STATUS_LABELS[next.status]}</StatePill>
            <p className="w-full text-sm text-[#565d6d]">
              Due {formatDate(next.due_date)}, for {formatDate(next.period_start)} to {formatDate(next.period_end)}
              {next.amount_paid ? ` · ${formatMoneyExact(next.amount_paid)} of ${formatMoneyExact(next.amount_due)} paid` : ''}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[#565d6d]">
            {firstDue ? `Your first rent is due ${formatDate(firstDue)}.` : 'Nothing is due right now.'}
          </p>
        )}
        {tenancy.overdue_count ? (
          <p className="mt-3 text-sm font-semibold text-danger">
            Overdue: {formatMoneyExact(tenancy.overdue_amount)} across {counted(tenancy.overdue_count, 'charge', 'charges')}.
          </p>
        ) : null}
      </div>

      <p className="mt-4 text-sm text-[#565d6d]">
        Open repairs: {tenancy.open_maintenance} · Upcoming inspections: {tenancy.upcoming_inspections}
      </p>
    </>
  );
}

function RentalHistory({ items, complete }: { items: RentalHistoryItem[]; complete: boolean }) {
  return (
    <Card className="rounded-[16px] border border-[#dee1e6] p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold text-[#171a1f]">Rental history</h2>
        <Link href="/tenant/address-history" className="inline-flex min-h-11 items-center text-sm font-medium text-primary">
          Add an address
        </Link>
      </div>
      {!complete ? (
        <p role="status" className="mt-2 text-sm text-[#565d6d]">
          Your tenancies on TenantVoice couldn&apos;t be loaded right now. The addresses you added are shown.
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[#565d6d]">
          {complete ? 'No tenancies yet. Add the places you have rented, and leases on TenantVoice join them here.' : ''}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-[#f1f5f9]">
          {items.map((item) => (
            <li key={`${item.source}-${item.id}`} className="flex min-w-0 flex-col gap-1 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="min-w-0 break-words text-sm font-medium text-[#171a1f]">{item.title || item.address || 'Rented home'}</p>
                <StatePill tone={item.source === 'tenantvoice' ? 'info' : 'neutral'}>
                  {item.source === 'tenantvoice' ? 'On TenantVoice' : 'Added by you'}
                </StatePill>
              </div>
              {item.title && item.address ? <p className="break-words text-xs text-[#565d6d]">{item.address}</p> : null}
              <p className="text-xs text-[#565d6d]">
                {item.start_date ? formatDate(item.start_date) : 'Start not given'} to{' '}
                {item.current ? 'now' : item.end_date ? formatDate(item.end_date) : 'end not given'}
                {item.weekly_rent != null ? ` · ${formatMoney(item.weekly_rent)} per week` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  );
}

function ChevronIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
    </svg>
  );
}

function HomeIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function FileIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

function MessageIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.5-4A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

function ConnectionsIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="16" r="3" />
      <path d="m10.2 10.2 3.6 3.6" />
      <path d="M16 7h3v3" />
      <path d="m14 10 5-5" />
    </svg>
  );
}

function ActivityIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M22 12h-4l-3 8-6-16-3 8H2" />
    </svg>
  );
}
