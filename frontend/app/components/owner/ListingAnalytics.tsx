'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import AdminViewLink from '@/app/components/admin/AdminViewLink';
import BarList from '@/app/components/admin/BarList';
import ColumnChart from '@/app/components/admin/ColumnChart';
import StatePill from '@/app/components/admin/StatePill';
import UpcomingInspectionList from '@/app/components/dashboards/UpcomingInspectionList';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import StatCard from '@/app/components/ui/StatCard';
import { api, ApiError } from '@/app/lib/api';
import {
  ANALYTICS_DAYS,
  ANALYTICS_DAYS_LABELS,
  analyticsHref,
  counted,
  parseAnalyticsDays,
  RENT_FREQUENCY_LABELS,
  viewSeries,
  type ListingAnalytics as Analytics,
} from '@/app/lib/dashboards';
import { formatDate, formatMoney, formatRating } from '@/app/lib/format';
import { LISTING_STATUS_LABELS, LISTING_STATUS_STYLES } from '@/app/lib/listings';

type Result = { key: string; data: Analytics | null; error: string | null; notFound: boolean };

/**
 * One listing's analytics (GET /me/dashboard/owner/properties/{id}, tracker
 * R28) for the range in the URL (?days=7|30|90): views day by day, and how
 * many tenants saved it, applied, booked an inspection and reviewed it. The
 * server counts each figure from its rows. A new range keeps the old figures,
 * dimmed, until its own arrive.
 */
export default function ListingAnalytics() {
  const params = useParams<{ id: string }>();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) ?? '';
  const days = parseAnalyticsDays(useSearchParams());
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = JSON.stringify([id, days, attempt]);
  const current = result?.key === key ? result : null;

  useEffect(() => {
    let active = true;
    api.dashboard.listing(id, days).then(
      (data) => { if (active) setResult({ key, data, error: null, notFound: false }); },
      (error) => {
        if (!active) return;
        setResult({
          key,
          data: null,
          error: error instanceof ApiError ? error.message : 'Please try again.',
          notFound: error instanceof ApiError && error.status === 404,
        });
      },
    );
    return () => { active = false; };
  }, [key, id, days]);

  // The last figures of this listing stay on screen while another range loads.
  const previous = result && result.data?.property_id === id ? result.data : null;
  const data = current ? current.data : previous;
  const loading = !current;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="min-w-0">
        <Link href={`/owner/properties/${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary-strong">
          ← Property details
        </Link>
        <h1 className="mt-1 font-heading text-2xl font-bold text-text-dark">Listing analytics</h1>
        {data ? (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 break-words text-sm text-text-body">{data.title || 'Untitled listing'}</p>
            <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${LISTING_STATUS_STYLES[data.listing_status]}`}>
              {LISTING_STATUS_LABELS[data.listing_status]}
            </span>
          </div>
        ) : null}
      </div>

      <nav aria-label="Range" className="min-w-0">
        <ul className="flex flex-wrap gap-2">
          {ANALYTICS_DAYS.map((range) => (
            <li key={range}>
              <AdminViewLink href={analyticsHref(id, range)} selected={range === days}>{ANALYTICS_DAYS_LABELS[range]}</AdminViewLink>
            </li>
          ))}
        </ul>
      </nav>

      <p role="status" className="text-sm text-text-body">
        {loading ? 'Loading analytics…' : data ? `${formatDate(data.start)} to ${formatDate(data.end)}, by Sydney's calendar` : ''}
      </p>

      {!data && loading ? (
        <div aria-hidden className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => <div key={index} className="h-28 animate-pulse rounded-2xl border border-border bg-white" />)}
        </div>
      ) : !data ? (
        <Card className="p-6">
          <h2 className="font-heading text-lg font-semibold text-text-dark">
            {current?.notFound ? 'This listing could not be found' : "Couldn't load the analytics"}
          </h2>
          <p className="mt-2 text-sm text-text-body">
            {current?.notFound ? 'It is not one of your listings, or it was deleted.' : current?.error}
          </p>
          {current?.notFound ? (
            <Link href="/owner/properties" className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
              Back to properties
            </Link>
          ) : (
            <Button type="button" variant="secondary" className="mt-4" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          )}
        </Card>
      ) : (
        <Figures data={data} loading={loading} />
      )}

      <Link href={`/owner/properties/${encodeURIComponent(id)}/qr-code`} className="inline-flex min-h-11 items-center self-start text-sm font-medium text-primary-strong">
        Get listing QR code
      </Link>
    </div>
  );
}

function ViewsChart({ daily, days }: { daily: Analytics['views']['daily']; days: Analytics['days'] }) {
  const series = viewSeries(daily, days);
  return (
    <ColumnChart
      title={series.granularity === 'week' ? 'Views per week' : 'Views per day'}
      counts={series.counts}
      periods={series.periods}
      granularity={series.granularity}
      noun={['view', 'views']}
    />
  );
}

