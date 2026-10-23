'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LeasePdf from '@/app/components/leases/LeasePdf';
import { LeaseStagePill, LeaseSteps, LeaseTerms, SignatureRecord } from '@/app/components/leases/LeaseOverview';
import SignatureForm from '@/app/components/leases/SignatureForm';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';
import { leasesApi, type Lease } from '@/app/lib/leases';

/**
 * The tenant's lease (R26): the terms, the latest PDF the owner sent, and
 * the two steps that are theirs. They confirm the terms of the PDF they
 * reviewed, then sign it with their typed name. A newer PDF from the owner
 * replaces the one shown, and the server refuses a step taken on an older one.
 */
export default function TenantLeaseView({ leaseId }: { leaseId: string }) {
  const [loaded, setLoaded] = useState<{ id: string; lease: Lease } | null>(null);
  const [failure, setFailure] = useState<{ id: string; notFound: boolean; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    leasesApi.get(leaseId).then(
      (lease) => {
        if (!active) return;
        setLoaded({ id: leaseId, lease });
        setFailure(null);
      },
      (err) => {
        if (!active) return;
        setFailure({
          id: leaseId,
          notFound: err instanceof ApiError && err.status === 404,
          message: err instanceof ApiError ? err.message : 'This lease could not be loaded. Please try again.',
        });
      },
    );
    return () => {
      active = false;
    };
  }, [leaseId, attempt]);

  const lease = loaded && loaded.id === leaseId ? loaded.lease : null;
  const failed = failure && failure.id === leaseId ? failure : null;

  /** A step the server refused because the lease moved on (a newer PDF): show the lease as it is now. */
  function refused(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
    if (err instanceof ApiError && err.status === 409) {
      setReviewed(false);
      setAttempt((value) => value + 1);
    }
  }

  async function confirm() {
    if (!lease?.document || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setLoaded({ id: leaseId, lease: await leasesApi.confirm(lease.id, lease.document.id) });
      setNotice('You confirmed the terms. Sign the lease next.');
    } catch (err) {
      refused(err, 'The terms were not confirmed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function sign(name: string) {
    if (!lease?.document) return;
    setError(null);
    setNotice(null);
    try {
      setLoaded({ id: leaseId, lease: await leasesApi.sign(lease.id, lease.document.id, name) });
      setNotice('You signed the lease. Your owner signs it next.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        refused(err, '');
        return;
      }
      throw err;
    }
  }

  if (failed) {
    return (
      <Card className="flex max-w-xl flex-col gap-4 p-6">
        <h1 className="font-heading text-h3 font-semibold text-text-dark">{failed.notFound ? 'Lease not found' : "Couldn't load this lease"}</h1>
        <p className="text-sm text-text-body">{failed.notFound ? 'It may belong to someone else, or the link is wrong.' : failed.message}</p>
        <div className="flex flex-wrap gap-3">
          {failed.notFound ? null : (
            <Button variant="secondary" onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}>Try again</Button>
          )}
          <ButtonLink href="/tenant/leases" variant="ghost">← Back to your leases</ButtonLink>
        </div>
      </Card>
    );
  }
  if (!lease) return <p role="status" className="text-text-body">Loading your lease…</p>;

  const pdf = lease.document;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Link href="/tenant/leases" className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-primary-strong underline">
        ← Your leases
      </Link>
      <header className="flex min-w-0 flex-col gap-2">
        <LeaseStagePill lease={lease} />
        <h1 className="break-words font-heading text-h2 font-bold text-text-dark">{lease.title}</h1>
        {lease.address ? <p className="break-words text-text-body">{lease.address}</p> : null}
      </header>

      <LeaseSteps lease={lease} />
      <FormMessage error={error} success={notice} />

      <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
        <h2 className="font-heading text-h4 font-semibold text-text-dark">Terms</h2>
        <LeaseTerms lease={lease} />
      </Card>

      <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
        <h2 className="font-heading text-h4 font-semibold text-text-dark">Lease PDF</h2>
        {pdf ? (
          <>
            <p className="text-sm text-text-body">
              Version {pdf.version}, sent {formatDate(pdf.created_at)}. If your owner sends a new version, it
              replaces this one and you review that one instead.
            </p>
            <LeasePdf leaseId={lease.id} documentId={pdf.id} filename={pdf.filename} title={`Lease PDF, version ${pdf.version}`} />
          </>
        ) : (
          <p className="text-sm text-text-body">Your owner has not sent the lease PDF yet. It appears here as soon as they do.</p>
        )}
      </Card>

      {lease.actions.confirm && pdf ? (
        <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
          <h2 className="font-heading text-h4 font-semibold text-text-dark">Confirm the terms</h2>
          <label className="flex min-h-11 items-start gap-3 text-sm text-text-dark">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-primary-strong"
            />
            <span>I have read version {pdf.version} of the lease PDF, and the terms above are the ones I agreed with my owner.</span>
          </label>
          <p className="text-xs text-text-body">Once you confirm, your owner can no longer change the PDF. You sign it next.</p>
          <Button className="self-start" disabled={!reviewed || busy} onClick={confirm}>
            {busy ? 'Confirming…' : 'Confirm the terms'}
          </Button>
        </Card>
      ) : null}

      {lease.actions.sign && lease.consent ? (
        <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
          <h2 className="font-heading text-h4 font-semibold text-text-dark">Sign the lease</h2>
          <SignatureForm
            consent={lease.consent}
            suggestedName={lease.tenant.name}
            submitLabel="Sign the lease"
            busyLabel="Signing…"
            onSign={sign}
          />
        </Card>
      ) : null}

      {lease.tenant_signature || lease.owner_signature ? (
        <Card className="flex min-w-0 flex-col gap-3 p-5 sm:p-6">
          <h2 className="font-heading text-h4 font-semibold text-text-dark">Signatures</h2>
          {lease.tenant_signature ? <SignatureRecord who="You" signature={lease.tenant_signature} /> : null}
          {lease.owner_signature ? <SignatureRecord who={lease.owner.name} signature={lease.owner_signature} /> : null}
          <NextStep lease={lease} />
        </Card>
      ) : null}
    </div>
  );
}

function NextStep({ lease }: { lease: Lease }) {
  if (lease.stage === 'tenant_signed') return <p className="text-sm text-text-body">Your owner signs the same PDF next, then activates the lease.</p>;
  if (lease.stage === 'signed') return <p className="text-sm text-text-body">You both signed. Your owner activates the lease next.</p>;
  if (lease.stage === 'active') {
    return (
      <p className="text-sm text-text-body">
        Your lease is active from {formatDate(lease.start_date)}. Arrange the keys and the condition report with your
        owner in <Link href="/tenant/messages" className="font-semibold text-primary-strong underline">Messages</Link>.
      </p>
    );
  }
  return null;
}
