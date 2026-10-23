'use client';

import { useState } from 'react';
import Link from 'next/link';
import StatePill, { type PillTone } from '@/app/components/admin/StatePill';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import Button from '@/app/components/ui/Button';
import PageHeader from '@/app/components/ui/PageHeader';
import { ApiError } from '@/app/lib/api';
import { csvDateTime } from '@/app/lib/csv';
import { formatDateTime } from '@/app/lib/format';
import { FLAG_STATUSES, housingApi, type FlagStatus, type RedFlagEvent, type RegulatoryFlag } from '@/app/lib/housing-api';
import HousingTable, { type HousingColumn } from './HousingTable';
import { useHousingData } from './use-housing-data';

const EVENT_STATUS: Record<string, { label: string; tone: PillTone }> = {
  OPEN: { label: 'Open', tone: 'danger' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  DISMISSED: { label: 'Dismissed', tone: 'neutral' },
};

function eventStatus(status: string) {
  return EVENT_STATUS[status] ?? { label: status, tone: 'neutral' as PillTone };
}

const EVENT_COLUMNS: HousingColumn<RedFlagEvent>[] = [
  { header: 'Rule', value: (row) => row.rule ?? row.summary },
  { header: 'Area', value: (row) => row.area },
  {
    header: 'Status',
    value: (row) => eventStatus(row.status).label,
    cell: (row) => <StatePill tone={eventStatus(row.status).tone}>{eventStatus(row.status).label}</StatePill>,
  },
  { header: 'Complaints', value: (row) => row.complaint_count, numeric: true },
  { header: 'Threshold', value: (row) => row.threshold, numeric: true },
  { header: 'Window (days)', value: (row) => row.window_days, numeric: true },
  { header: 'Triggered', value: (row) => csvDateTime(row.triggered_at), cell: (row) => formatDateTime(row.triggered_at) },
  { header: 'Resolved', value: (row) => csvDateTime(row.resolved_at), cell: (row) => (row.resolved_at ? formatDateTime(row.resolved_at) : '—') },
  { header: 'Details', value: (row) => row.details },
];

/**
 * A regulatory alert's status, which officers move; the server refuses a change made from a status that moved
 * meanwhile. Choosing a status sends nothing: arrow keys on a closed select fire a change for every step, so the
 * Save button sends the one chosen. Neither control is disabled while saving, so keyboard focus stays put.
 */
function FlagStatusSelect({ flag, onChanged }: { flag: RegulatoryFlag; onChanged: (flag: RegulatoryFlag) => void }) {
  const [chosen, setChosen] = useState<FlagStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = chosen ?? flag.status;

  async function save() {
    if (busy || value === flag.status) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await housingApi.setFlagStatus(flag.id, value, flag.status));
      setChosen(null);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The status was not saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-36 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Status of ${flag.title}`}
          value={value}
          aria-disabled={busy || undefined}
          onChange={(event) => { if (!busy) setChosen(event.target.value as FlagStatus); }}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong aria-disabled:opacity-60"
        >
          {FLAG_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={`Save the status of ${flag.title}`}
          aria-disabled={busy || value === flag.status || undefined}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

/** The database's red-flag events (read only) and the regulatory alerts officers track (GET /housing/red-flags). */
export default function HousingRedFlags() {
  const { loading, data, error, retry, replace } = useHousingData(housingApi.redFlags);

  const flagColumns: HousingColumn<RegulatoryFlag>[] = [
    { header: 'Alert', value: (row) => row.title },
    { header: 'Area', value: (row) => row.area },
    { header: 'Category', value: (row) => row.category },
    { header: 'Severity', value: (row) => row.severity.charAt(0).toUpperCase() + row.severity.slice(1) },
    { header: 'Reports', value: (row) => row.reports, numeric: true },
    { header: 'Threshold', value: (row) => row.threshold, numeric: true },
    { header: 'Raised', value: (row) => csvDateTime(row.raised_at), cell: (row) => formatDateTime(row.raised_at) },
    {
      header: 'Status',
      value: (row) => row.status,
      cell: (row) => (
        <FlagStatusSelect
          flag={row}
          onChanged={(changed) => replace((current) => ({ ...current, alerts: current.alerts.map((item) => (item.id === changed.id ? changed : item)) }))}
        />
      ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-8">
      <PageHeader
        title="Red-flag alerts"
        description={'Red-flag events are raised by TenantVoice itself when a home reaches a complaint threshold; they are shown as recorded. Regulatory alerts are the portal\'s own: move each one through New, Under review, Escalated and Closed.'}
      />
      <p className="text-sm text-text-body">
        Critical cases that admins referred with a case package are under{' '}
        <Link href="/housing/referrals" className="font-semibold text-primary-strong underline">Referrals</Link>.
      </p>
      {loading ? (
        <p role="status" className="text-sm text-text-body">Loading the red-flag alerts…</p>
      ) : !data ? (
        <LoadErrorCard title="Couldn't load the red-flag alerts" message={error ?? undefined} onRetry={retry} />
      ) : (
        <>
          <HousingTable
            title="Regulatory alerts"
            name="regulatory-alerts"
            columns={flagColumns}
            rows={data.alerts}
            rowKey={(row) => row.id}
            empty="There are no regulatory alerts."
          />
          <HousingTable
            title="Red-flag events"
            name="red-flag-events"
            description="Read only. A home's suburb and state are shown, never its street."
            columns={EVENT_COLUMNS}
            rows={data.events}
            rowKey={(row) => row.id}
            empty="No home has reached a red-flag threshold."
          />
        </>
      )}
    </div>
  );
}