function Figures({ data, loading }: { data: Analytics; loading: boolean }) {
  const { views, favourites, applications, inspections, reviews, lease } = data;
  return (
    <div aria-busy={loading} className={`flex min-w-0 flex-col gap-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <ul aria-label={ANALYTICS_DAYS_LABELS[data.days]} className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <li className="min-w-0">
          {views.available && views.period !== null && views.total !== null ? (
            <StatCard label="Views" value={views.period.toLocaleString('en-AU')} hint={`All time: ${views.total.toLocaleString('en-AU')}`} />
          ) : (
            <StatCard label="Views" value="—" hint="Not counted yet" />
          )}
        </li>
        <li className="min-w-0">
          <StatCard label="Saved by tenants" value={favourites.total.toLocaleString('en-AU')} hint={`${favourites.period.toLocaleString('en-AU')} in this range`} />
        </li>
        <li className="min-w-0">
          <StatCard label="Applications" value={applications.period.toLocaleString('en-AU')} hint={`All time: ${applications.total.toLocaleString('en-AU')}`} />
        </li>
        <li className="min-w-0">
          <StatCard label="Inspections ahead" value={inspections.upcoming_count.toLocaleString('en-AU')} hint={`${counted(inspections.bookings, 'open-home booking', 'open-home bookings')} in all`} />
        </li>
        <li className="min-w-0">
          <StatCard label="Average rating" value={formatRating(reviews.rating_avg, reviews.count)} hint={counted(reviews.count, 'published review', 'published reviews')} />
        </li>
      </ul>

      <Card className="min-w-0 p-5">
        {views.available ? (
          <>
            <ViewsChart daily={views.daily} days={data.days} />
            <p className="mt-2 text-sm text-text-body">Each viewer counts once a day. Your own visits are not counted.</p>
          </>
        ) : (
          <>
            <h3 className="font-heading text-base font-semibold text-text-dark">Views per day</h3>
            <p className="mt-2 text-sm text-text-body">Listing views are not counted yet. The other figures are up to date.</p>
          </>
        )}
      </Card>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Card className="min-w-0 p-5">
          <BarList
            title="Applications by stage"
            rows={[
              { key: 'new', label: 'New', count: applications.new },
              { key: 'reviewing', label: 'Reviewing', count: applications.reviewing },
              { key: 'approved', label: 'Approved', count: applications.approved },
              { key: 'declined', label: 'Declined', count: applications.declined },
              { key: 'withdrawn', label: 'Withdrawn', count: applications.withdrawn },
              { key: 'expired', label: 'Expired', count: applications.expired },
            ]}
            empty="No applications yet."
          />
          {applications.shortlisted ? (
            <p className="mt-3 text-sm text-text-body">
              {applications.shortlisted} of those reviewing {applications.shortlisted === 1 ? 'is' : 'are'} shortlisted.
            </p>
          ) : null}
        </Card>

        <Card className="min-w-0 p-5">
          <BarList
            title="Open-home bookings"
            rows={[
              { key: 'pending', label: 'Waiting for you', count: inspections.pending },
              { key: 'accepted', label: 'Accepted', count: inspections.accepted },
              { key: 'reschedule_requested', label: 'New time asked', count: inspections.reschedule_requested },
              { key: 'rejected', label: 'Declined', count: inspections.rejected },
              { key: 'cancelled', label: 'Cancelled', count: inspections.cancelled },
            ]}
            empty="No open-home bookings yet."
          />
          <h3 className="mt-5 font-heading text-base font-semibold text-text-dark">Coming up</h3>
          {inspections.upcoming.length ? (
            <UpcomingInspectionList items={inspections.upcoming} showListing={false} />
          ) : (
            <p className="mt-2 text-sm text-text-body">No inspections booked ahead.</p>
          )}
        </Card>

        <Card className="min-w-0 p-5">
          <BarList
            title="Published reviews by rating"
            rows={reviews.distribution.map((row) => ({
              key: String(row.rating), label: `${row.rating} star${row.rating === 1 ? '' : 's'}`, count: row.count,
            }))}
            empty="No published reviews yet."
          />
          {reviews.awaiting_reply ? (
            <p className="mt-3 text-sm text-text-body">{counted(reviews.awaiting_reply, 'review awaits', 'reviews await')} your reply.</p>
          ) : null}
        </Card>

        <Card className="min-w-0 p-5">
          <h3 className="font-heading text-base font-semibold text-text-dark">Lease</h3>
          {lease ? (
            <div className="mt-3 flex flex-col gap-2 text-sm text-text-body">
              <StatePill tone="success">Active lease</StatePill>
              <p>
                {formatMoney(lease.rent_amount)} {RENT_FREQUENCY_LABELS[lease.rent_frequency]}, from {formatDate(lease.start_date)}
                {lease.end_date ? ` to ${formatDate(lease.end_date)}` : ', with no end date'}.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-text-body">
              No active lease. This home counts as occupied once a rent agreement for it is activated.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
