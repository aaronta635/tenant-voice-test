'use client';

import { useEffect, useState } from 'react';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import Card from '@/app/components/ui/Card';
import FilterChip from '@/app/components/ui/FilterChip';
import ComplaintCard from '@/app/components/complaints/ComplaintCard';
import { api, type Complaint, type ComplaintStatus } from '@/app/lib/api';
import { COMPLAINT_STATUS_LABELS } from '@/app/lib/format';

const FILTERS: (ComplaintStatus | 'all')[] = ['all', 'open', 'under_review', 'resolved', 'dismissed'];

export default function ProviderComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [filter, setFilter] = useState<ComplaintStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.complaints.listAgainstMe();
        if (!cancelled) { setComplaints(list); setLoadError(null); }
      } catch {
        if (!cancelled) setLoadError('Could not load complaints. Please try again.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const visible =
    filter === 'all' ? complaints : complaints.filter((c) => c.status === filter);
  const openCount = complaints.filter((c) => c.status === 'open').length;

  function replace(updated: Complaint) {
    setComplaints((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Complaints" description={`Formal complaints raised about your services.${!loading && !loadError && openCount > 0 ? ` ${openCount} awaiting your response.` : ''}`} />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter complaints">
        {FILTERS.map((item) => (
          <FilterChip key={item} selected={filter === item} onClick={() => setFilter(item)}>
            {item === 'all' ? 'All' : (COMPLAINT_STATUS_LABELS[item] ?? item)}
          </FilterChip>
        ))}
      </div>

      {loadError ? <LoadErrorCard message={loadError} onRetry={() => { setLoading(true); setLoadError(null); setReload(value => value + 1); }} /> : loading ? (
        <p role="status" className="text-sm text-[#565d6d]">Loading complaints…</p>
      ) : visible.length === 0 ? (
        <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center shadow-none">
          <h2 className="font-heading text-lg font-bold text-[#171a1f]">
            {complaints.length === 0 ? 'No complaints' : 'Nothing matches this filter'}
          </h2>
          <p className="mt-2 text-sm text-[#565d6d]">
            {complaints.length === 0
              ? 'Complaints about your work will appear here.'
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
