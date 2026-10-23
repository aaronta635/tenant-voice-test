'use client';

import Link from 'next/link';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import StatCard from '@/app/components/ui/StatCard';
import { housingApi, type ReviewFigures } from '@/app/lib/housing-api';
import { ComplaintMatrix, CountTable } from './HousingFigures';
import HousingTable from './HousingTable';
import { useHousingData } from './use-housing-data';

type Figure = { key: string; label: string; value: string | number | null };

function rating(value: number | null): string {
  return value === null ? 'No ratings yet' : `${value.toFixed(1)} out of 5`;
}

function reviewFigures(reviews: ReviewFigures): Figure[] {
  return [
    { key: 'total', label: 'Reviews written', value: reviews.total },
    { key: 'visible', label: 'Shown on profiles and listings (published or reported)', value: reviews.visible },
    { key: 'homes', label: 'About a home', value: reviews.property_reviews },
    { key: 'verified', label: 'From a verified tenancy or booking', value: reviews.verified },
    { key: 'rating', label: 'Average rating', value: reviews.average_rating },
    { key: 'landlord', label: 'Average landlord rating', value: reviews.average_landlord_rating },
  ];
}

/** Complaints, reviews and ratings, red flags and referrals across TenantVoice (GET /housing/overview). */
export default function HousingOverview() {
  const { loading, data, error, retry } = useHousingData(housingApi.overview);

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-8">
      <PageHeader
        title="Overview"
        description="Complaints, reviews, red flags and referrals across TenantVoice, counted from the live records each time this page opens."
      />
      {loading ? (
        <div role="status" aria-label="Loading the overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => <div key={index} aria-hidden className="h-28 animate-pulse rounded-2xl border border-border bg-white" />)}
        </div>
      ) : !data ? (
        <LoadErrorCard title="Couldn't load the overview" message={error ?? undefined} onRetry={retry} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Open complaints" value={String(data.complaints.open)} hint={`Of ${data.complaints.total} lodged`} />
            <StatCard label="Average rating" value={rating(data.reviews.average_rating)} hint={`Over ${data.reviews.visible} reviews shown`} />
            <StatCard
              label="Open red flags"
              value={String(data.red_flags.open_events + data.red_flags.open_alerts)}
              hint={`${data.red_flags.open_events} events, ${data.red_flags.open_alerts} regulatory alerts`}
            />
            <StatCard label="Open referrals" value={String(data.referrals.open)} hint={`Of ${data.referrals.total} referred`} />
          </div>
          <ComplaintMatrix summary={data.complaints} />
          <div className="grid min-w-0 gap-8 lg:grid-cols-2">
            <HousingTable
              title="Review and rating figures"
              name="review-figures"
              columns={[
                { header: 'Figure', value: (row: Figure) => row.label },
                { header: 'Value', value: (row: Figure) => row.value, numeric: true },
              ]}
              rows={reviewFigures(data.reviews)}
              rowKey={(row) => row.key}
              empty="No reviews yet."
            />
            <CountTable title="Ratings of the reviews shown" name="review-ratings" label="Rating" rows={data.reviews.distribution} empty="No reviews yet." />
          </div>
          <div className="grid min-w-0 gap-8 lg:grid-cols-2">
            <CountTable
              title="Red-flag events by status"
              name="red-flag-events-by-status"
              label="Status"
              rows={data.red_flags.events}
              empty="No red-flag events."
            />
            <CountTable
              title="Regulatory alerts by status"
              name="regulatory-alerts-by-status"
              label="Status"
              rows={data.red_flags.alerts}
              empty="No regulatory alerts."
            />
          </div>
          <CountTable
            title="Referrals by status"
            name="referrals-by-status"
            label="Status"
            rows={data.referrals.statuses}
            empty="No referrals yet."
            description={<>Critical cases admins referred for review. <Link href="/housing/referrals" className="font-semibold text-primary-strong underline">Open the referrals</Link></>}
          />
        </>
      )}
    </div>
  );
}
