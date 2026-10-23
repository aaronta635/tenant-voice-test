'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StatePill from '@/app/components/admin/StatePill';
import UpcomingInspectionList from '@/app/components/dashboards/UpcomingInspectionList';
import FinishSetupPrompt from '@/app/components/onboarding/FinishSetupPrompt';
import OwnerSuggestedProviders from '@/app/components/owner/OwnerSuggestedProviders';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import {
  StarIcon,
  HouseIcon,
  FileTextIcon,
  MessageSquareIcon,
  UsersIcon,
  NetworkIcon,
  SparklesIcon,
  BotIcon,
  ChevronRightIcon,
} from '@/app/components/owner/icons';
import { api, ApiError, safe, type OwnerDashboard, type Profile } from '@/app/lib/api';
import { analyticsHref, counted, formatShare, type OwnerListingPerformance } from '@/app/lib/dashboards';
import { formatDateTime, formatRating } from '@/app/lib/format';
import { LISTING_STATUS_LABELS, LISTING_STATUS_STYLES } from '@/app/lib/listings';

type QuickLink = {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
};

const QUICK_LINKS: QuickLink[] = [
  {
    href: '/owner/properties',
    title: 'Ratings & Reviews',
    description: 'Open a listing to read and reply to property reviews.',
    icon: <StarIcon className="text-amber-500" />,
    iconBg: 'bg-[#fef3c7]',
  },
  {
    href: '/owner/properties',
    title: 'Properties',
    description: 'Manage your listings or find new homes.',
    icon: <HouseIcon className="text-blue-500" />,
    iconBg: 'bg-[#dbeafe]',
  },
  {
    href: '/owner/applications',
    title: 'Rental Applications',
    description: 'Review tenant applications and proposals.',
    icon: <FileTextIcon className="text-teal-600" />,
    iconBg: 'bg-[#ccfbf1]',
  },
  {
    href: '/owner/messages',
    title: 'In-App Chat',
    description: 'Communicate directly with tenants or providers.',
    icon: <MessageSquareIcon className="text-purple-600" />,
    iconBg: 'bg-[#f3e8ff]',
  },
  {
    href: '/categories',
    title: 'Find Providers',
    description: 'Browse marketplace providers and message them directly.',
    icon: <UsersIcon className="text-indigo-600" />,
    iconBg: 'bg-[#e0e7ff]',
  },
  {
    href: '/owner/search-profiles',
    title: 'Search for Profiles',
    description: 'Search for tenant or service provider profiles.',
    icon: <UsersIcon className="text-orange-500" />,
    iconBg: 'bg-[#ffedd5]',
  },
  {
    href: '/owner/network',
    title: 'Network',
    description: 'View and manage your connection requests.',
    icon: <NetworkIcon className="text-green-600" />,
    iconBg: 'bg-[#dcfce7]',
  },
  {
    href: '/owner/recommendations',
    title: 'Recommendations',
    description: 'Suggested tenants and service providers for you.',
    icon: <SparklesIcon className="text-sky-600" />,
    iconBg: 'bg-[#e0f2fe]',
  },
  {
    href: '/owner/help/ai-chat',
    title: 'Owner help',
    description: 'Help answers for listings and applications. Agentic AI actions are not run from this website.',
    icon: <BotIcon className="text-primary" />,
    iconBg: 'bg-primary/10',
  },
];

type Loaded = { dashboard: OwnerDashboard | null; error: string | null };

/**
 * The landlord's home: how their homes are doing (GET /me/dashboard/owner,
 * tracker R28), then the workspace's links. Every figure is counted by the
 * server from the rows it names: occupancy from active rent agreements,
 * complaints as the Complaints page shows them, and so on.
 */
