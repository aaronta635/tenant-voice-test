'use client';

import { useEffect, useState } from 'react';
import Card from '@/app/components/ui/Card';
import FilterChip from '@/app/components/ui/FilterChip';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import RepairCard from '@/app/components/provider/RepairCard';
import { ApiError } from '@/app/lib/api';
import { providerRepairs, type ProviderRepair, type RepairVisit } from '@/app/lib/provider-repairs';

type Filter = 'open' | 'closed';
const OPEN_STAGES = new Set(['assigned', 'scheduled']);
/** How often "has the visit started" is looked at again while the page is open. */
const CLOCK_MS = 30_000;

/**
 * The repairs owners assigned to the provider (backend /me/repairs): book the
 * visit, then mark the job done; the tenant and the owner are told each time.
 */
export default function ProviderRepairs() {
  const [repairs, setRepairs] = useState<ProviderRepair[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>('open');
  const [now, setNow] = useState(() => new Date());
  // A job finished here stays in place, with its message, until the filter changes.
  const [kept, setKept] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    providerRepairs.list()
      .then((list) => { if (active) { setRepairs(list); setLoadError(null); } })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Could not load your repairs. Please try again.');
      });
    return () => { active = false; };
  }, [attempt]);

  // A visit starting while the page is open makes its job one to mark done.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);

  function replace(saved: ProviderRepair) {
    setRepairs((list) => list?.map((repair) => (repair.id === saved.id ? saved : repair)) ?? list);
    setKept((ids) => (ids.includes(saved.id) ? ids : [...ids, saved.id]));
    return saved;
  }

  function show(next: Filter) {
    setFilter(next);
    setKept([]);
  }

  const open = repairs?.filter((repair) => OPEN_STAGES.has(repair.stage)) ?? [];
  const closed = repairs?.filter((repair) => !OPEN_STAGES.has(repair.stage)) ?? [];
  const shown = repairs?.filter((repair) => OPEN_STAGES.has(repair.stage) === (filter === 'open') || kept.includes(repair.id)) ?? [];
  const waiting = open.filter((repair) => repair.stage === 'assigned').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assigned repairs"
        description={`Repairs owners have asked you to do. Book the visit, then mark the job done; the tenant and the owner are told each time.${waiting ? ` ${waiting} need${waiting === 1 ? 's' : ''} a visit booked.` : ''}`}
      />

      {loadError ? (
        <LoadErrorCard title="Repairs could not be loaded" message={loadError} onRetry={() => { setLoadError(null); setRepairs(null); setAttempt((value) => value + 1); }} />
      ) : !repairs ? (
        <p role="status" className="text-sm text-text-body">Loading your repairs…</p>
      ) : repairs.length === 0 ? (
        <Card className="p-8 text-center">
          <h2 className="font-heading text-lg font-semibold text-text-dark">No repairs assigned yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-body">When an owner assigns you a repair at one of their properties, it appears here for you to book the visit.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show repairs">
            <FilterChip selected={filter === 'open'} onClick={() => show('open')}>To do ({open.length})</FilterChip>
            <FilterChip selected={filter === 'closed'} onClick={() => show('closed')}>Done and cancelled ({closed.length})</FilterChip>
          </div>
          {shown.length === 0 ? (
            <Card className="p-8 text-center">
              <h2 className="font-heading text-lg font-semibold text-text-dark">{filter === 'open' ? 'Nothing to do right now' : 'No finished repairs yet'}</h2>
              <p className="mt-2 text-sm text-text-body">{filter === 'open' ? 'Every repair assigned to you is done.' : 'Repairs you mark done appear here.'}</p>
            </Card>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-2">
              {shown.map((repair) => (
                <RepairCard
                  key={repair.id}
                  repair={repair}
                  now={now}
                  onSchedule={(visit: RepairVisit) => providerRepairs.schedule(repair.id, visit).then(replace)}
                  onComplete={(note: string) => providerRepairs.complete(repair.id, note).then(replace)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
