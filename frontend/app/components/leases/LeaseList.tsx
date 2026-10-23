'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DraftLeaseForm from '@/app/components/leases/DraftLeaseForm';
import { LeaseStagePill } from '@/app/components/leases/LeaseOverview';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import EmptyState from '@/app/components/ui/EmptyState';
import { ApiError } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';
import { leasesApi, rentText, type Lease, type LeaseRole } from '@/app/lib/leases';

type Load<T> = { items: T[] } | { error: string } | null;

/** A list read from the API, again at each attempt; null while it loads. read must keep its identity (a leasesApi function). */
function useList<T>(read: () => Promise<T[]>, attempt: number): Load<T> {
  const [state, setState] = useState<{ attempt: number; load: Load<T> } | null>(null);
  useEffect(() => {
    let active = true;
    read().then(
      (items) => { if (active) setState({ attempt, load: { items } }); },
      (err) => {
        if (active) setState({ attempt, load: { error: err instanceof ApiError ? err.message : 'This list could not be loaded.' } });
      },
    );
    return () => {
      active = false;
    };
  }, [read, attempt]);
  return state && state.attempt === attempt ? state.load : null;
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-5">
      <p role="alert" className="text-sm text-danger">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
    </Card>
  );
}

function LeaseCard({ lease, href }: { lease: Lease; href: string }) {
  const other = lease.viewer_role === 'owner' ? lease.tenant : lease.owner;
  return (
    <li>
      <Card className="flex min-w-0 flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <LeaseStagePill lease={lease} />
          <h3 className="break-words font-heading text-lg font-semibold text-text-dark">{lease.title}</h3>
          <p className="break-words text-sm text-text-body">
            {lease.viewer_role === 'owner' ? 'Tenant' : 'Owner'}: {other.name} · {rentText(lease.rent_amount, lease.rent_frequency)} ·
            from {formatDate(lease.start_date)}
          </p>
        </div>
        <ButtonLink href={href} variant="secondary" size="sm" className="shrink-0 self-start sm:self-center">
          Open the lease
        </ButtonLink>
      </Card>
    </li>
  );
}

/** The caller's leases, newest first, each opening its page. */
export function LeaseList({ role }: { role: LeaseRole }) {
  const [attempt, setAttempt] = useState(0);
  const leases = useList(leasesApi.list, attempt);
  const base = role === 'owner' ? '/owner/leases' : '/tenant/leases';

  if (!leases) return <p role="status" className="text-sm text-text-body">Loading leases…</p>;
  if ('error' in leases) return <LoadFailed message={leases.error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (leases.items.length === 0) {
    return role === 'owner'
      ? <EmptyState title="No leases yet" description="Draft one from an approved application above." />
      : <EmptyState title="No lease yet" description="When an owner approves your application and sends you the lease, it appears here for you to review and sign." />;
  }
  return (
    <ul className="flex min-w-0 flex-col gap-3">
      {leases.items.map((lease) => <LeaseCard key={lease.id} lease={lease} href={`${base}/${lease.id}`} />)}
    </ul>
  );
}

/** The owner's approved applications without a lease, each with the form that drafts one. */
export function LeaseCandidates() {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const candidates = useList(leasesApi.candidates, attempt);

  if (!candidates) return <p role="status" className="text-sm text-text-body">Loading approved applications…</p>;
  if ('error' in candidates) return <LoadFailed message={candidates.error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (candidates.items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-body">
        No approved application is waiting for a lease. When you approve one, you draft its lease here.
      </p>
    );
  }
  return (
    <ul className="flex min-w-0 flex-col gap-3">
      {candidates.items.map((candidate) => (
        <li key={candidate.application_id}>
          <Card className="flex min-w-0 flex-col gap-4 p-5">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="break-words font-heading text-lg font-semibold text-text-dark">{candidate.title}</h3>
                <p className="break-words text-sm text-text-body">
                  {candidate.tenant.name}
                  {candidate.approved_at ? ` · approved ${formatDate(candidate.approved_at)}` : ''}
                  {candidate.address ? ` · ${candidate.address}` : ''}
                </p>
              </div>
              <Button
                variant={open === candidate.application_id ? 'ghost' : 'primary'}
                size="sm"
                className="shrink-0 self-start"
                aria-expanded={open === candidate.application_id}
                onClick={() => setOpen(open === candidate.application_id ? null : candidate.application_id)}
              >
                {open === candidate.application_id ? 'Close' : 'Prepare the lease'}
              </Button>
            </div>
            {open === candidate.application_id ? (
              <DraftLeaseForm candidate={candidate} onCreated={(lease) => router.push(`/owner/leases/${lease.id}`)} />
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}