export default function OwnerHomePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    safe<Profile | null>(api.profiles.me(), null).then((me) => {
      if (active) setProfile(me);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    api.dashboard.owner().then(
      (dashboard) => { if (active) setLoaded({ dashboard, error: dashboard ? null : 'Please try again.' }); },
      (error) => {
        if (active) {
          setLoaded({ dashboard: null, error: error instanceof ApiError ? error.message : 'Please try again.' });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const firstName = profile?.full_name?.split(' ')[0];
  const stats = loaded?.dashboard ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <Card className="rounded-[16px] border border-[#f1f5f9] bg-[rgba(248,250,252,0.8)] px-5 py-6 shadow-none sm:px-8 sm:py-8">
        <h1 className="font-heading text-2xl font-bold leading-8 text-[#171a1f]">
          Welcome back{firstName ? `, ${firstName}` : ''}!
        </h1>
        <p className="mt-2 text-sm text-[#565d6d]">
          Streamline your rental portfolio with the same workspace tenants use.
        </p>
        {stats ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Stat value={stats.property_count} label="Properties" />
            <Stat value={stats.pending_connections} label="Connection requests" />
            <Stat value={stats.unread_messages} label="Unread messages" />
          </div>
        ) : null}
      </Card>

      <FinishSetupPrompt role="landlord" />

      <section aria-labelledby="portfolio-heading" className="min-w-0">
        <h2 id="portfolio-heading" className="mb-4 font-heading text-xl font-bold text-[#171a1f]">
          How your homes are doing
        </h2>
        {!loaded ? (
          <p role="status" className="text-sm text-text-body">Loading your portfolio…</p>
        ) : !stats ? (
          <Card className="p-6">
            <h3 className="font-heading text-lg font-semibold text-text-dark">Your figures couldn&apos;t be loaded</h3>
            <p className="mt-2 text-sm text-text-body">{loaded.error}</p>
            <Button type="button" variant="secondary" className="mt-4" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </Card>
        ) : stats.property_count === 0 ? (
          <Card className="p-6">
            <h3 className="font-heading text-lg font-semibold text-text-dark">No properties yet</h3>
            <p className="mt-2 text-sm text-text-body">
              List a property to see its occupancy, views, applications, inspections and reviews here.
            </p>
            <Link href="/owner/properties/create" className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
              List a property
            </Link>
          </Card>
        ) : (
          <Portfolio stats={stats} />
        )}
      </section>

      <div>
        <h2 className="mb-4 font-heading text-xl font-bold text-[#171a1f]">Your Dashboard</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Keyed by title: two links lead to /owner/properties. */}
          {QUICK_LINKS.map((link) => (
            <Link key={link.title} href={link.href} className="group">
              <Card className="flex h-full flex-col rounded-[16px] border border-[#dee1e6] p-5 shadow-none transition group-hover:border-primary/40">
                <div
                  className={`mb-4 flex size-11 items-center justify-center rounded-[12px] ${link.iconBg}`}
                >
                  {link.icon}
                </div>
                <h3 className="font-semibold text-[#171a1f]">{link.title}</h3>
                <p className="mt-1 flex-1 text-sm text-[#565d6d]">{link.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Open
                  <ChevronRightIcon size={16} />
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <OwnerSuggestedProviders />
    </div>
  );
}

function Portfolio({ stats }: { stats: OwnerDashboard }) {
  const next = stats.upcoming_inspections[0];
  const occupancy = stats.occupancy_pct ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ul aria-label="Your portfolio" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Occupancy" value={formatShare(stats.occupancy_pct)}>
          {/* Inline width: the bar's length is the share. */}
          <span aria-hidden className="mt-3 block h-2 rounded-full bg-surface">
            <span className="block h-2 rounded-full bg-primary-strong" style={{ width: `${Math.min(100, occupancy)}%` }} />
          </span>
          <span className="mt-2 block">
            {stats.active_lease_count} of {counted(stats.property_count, 'home', 'homes')} under an active lease
          </span>
        </Tile>
        <Tile label="Active complaints" value={stats.active_complaint_count.toLocaleString('en-AU')}>
          <Link href="/owner/complaints" className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
            View complaints
          </Link>
        </Tile>
        <Tile label="Upcoming inspections" value={stats.upcoming_inspection_count.toLocaleString('en-AU')}>
          {next ? `Next: ${formatDateTime(next.starts_at)}` : 'None booked'}
        </Tile>
        <Tile label="New applications" value={stats.new_application_count.toLocaleString('en-AU')}>
          {counted(stats.application_count, 'application', 'applications')} in total
        </Tile>
        <Tile label="Average rating" value={formatRating(stats.rating_avg, stats.review_count)}>
          {counted(stats.review_count, 'published review', 'published reviews')}
          {stats.reviews_awaiting_reply ? ` · ${stats.reviews_awaiting_reply} awaiting your reply` : ''}
        </Tile>
        <Tile label="Saved by tenants" value={stats.favourite_count.toLocaleString('en-AU')}>
          Favourites on your listings
        </Tile>
        <Tile label="Listing views" value={stats.view_count === null ? '—' : stats.view_count.toLocaleString('en-AU')}>
          {stats.views_available ? `Last ${stats.view_days} days, one a day for each viewer` : 'Not counted yet'}
        </Tile>
      </ul>

      {stats.upcoming_inspections.length ? (
        <Card className="min-w-0 p-5 sm:p-6">
          <h3 className="font-heading text-lg font-semibold text-text-dark">Upcoming inspections</h3>
          <div className="mt-2">
            <UpcomingInspectionList items={stats.upcoming_inspections} />
          </div>
          {stats.upcoming_inspection_count > stats.upcoming_inspections.length ? (
            <p className="mt-3 text-sm text-text-body">
              And {stats.upcoming_inspection_count - stats.upcoming_inspections.length} more.
            </p>
          ) : null}
        </Card>
      ) : null}

      <section aria-labelledby="listing-performance" className="min-w-0">
        <h3 id="listing-performance" className="font-heading text-lg font-semibold text-text-dark">
          Listing performance
        </h3>
        <ul className="mt-3 grid min-w-0 gap-4 lg:grid-cols-2">
          {stats.listings.map((listing) => (
            <li key={listing.id} className="min-w-0">
              <ListingCard listing={listing} viewDays={stats.view_days} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <li className="min-w-0">
      <Card className="h-full min-w-0 p-5">
        <p className="text-sm font-medium text-text-body">{label}</p>
        <p className="mt-2 break-words text-2xl font-semibold text-text-dark">{value}</p>
        <div className="mt-1 text-sm text-text-body">{children}</div>
      </Card>
    </li>
  );
}

function ListingCard({ listing, viewDays }: { listing: OwnerListingPerformance; viewDays: number }) {
  const title = listing.title || 'Untitled listing';
  const figures: [string, string][] = [
    [`Views, ${viewDays} days`, listing.view_count === null ? '—' : listing.view_count.toLocaleString('en-AU')],
    ['Saved', listing.favourite_count.toLocaleString('en-AU')],
    ['Applications', `${listing.application_count}${listing.new_application_count ? ` (${listing.new_application_count} new)` : ''}`],
    ['Rating', listing.review_count ? `${formatRating(listing.rating_avg, listing.review_count)} (${listing.review_count})` : 'No reviews'],
    ['Inspections ahead', listing.upcoming_inspection_count.toLocaleString('en-AU')],
  ];
  return (
    <Card className="flex h-full min-w-0 flex-col gap-4 p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words font-semibold text-text-dark">{title}</p>
        <div className="flex flex-wrap gap-2">
          {listing.occupied ? <StatePill tone="success">Active lease</StatePill> : null}
          <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${LISTING_STATUS_STYLES[listing.listing_status]}`}>
            {LISTING_STATUS_LABELS[listing.listing_status]}
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        {figures.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-text-body">{label}</dt>
            <dd className="font-semibold text-text-dark">{value}</dd>
          </div>
        ))}
      </dl>
      <Link
        href={analyticsHref(listing.id)}
        className="mt-auto inline-flex min-h-11 items-center gap-1 self-start font-semibold text-primary-strong underline"
      >
        View analytics<span className="sr-only"> for {title}</span>
        <ChevronRightIcon size={16} />
      </Link>
    </Card>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[12px] border border-[#eef0f4] bg-white px-4 py-3">
      <p className="font-heading text-xl font-bold text-[#171a1f]">{value}</p>
      <p className="text-xs text-[#565d6d]">{label}</p>
    </div>
  );
}
