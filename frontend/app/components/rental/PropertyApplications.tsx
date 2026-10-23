'use client';

import { useMemo, useState } from 'react';
import OwnerApplicationCard from '@/app/components/rental/OwnerApplicationCard';
import Button from '@/app/components/ui/Button';
import FilterChip from '@/app/components/ui/FilterChip';
import type { Application, ApplicationStage } from '@/app/lib/api';
import { isOpenStage, stageOf } from '@/app/lib/listings';

type Filter = 'all' | 'waiting' | 'approved' | 'closed';

const FILTERS: { value: Filter; label: string; matches: (stage: ApplicationStage) => boolean }[] = [
  { value: 'all', label: 'All', matches: () => true },
  { value: 'waiting', label: 'Waiting on you', matches: isOpenStage },
  { value: 'approved', label: 'Approved', matches: (stage) => stage === 'approved' },
  { value: 'closed', label: 'Declined or withdrawn', matches: (stage) => ['declined', 'withdrawn', 'expired'].includes(stage) },
];

type Props = {
  listing: { id: string; title: string; price: number };
  /** null while they load. */
  applications: Application[] | null;
  error: string | null;
  onRetry: () => void;
  onUpdated: (application: Application) => void;
};

/** The applications for one listing, as its owner or manager sees them under that listing (R25). */
export default function PropertyApplications({ listing, applications, error, onRetry, onUpdated }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const counts = useMemo(() => new Map(FILTERS.map((option) => [
    option.value, (applications ?? []).filter((application) => option.matches(stageOf(application))).length,
  ])), [applications]);
  const shown = useMemo(() => {
    const matches = FILTERS.find((option) => option.value === filter)?.matches ?? (() => true);
    return (applications ?? []).filter((application) => matches(stageOf(application)));
  }, [applications, filter]);

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-danger bg-white p-5 text-sm text-danger">
        <p>{error}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (applications === null) return <p role="status" className="text-sm text-text-body">Loading applications…</p>;
  if (applications.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-control-border p-8 text-center">
        <p className="font-heading text-lg font-semibold text-text-dark">No applications yet</p>
        <p className="mt-1 text-sm text-text-body">When tenants apply for {listing.title}, their applications appear here.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="group" aria-label="Show applications" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((option) => (
          <FilterChip key={option.value} selected={filter === option.value} onClick={() => setFilter(option.value)}>
            {option.label} ({counts.get(option.value) ?? 0})
          </FilterChip>
        ))}
      </div>
      {shown.length === 0 ? (
        <p role="status" className="text-sm text-text-body">No applications here.</p>
      ) : (
        shown.map((application) => (
          <OwnerApplicationCard key={application.id} application={application} listing={listing} onUpdated={onUpdated} />
        ))
      )}
    </div>
  );
}
