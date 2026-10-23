'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminViewLink from '@/app/components/admin/AdminViewLink';
import BarList from '@/app/components/admin/BarList';
import ColumnChart from '@/app/components/admin/ColumnChart';
import Card from '@/app/components/ui/Card';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import StatCard from '@/app/components/ui/StatCard';
import {
  adminActivityApi,
  ANALYTICS_RANGE_LABELS,
  analyticsHref,
  parseAnalyticsRange,
  type Analytics,
  type AnalyticsRange,
} from '@/app/lib/admin-activity-api';
import { ApiError } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';

type Result = { key: string; data: Analytics | null; error: string | null };

const RANGES = Object.keys(ANALYTICS_RANGE_LABELS).map(Number) as AnalyticsRange[];
// What each series counts, one and many.
const NOUNS: Record<string, [string, string]> = {
  users: ['new account', 'new accounts'],
  listings: ['new listing', 'new listings'],
  applications: ['application', 'applications'],
  complaints: ['complaint', 'complaints'],
  reviews: ['review', 'reviews'],
};

/**
 * Counts from TenantVoice's own rows (GET /admin/analytics) for the range in
 * the URL: a figure per kind of row, its count per day, week or month, and
 * the range's complaints by category and status and reviews by status. A
 * new range keeps the old figures, dimmed, until its own arrive.
 */
export default function AdminAnalytics() {
  const params = useSearchParams();
  const days = parseAnalyticsRange(params);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = JSON.stringify([days, attempt]);
  const current = result?.key === key ? result : null;

  useEffect(() => {
    let active = true;
    adminActivityApi.analytics(days).then(
      (data) => { if (active) setResult({ key, data, error: null }); },
      (error) => { if (active) setResult({ key, data: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [key, days]);

  // The last figures stay on screen while the next range loads.
  const data = current ? current.data : result?.data ?? null;
  const loading = !current;

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
      <PageHeader title="Analytics" description="Counts from TenantVoice's own records, by Sydney's calendar. Repairs are not counted as complaints." />

      <nav aria-label="Range" className="min-w-0">
        <ul className="flex flex-wrap gap-2">
          {RANGES.map((range) => (
            <li key={range}>
              <AdminViewLink href={analyticsHref(range)} selected={range === days}>{ANALYTICS_RANGE_LABELS[range]}</AdminViewLink>
            </li>
          ))}
        </ul>
      </nav>

      <p role="status" className="text-sm text-text-body">
        {loading ? 'Loading analytics…' : data ? `${formatDate(data.start)} to ${formatDate(data.end)}` : ''}
      </p>

      {!data && loading ? (
        <div aria-hidden className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => <div key={index} className="h-28 animate-pulse rounded-2xl border border-border bg-white" />)}
        </div>
      ) : !data ? (
        <LoadErrorCard title="Couldn't load the analytics" message={current?.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
      ) : (
        <div aria-busy={loading} className={`flex min-w-0 flex-col gap-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <ul aria-label={ANALYTICS_RANGE_LABELS[data.days]} className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            {data.series.map((series) => (
              <li key={series.key} className="min-w-0">
                <StatCard
                  label={series.label}
                  value={series.total.toLocaleString('en-AU')}
                  hint={`All time: ${(data.totals[series.key as keyof Analytics['totals']] ?? 0).toLocaleString('en-AU')}`}
                />
              </li>
            ))}
          </ul>

          <section aria-labelledby="analytics-over-time" className="min-w-0">
            <h2 id="analytics-over-time" className="font-heading text-h4 font-semibold text-text-dark">
              Per {data.granularity}
            </h2>
            <ul className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.series.map((series) => (
                <li key={series.key} className="min-w-0">
                  <Card className="h-full p-5">
                    <ColumnChart
                      title={series.label}
                      counts={series.counts}
                      periods={data.periods}
                      granularity={data.granularity}
                      noun={NOUNS[series.key] ?? ['item', 'items']}
                    />
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="analytics-breakdowns" className="min-w-0">
            <h2 id="analytics-breakdowns" className="font-heading text-h4 font-semibold text-text-dark">
              In this range
            </h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card className="p-5">
                <BarList
                  title="Complaints by category"
                  rows={data.complaints_by_category.map((item) => ({ key: item.code, label: item.label, count: item.count }))}
                  empty="No complaints in this range."
                />
              </Card>
              <Card className="p-5">
                <BarList
                  title="Complaints by status"
                  rows={data.complaints_by_status.map((item) => ({ key: item.status, label: item.label, count: item.count }))}
                  empty="No complaints in this range."
                />
              </Card>
              <Card className="p-5">
                <BarList
                  title="Reviews by status"
                  rows={data.reviews_by_status.map((item) => ({ key: item.status, label: item.label, count: item.count }))}
                  empty="No reviews in this range."
                />
              </Card>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
