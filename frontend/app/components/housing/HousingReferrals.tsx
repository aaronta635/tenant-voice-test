'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import StatePill, { type PillTone } from '@/app/components/admin/StatePill';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import { ApiError } from '@/app/lib/api';
import { csvDateTime } from '@/app/lib/csv';
import { formatDateTime } from '@/app/lib/format';
import { housingApi, referralActions, type Referral, type ReferralAction, type ReferralUpdate } from '@/app/lib/housing-api';
import { CsvDownloadButton, type HousingColumn } from './HousingTable';
import { useHousingData } from './use-housing-data';

const STATUS_TONES: Record<string, PillTone> = {
  REFERRED: 'warning',
  UNDER_REVIEW: 'info',
  PACKAGE_READY: 'success',
  CLOSED: 'neutral',
};

const CSV_COLUMNS: HousingColumn<Referral>[] = [
  { header: 'Case', value: (row) => row.case_reference },
  { header: 'Title', value: (row) => row.title },
  { header: 'Category', value: (row) => row.category },
  { header: 'Severity', value: (row) => row.severity },
  { header: 'Area', value: (row) => row.area },
  { header: 'Status', value: (row) => row.status },
  { header: 'Assigned team', value: (row) => row.assigned_team },
  { header: 'Referred', value: (row) => csvDateTime(row.referred_at) },
  { header: 'Updated', value: (row) => csvDateTime(row.updated_at) },
  { header: 'Officer note', value: (row) => row.regulator_note },
];

const NOTE_LIMIT = 500;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-text-body">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-text-dark">{children}</dd>
    </div>
  );
}

function yesNo(value: boolean | null): string {
  return value === null ? 'Not known' : value ? 'Yes' : 'No';
}

