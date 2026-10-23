'use client';

import { useEffect, useState } from 'react';
import OwnerShell from '@/app/components/owner/OwnerShell';
import Card from '@/app/components/ui/Card';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import OwnerRepairActions from '@/app/components/repairs/OwnerRepairActions';
import RepairDetails from '@/app/components/repairs/RepairDetails';
import RepairReportForm from '@/app/components/repairs/RepairReportForm';
import { ApiError } from '@/app/lib/api';
import { repairs, type Repair, type RepairHome } from '@/app/lib/repairs';

/**
 * An owner's repairs: the ones their tenants report and the ones they log,
 * assigned to a provider who covers the category, then booked and done by
 * the provider and confirmed by the tenant. The owner may resolve one at
 * any stage.
 */
export default function OwnerMaintenancePage() {
  const [items, setItems] = useState<Repair[] | null>(null);
  const [homes, setHomes] = useState<RepairHome[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([repairs.list(), repairs.homes()])
      .then(([list, places]) => {
        if (!active) return;
        setItems(list);
        setHomes(places);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'The repairs could not be loaded. Please try again.');
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  function replace(saved: Repair) {
    setItems((list) => list?.map((item) => (item.id === saved.id ? saved : item)) ?? list);
  }

  const waiting = items?.filter((item) => item.status === 'open').length ?? 0;

  return (
    <OwnerShell>
      <main className="mx-auto w-full max-w-[900px] space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-dark">Maintenance</h1>
          <p className="mt-1 text-sm text-text-body">
            Repairs at your homes. Complaints stay on the Complaints page.
            {waiting ? ` ${waiting} ${waiting === 1 ? 'repair needs' : 'repairs need'} a provider.` : ''}
          </p>
        </div>

        {loadError ? (
          <LoadErrorCard title="Repairs could not be loaded" message={loadError} onRetry={() => { setLoadError(null); setItems(null); setAttempt((n) => n + 1); }} />
        ) : !items ? (
          <p role="status" className="text-sm text-text-body">Loading repairs…</p>
        ) : (
          <>
            <Card className="p-6">
              <h2 className="font-heading text-lg font-semibold text-text-dark">Repairs</h2>
              {items.length === 0 ? (
                <p className="mt-3 text-sm text-text-body">No repairs yet. Your tenants&apos; repair requests appear here.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {items.map((item) => (
                    <li key={item.id} className="rounded-xl border border-border p-4">
                      <RepairDetails repair={item} viewer="owner" />
                      <OwnerRepairActions repair={item} onSaved={replace} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-6">
              <h2 className="font-heading text-lg font-semibold text-text-dark">Log a repair</h2>
              {homes.length ? (
                <RepairReportForm homes={homes} viewer="owner" onCreated={(created) => setItems((list) => [created, ...(list ?? [])])} />
              ) : (
                <p className="mt-2 text-sm text-text-body">You can log a repair for a home once it has a tenant with an approved application.</p>
              )}
            </Card>
          </>
        )}
      </main>
    </OwnerShell>
  );
}
