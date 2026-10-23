'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LeaseStagePill } from '@/app/components/leases/LeaseOverview';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import { ApiError } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';
import { leasesApi, rentText, type Lease } from '@/app/lib/leases';

/** The tenant's lease for an application: undefined while it loads, null when the owner has not drafted one. */
export type PipelineLeaseState = { lease: Lease | null | undefined; error: string | null; retry: () => void };

/** Reads the tenant's lease for an approved application (none is read for any other). */
export function usePipelineLease(applicationId: string | null): PipelineLeaseState {
  const [loaded, setLoaded] = useState<{ key: string; lease: Lease | null } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = applicationId ? `${applicationId}:${attempt}` : null;

  useEffect(() => {
    if (!applicationId) return;
    let active = true;
    const current = `${applicationId}:${attempt}`;
    leasesApi.list().then(
      (leases) => {
        if (active) setLoaded({ key: current, lease: leases.find((lease) => lease.application_id === applicationId) ?? null });
      },
      (err) => {
        if (active) setFailure({ key: current, message: err instanceof ApiError ? err.message : 'Your lease could not be loaded.' });
      },
    );
    return () => {
      active = false;
    };
  }, [applicationId, attempt]);

  return {
    lease: key && loaded?.key === key ? loaded.lease : undefined,
    error: key && failure?.key === key ? failure.message : null,
    retry: () => setAttempt((value) => value + 1),
  };
}

/** Whether the lease lets the tenant move in: the owner activated it. */
export function leaseActive(lease: Lease | null | undefined): boolean {
  return lease?.stage === 'active' || lease?.stage === 'ended';
}

/** The pipeline's lease step: the lease as the server has it, or why there is none yet. */
export function PipelineLeaseStep({ state, approved }: { state: PipelineLeaseState; approved: boolean }) {
  if (!approved) {
    return (
      <p className="rounded-[14px] border border-[#dee1e6] bg-white p-5 text-sm text-[#565d6d]">
        Your lease comes once the owner approves your application.
      </p>
    );
  }
  if (state.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-[14px] border border-danger bg-white p-5 text-sm text-danger">
        <p>{state.error}</p>
        <Button variant="secondary" size="sm" onClick={state.retry}>Try again</Button>
      </div>
    );
  }
  if (state.lease === undefined) return <p role="status" className="text-sm text-[#565d6d]">Loading your lease…</p>;
  if (state.lease === null) {
    return (
      <p className="rounded-[14px] border border-[#dee1e6] bg-white p-5 text-sm text-[#565d6d]">
        Your application is approved. Your owner drafts the lease next, and it appears here when they send it.
      </p>
    );
  }
  const lease = state.lease;
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-[#dee1e6] bg-white p-5">
      <LeaseStagePill lease={lease} />
      <dl className="grid gap-4 text-sm md:grid-cols-2">
        <Detail label="Rent" value={rentText(lease.rent_amount, lease.rent_frequency)} />
        <Detail label="First payment due" value={formatDate(lease.first_due_date)} />
        <Detail label="Lease starts" value={formatDate(lease.start_date)} />
        <Detail label="Lease ends" value={lease.end_date ? formatDate(lease.end_date) : 'No end date'} />
      </dl>
    </div>
  );
}

/** The pipeline's move-in step: open once the owner activated the lease. */
export function PipelineMoveInStep({ state }: { state: PipelineLeaseState }) {
  const lease = state.lease;
  if (!leaseActive(lease) || !lease) {
    return (
      <p className="rounded-[14px] border border-[#dee1e6] bg-white p-5 text-sm text-[#565d6d]">
        Moving in opens once you and your owner have both signed the lease and the owner has activated it.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-[#dee1e6] bg-white p-5 text-sm text-[#565d6d]">
      <p className="font-semibold text-[#171a1f]">Your lease is active from {formatDate(lease.start_date)}.</p>
      <p>
        Your first rent payment of {rentText(lease.rent_amount, lease.rent_frequency)} is due {formatDate(lease.first_due_date)}.
        Arrange the keys and the condition report with your owner in{' '}
        <Link href="/tenant/messages" className="font-semibold text-primary-strong underline">Messages</Link>.
      </p>
    </div>
  );
}

/** The step's button: the lease page, worded for what the tenant does there next. */
export function PipelineLeaseAction({ lease }: { lease: Lease | null | undefined }) {
  if (!lease) return null;
  const label = lease.actions.confirm ? 'Review the lease' : lease.actions.sign ? 'Sign the lease' : 'View the lease';
  return <ButtonLink href={`/tenant/leases/${lease.id}`} className="h-10 rounded-[8px]">{label}</ButtonLink>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#565d6d]">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