/** One referred case: its facts, the case package admins prepared, and the officer's actions with a note. */
function ReferralCard({ referral, onChanged }: { referral: Referral; onChanged: (update: ReferralUpdate) => void }) {
  const id = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ReferralAction | null>(null);
  const [message, setMessage] = useState<{ error: string | null; success: string | null }>({ error: null, success: null });
  const { complaint, parties, evidence } = referral;

  async function act(action: ReferralAction) {
    if (busy) return; // one action at a time: a second click never sends it again
    setBusy(action);
    setMessage({ error: null, success: null });
    try {
      const update = await housingApi.actOnReferral(referral.id, action, note.trim() || null);
      onChanged(update);
      setNote('');
      setMessage({ error: null, success: `Saved: the case is now ${update.status.toLowerCase()}.` });
    } catch (error) {
      setMessage({ error: error instanceof ApiError ? error.message : 'The change was not saved. Please try again.', success: null });
    } finally {
      setBusy(null);
    }
  }

  return (
    <li>
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-body">{referral.case_reference ?? 'Case'}</p>
            <h2 id={`${id}-title`} className="mt-1 break-words font-heading text-h4 font-semibold text-text-dark">{referral.title ?? 'Referred complaint'}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {referral.severity ? <StatePill tone={referral.severity === 'critical' ? 'danger' : 'warning'}>{referral.severity === 'critical' ? 'Critical' : 'High'}</StatePill> : null}
            <StatePill tone={STATUS_TONES[referral.package_status] ?? 'neutral'}>{referral.status}</StatePill>
          </div>
        </div>
        {referral.reason ? <p className="text-sm text-text-body">{referral.reason}</p> : null}
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Category">{referral.category ?? '—'}</Fact>
          <Fact label="Area">{referral.area ?? '—'}</Fact>
          <Fact label="Referred">{formatDateTime(referral.referred_at)}</Fact>
          <Fact label="Assigned team">{referral.assigned_team ?? '—'}</Fact>
        </dl>
        {referral.admin_note ? <p className="rounded-lg bg-background p-3 text-sm text-text-dark"><span className="font-semibold">Admin note: </span>{referral.admin_note}</p> : null}
        {referral.regulator_note ? <p className="rounded-lg bg-surface p-3 text-sm text-navy"><span className="font-semibold">Officer note: </span>{referral.regulator_note}</p> : null}
        <details className="text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary-strong underline">
            Case package<span className="sr-only"> for {referral.case_reference ?? referral.title}</span>
          </summary>
          <div className="mt-2 flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Home">{referral.address ?? '—'}</Fact>
              <Fact label="Complaint lodged">{formatDateTime(complaint.lodged_at)}</Fact>
              <Fact label="Tenant">{parties.tenant_name ?? '—'}</Fact>
              <Fact label="Owner">{parties.owner_name ?? '—'}</Fact>
              <Fact label="Days open">{evidence.days_open ?? '—'}</Fact>
              <Fact label="Open complaints at this home">{evidence.property_open_complaints ?? '—'}</Fact>
              <Fact label="Open complaints about this owner">{evidence.owner_open_complaints ?? '—'}</Fact>
              <Fact label="Photos in the complaint">{evidence.photo_count}</Fact>
              <Fact label="Tenant's documents verified">{yesNo(evidence.documents_verified)}</Fact>
              <Fact label="Repair status">{evidence.work_order_status ?? 'No repair'}</Fact>
            </dl>
            {complaint.description ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-body">What the tenant said</p>
                <p className="mt-1 whitespace-pre-line break-words text-text-dark">{complaint.description}</p>
              </div>
            ) : null}
            {evidence.events.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-body">Case timeline</p>
                <ol className="mt-1 space-y-1">
                  {evidence.events.map((event, index) => (
                    <li key={`${event.created_at}-${index}`} className="break-words text-text-dark">
                      <span className="font-semibold">{formatDateTime(event.created_at)}</span> · {event.type?.replace(/_/g, ' ').toLowerCase() ?? 'update'}
                      {event.note ? `: ${event.note}` : ''}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </details>
        <div className="flex flex-col gap-3 border-t border-border pt-4 print:hidden">
          <label htmlFor={`${id}-note`} className="text-xs font-semibold uppercase tracking-wide text-text-body">
            Note for the case (optional)
          </label>
          <textarea
            id={`${id}-note`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={NOTE_LIMIT}
            rows={2}
            aria-describedby={`${id}-note-help`}
            className="w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
          />
          <p id={`${id}-note-help`} className="text-xs text-text-body">Kept with the case for admins and officers. Leave it empty to keep the last note.</p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-title`}>
            {referralActions(referral.package_status).map(({ action, label }) => (
              <Button
                key={action}
                type="button"
                variant={action === 'CLOSE' ? 'secondary' : 'primary'}
                aria-disabled={busy !== null || undefined}
                onClick={() => act(action)}
              >
                {busy === action ? 'Saving…' : label}
              </Button>
            ))}
          </div>
          <FormMessage error={message.error} success={message.success} />
        </div>
      </Card>
    </li>
  );
}

/** The cases admins referred to the portal, through the officer's JWT (GET /housing/referrals). */
export default function HousingReferrals() {
  const { loading, data, error, retry, replace } = useHousingData(housingApi.referrals);

  function changed(update: ReferralUpdate) {
    replace((items) => items.map((item) => (item.id === update.id ? {
      ...item, status: update.status, package_status: update.package_status, regulator_note: update.regulator_note, updated_at: update.updated_at,
    } : item)));
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Referrals"
        description="Critical cases admins referred to the Housing Portal, with the package they prepared. Start the review, mark the package ready for the tribunal, or close the case."
        actions={data?.length ? <CsvDownloadButton name="referrals" label="referrals" columns={CSV_COLUMNS} rows={data} /> : null}
      />
      {loading ? (
        <p role="status" className="text-sm text-text-body">Loading the referrals…</p>
      ) : !data ? (
        <LoadErrorCard title="Couldn't load the referrals" message={error ?? undefined} onRetry={retry} />
      ) : data.length === 0 ? (
        <Card className="p-6">
          <h2 className="font-heading text-h4 font-semibold text-text-dark">No referrals yet</h2>
          <p className="mt-2 text-sm text-text-body">
            Admins refer critical cases from their alerts. Until then, see the{' '}
            <Link href="/housing/red-flags" className="font-semibold text-primary-strong underline">red-flag alerts</Link>.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.map((referral) => <ReferralCard key={referral.id} referral={referral} onChanged={changed} />)}
        </ul>
      )}
    </div>
  );
}
