'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LeasePdf from '@/app/components/leases/LeasePdf';
import { LeaseStagePill, LeaseSteps, LeaseTerms, SignatureRecord } from '@/app/components/leases/LeaseOverview';
import OwnerLeaseDocument from '@/app/components/leases/OwnerLeaseDocument';
import SignatureForm from '@/app/components/leases/SignatureForm';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';
import { leasesApi, type Lease } from '@/app/lib/leases';

/**
 * The owner's lease (R26): the agreed terms, sending the PDF until the tenant
 * confirms it, then signing the PDF the tenant signed and activating the
 * lease. Each step shows only once the server offers it.
 */
export default function OwnerLeaseView({ leaseId }: { leaseId: string }) {
  const [loaded, setLoaded] = useState<{ id: string; lease: Lease } | null>(null);
  const [failure, setFailure] = useState<{ id: string; notFound: boolean; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [activating, setActivating] = useState(false);
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

  function show(updated: Lease, message: string | null) {
    setLoaded({ id: leaseId, lease: updated });
    setError(null);
    setNotice(message);
  }

  /** A send refused because the lease moved on, such as the tenant confirming meanwhile: show why, then the lease as it is. */
  function refused(message: string) {
    setNotice(null);
    setError(message);
    setAttempt((value) => value + 1);
  }

  async function activate(current: Lease) {
    setActivating(true);
    setError(null);
    try {
      show(await leasesApi.activate(current.id), `The lease is active. ${current.tenant.name} has been told.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The lease was not activated. Please try again.');
      if (err instanceof ApiError && err.status === 409) setAttempt((value) => value + 1);
    } finally {
      setActivating(false);
    }
  }

  /** Signs, then activates: a failed activation leaves the signature, and the button to activate. */
  async function signAndActivate(current: Lease, name: string) {
    let signed: Lease;
    try {
      signed = await leasesApi.ownerSign(current.id, name);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setAttempt((value) => value + 1);
      throw err;
    }
    show(signed, 'You signed the lease.');
    if (signed.actions.activate) await activate(signed);
  }

  if (failed) {
    return (
      <Card className="flex max-w-xl flex-col gap-4 p-6">
        <h1 className="font-heading text-h3 font-semibold text-text-dark">{failed.notFound ? 'Lease not found' : "Couldn't load this lease"}</h1>
        <p className="text-sm text-text-body">{failed.notFound ? 'It may belong to another owner, or the link is wrong.' : failed.message}</p>
        <div className="flex flex-wrap gap-3">
          {failed.notFound ? null : (
            <Button variant="secondary" onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}>Try again</Button>
          )}
          <ButtonLink href="/owner/leases" variant="ghost">← Back to leases</ButtonLink>
        </div>
      </Card>
    );
  }
  if (!lease) return <p role="status" className="text-text-body">Loading the lease…</p>;

  const pdf = lease.document;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Link href="/owner/leases" className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-primary-strong underline">
        ← Leases
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

      {pdf ? (
        <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
          <h2 className="font-heading text-h4 font-semibold text-text-dark">Lease PDF</h2>
          <p className="text-sm text-text-body">
            Version {pdf.version}, sent {formatDate(pdf.created_at)}.
            {lease.tenant_confirmed_at ? ` ${lease.tenant.name} confirmed its terms, so it can no longer change.` : ''}
          </p>
          <LeasePdf leaseId={lease.id} documentId={pdf.id} filename={pdf.filename} title={`Lease PDF, version ${pdf.version}`} />
        </Card>
      ) : null}

      {lease.actions.send_document ? (
        <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
          <h2 className="font-heading text-h4 font-semibold text-text-dark">{pdf ? 'Send a new version' : 'Send the lease PDF'}</h2>
          <OwnerLeaseDocument key={pdf?.id ?? 'first'} lease={lease} onSent={show} onRefused={refused} />
        </Card>
      ) : null}

      {lease.actions.owner_sign && lease.consent ? (
        <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
          <h2 className="font-heading text-h4 font-semibold text-text-dark">Sign and activate</h2>
          <p className="text-sm text-text-body">
            {lease.tenant.name} signed version {pdf?.version} of the lease PDF. You sign the same PDF, and the lease
            then becomes active.
          </p>
          <SignatureForm
            consent={lease.consent}
            suggestedName={lease.owner.name}
            submitLabel="Sign and activate the lease"
            busyLabel="Signing…"
            onSign={(name) => signAndActivate(lease, name)}
          />
        </Card>
      ) : null}

      {lease.actions.activate ? (
        <Card className="flex min-w-0 flex-col items-start gap-3 p-5 sm:p-6">
          <h2 className="font-heading text-h4 font-semibold text-text-dark">Activate the lease</h2>
          <p className="text-sm text-text-body">You both signed the same PDF. Activating it starts the tenancy in TenantVoice.</p>
          <Button disabled={activating} onClick={() => activate(lease)}>{activating ? 'Activating…' : 'Activate the lease'}</Button>
        </Card>
      ) : null}

      {lease.tenant_signature || lease.owner_signature ? (
        <Card className="flex min-w-0 flex-col gap-3 p-5 sm:p-6">
          <h2 className="font-heading text-h4 font-semibold text-text-dark">Signatures</h2>
          {lease.tenant_signature ? <SignatureRecord who={lease.tenant.name} signature={lease.tenant_signature} /> : null}
          {lease.owner_signature ? <SignatureRecord who="You" signature={lease.owner_signature} /> : null}
        </Card>
      ) : null}

      {lease.stage === 'review' || lease.stage === 'confirmed' ? (
        <p className="text-sm text-text-body">
          {lease.stage === 'review'
            ? `${lease.tenant.name} reviews the PDF and confirms the terms next.`
            : `${lease.tenant.name} confirmed the terms and signs the PDF next. You are told when they have.`}
        </p>
      ) : null}
    </div>
  );
}
