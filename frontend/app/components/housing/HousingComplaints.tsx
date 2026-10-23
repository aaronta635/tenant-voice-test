'use client';

import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import StatCard from '@/app/components/ui/StatCard';
import { housingApi } from '@/app/lib/housing-api';
import { ComplaintMatrix, CountTable } from './HousingFigures';
import TribunalOutcomes from './TribunalOutcomes';
import { useHousingData } from './use-housing-data';

function days(value: number | null): string {
  return value === null ? 'None resolved yet' : `${value} ${value === 1 ? 'day' : 'days'}`;
}

/** Complaint statuses from the real complaints (GET /housing/complaints), and tribunal outcomes as labelled examples. */
export default function HousingComplaints() {
  const { loading, data, error, retry } = useHousingData(housingApi.complaints);

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-8">
      <PageHeader
        title="Complaint status and tribunal outcomes"
        description="Where every complaint lodged on TenantVoice stands, counted from the complaints themselves."
      />
      {loading ? (
        <p role="status" className="text-sm text-text-body">Loading the complaint statuses…</p>
      ) : !data ? (
        <LoadErrorCard title="Couldn't load the complaint statuses" message={error ?? undefined} onRetry={retry} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Complaints lodged" value={String(data.total)} />
            <StatCard label="Still open" value={String(data.open)} hint="Open, in review or escalated" />
            <StatCard label="Median time to resolve" value={days(data.median_days_to_resolve)} />
          </div>
          <ComplaintMatrix summary={data} />
          <div className="grid min-w-0 gap-8 lg:grid-cols-2">
            <CountTable title="Complaints by status" name="complaints-by-status" label="Status" rows={data.statuses} empty="No complaints yet." />
            <CountTable title="Complaints by severity" name="complaints-by-severity" label="Severity" rows={data.severities} empty="No complaints yet." />
          </div>
        </>
      )}
      <TribunalOutcomes />
    </div>
  );
}
