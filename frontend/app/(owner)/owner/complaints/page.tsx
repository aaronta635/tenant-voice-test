'use client';

import { useEffect, useState } from 'react';
import Card from '@/app/components/ui/Card';
import FilterChip from '@/app/components/ui/FilterChip';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import ComplaintCard from '@/app/components/complaints/ComplaintCard';
import { api, ApiError, type Complaint, type ComplaintStatus } from '@/app/lib/api';
import { COMPLAINT_STATUS_LABELS } from '@/app/lib/format';

const FILTERS: (ComplaintStatus | 'all')[] = ['all', 'open', 'under_review', 'resolved', 'dismissed'];

type Loaded = { attempt: number; complaints: Complaint[] | null; error: string | null };

/** Complaints about the owner or their properties, each with its status and timeline. */
export default function OwnerComplaintsPage() {
  const [filter, setFilter] = useState<ComplaintStatus | 'all'>('all');
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = loaded?.attempt === attempt ? loaded : null;

  useEffect(() => {
    let cancelled = false;
    api.complaints.listAgainstMe().then(
      (complaints) => { if (!cancelled) setLoaded({ attempt, complaints, error: null }); },
      (error) => {
        if (!cancelled) setLoaded({ attempt, complaints: null, error: error instanceof ApiError ? error.message : 'Please try again.' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const complaints = current?.complaints ?? [];
  const visible = filter === 'all' ? complaints : complaints.filter((c) => c.status === filter);
  const openCount = complaints.filter((c) => c.status === 'open').length;

  function replace(updated: Complaint) {
    setLoaded((previous) => (previous?.complaints
      ? { ...previous, complaints: previous.complaints.map((c) => (c.id === updated.id ? updated : c)) }
      : previous));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-dark sm:text-[30px]">
          Complaints
        </h1>
        <p className="mt-1 text-text-body">
          Formal complaints raised about you or your properties, with each update TenantVoice makes.
          {openCount > 0 ? ` ${openCount} awaiting your response.` : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter complaints">
        {FILTERS.map((item) => (
          <FilterChip key={item} selected={filter === item} onClick={() => setFilter(item)}>
            {item === 'all' ? 'All' : (COMPLAINT_STATUS_LABELS[item] ?? item)}
          </FilterChip>
        ))}
      </div>

      {!current ? (
        <p role="status" className="text-sm text-text-body">Loading complaints…</p>
      ) : !current.complaints ? (
        <LoadErrorCard title="Couldn't load the complaints" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
      ) : visible.length === 0 ? (
        <Card className="rounded-[16px] border border-border p-8 text-center">
          <h2 className="font-heading text-lg font-bold text-text-dark">
            {complaints.length === 0 ? 'No complaints' : 'Nothing matches this filter'}
          </h2>
          <p className="mt-2 text-sm text-text-body">
            {complaints.length === 0
              ? 'Complaints raised about your properties will appear here.'
              : 'Try a different status.'}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((complaint) => (
            <ComplaintCard
              key={complaint.id}
              complaint={complaint}
              perspective="against"
              onChanged={replace}
            />
          ))}
        </div>
      )}
    </div>
  );
}
