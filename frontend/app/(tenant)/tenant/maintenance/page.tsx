'use client';

import { useEffect, useState } from 'react';
import TenantShell from '@/app/components/tenant/TenantShell';
import Card from '@/app/components/ui/Card';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import RatingForm from '@/app/components/repairs/RatingForm';
import RepairDetails from '@/app/components/repairs/RepairDetails';
import RepairReportForm from '@/app/components/repairs/RepairReportForm';
import { ApiError } from '@/app/lib/api';
import { repairs, type Repair, type RepairHome } from '@/app/lib/repairs';

/**
 * A tenant's repairs: report one for a home they rent, follow it while the
 * owner assigns a provider and the provider books the visit, then confirm
 * the work with a rating (or rate it after the owner resolved it).
 */
export default function TenantMaintenancePage() {
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
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Your repairs could not be loaded. Please try again.');
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  function replace(saved: Repair) {
    setItems((list) => list?.map((item) => (item.id === saved.id ? saved : item)) ?? list);
  }

  return (
    <TenantShell>
      <main className="mx-auto w-full max-w-[860px] space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-dark">Repair requests</h1>
          <p className="mt-1 text-sm text-text-body">
            Repairs are separate from formal complaints. Your landlord assigns a provider, the provider books the visit, and you confirm the work once it is done.
          </p>
        </div>

        {loadError ? (
          <LoadErrorCard title="Repairs could not be loaded" message={loadError} onRetry={() => { setLoadError(null); setItems(null); setAttempt((n) => n + 1); }} />
        ) : !items ? (
          <p role="status" className="text-sm text-text-body">Loading your repairs…</p>
        ) : (
          <>
            <Card className="p-6">
              <h2 className="font-heading text-lg font-semibold text-text-dark">Report a repair</h2>
              {homes.length ? (
                <RepairReportForm homes={homes} viewer="tenant" onCreated={(created) => setItems((list) => [created, ...(list ?? [])])} />
              ) : (
                <p className="mt-2 text-sm text-text-body">
                  You can report a repair once your application for a home is approved.
                </p>
              )}
            </Card>

            <Card className="p-6">
              <h2 className="font-heading text-lg font-semibold text-text-dark">Your repairs</h2>
              {items.length === 0 ? (
                <p className="mt-3 text-sm text-text-body">No repair requests yet.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {items.map((item) => (
                    <li key={item.id} className="rounded-xl border border-border p-4">
                      <RepairDetails repair={item} viewer="tenant" />
                      {item.can_confirm ? (
                        <RatingForm action="Confirm and rate" legend={`Is ${item.title} fixed? Rate the work to confirm it.`}
                          onSubmit={(rating) => repairs.confirm(item.id, rating).then(replace)} />
                      ) : item.can_rate ? (
                        <RatingForm action="Rate this repair" legend={`How was the work on ${item.title}?`}
                          onSubmit={(rating) => repairs.rate(item.id, rating).then(replace)} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </main>
    </TenantShell>
  );
}
