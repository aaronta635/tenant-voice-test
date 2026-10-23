'use client';

import { useId, useState, type FormEvent } from 'react';
import StatePill, { type PillTone } from '@/app/components/admin/StatePill';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import { ApiError } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';
import {
  DATAPOINTS,
  housingApi,
  REQUEST_STATUS_LABELS,
  type Datapoint,
  type DatapointRequest,
  type RequestStatus,
} from '@/app/lib/housing-api';
import HousingTable, { type HousingColumn } from './HousingTable';
import { useHousingData } from './use-housing-data';

const TEXT_LIMIT = 1000;

export const REQUEST_TONES: Record<RequestStatus, PillTone> = {
  pending: 'warning',
  accepted: 'info',
  declined: 'danger',
  completed: 'success',
};

export const REQUEST_COLUMNS: HousingColumn<DatapointRequest>[] = [
  { header: 'Sent', value: (row) => formatDate(row.created_at) },
  { header: 'Officer', value: (row) => row.officer_name },
  { header: 'Datapoint', value: (row) => row.datapoint_label },
  { header: 'Requested change', value: (row) => row.requested_change },
  { header: 'Reason', value: (row) => row.reason },
  {
    header: 'Status',
    value: (row) => REQUEST_STATUS_LABELS[row.status] ?? row.status,
    cell: (row) => <StatePill tone={REQUEST_TONES[row.status] ?? 'neutral'}>{REQUEST_STATUS_LABELS[row.status] ?? row.status}</StatePill>,
  },
  { header: 'Admin response', value: (row) => row.admin_response },
];

const fieldClass = 'w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong';
const labelClass = 'text-xs font-semibold uppercase tracking-wide text-text-body';

/** The request form: a datapoint, the change and why. */
function RequestForm({ onSent }: { onSent: (request: DatapointRequest) => string }) {
  const id = useId();
  const [datapoint, setDatapoint] = useState<Datapoint>('maintenance_categories');
  const [change, setChange] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: string | null; success: string | null }>({ error: null, success: null });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!change.trim() || !reason.trim()) {
      setMessage({ error: 'Say what should change and why.', success: null });
      return;
    }
    setBusy(true);
    setMessage({ error: null, success: null });
    try {
      const sent = await housingApi.requestDatapointChange({ datapoint, requested_change: change.trim(), reason: reason.trim() });
      setMessage({ error: null, success: onSent(sent) });
      setChange('');
      setReason('');
    } catch (error) {
      setMessage({ error: error instanceof ApiError ? error.message : 'The request was not sent. Please try again.', success: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-heading text-h4 font-semibold text-text-dark">Ask for a change</h2>
      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-datapoint`} className={labelClass}>Datapoint</label>
          <select id={`${id}-datapoint`} value={datapoint} onChange={(event) => setDatapoint(event.target.value as Datapoint)} className={`${fieldClass} min-h-11`}>
            {Object.entries(DATAPOINTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-change`} className={labelClass}>Requested change</label>
          <textarea id={`${id}-change`} value={change} onChange={(event) => setChange(event.target.value)} maxLength={TEXT_LIMIT} rows={3} required
            placeholder="For example: add Pest control as a maintenance category." className={fieldClass} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-reason`} className={labelClass}>Reason</label>
          <textarea id={`${id}-reason`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={TEXT_LIMIT} rows={3} required
            placeholder="What it would let officers see or report." className={fieldClass} />
        </div>
        <FormMessage error={message.error} success={message.success} />
        <div>
          <Button type="submit" aria-disabled={busy || undefined}>{busy ? 'Sending…' : 'Send request'}</Button>
        </div>
      </form>
    </Card>
  );
}

/** Officers ask the admins to change a datapoint, and read their answers (GET and POST /housing/datapoint-requests). */
export default function HousingDataRequests() {
  const { loading, data, error, retry, replace } = useHousingData(housingApi.datapointRequests);

  function sent(request: DatapointRequest): string {
    const known = data?.some((item) => item.id === request.id) ?? false;
    replace((items) => (items.some((item) => item.id === request.id) ? items : [request, ...items]));
    return known
      ? 'You already sent this request. It is still waiting for an admin.'
      : 'Request sent. The admins have been told, and their answer will show here.';
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-8">
      <PageHeader
        title="Data category requests"
        description="Ask the TenantVoice admins to change a datapoint the platform records, such as the maintenance or complaint categories. They answer each request here."
      />
      <RequestForm onSent={sent} />
      {loading ? (
        <p role="status" className="text-sm text-text-body">Loading the requests…</p>
      ) : !data ? (
        <LoadErrorCard title="Couldn't load the requests" message={error ?? undefined} onRetry={retry} />
      ) : (
        <HousingTable
          title="Requests"
          name="data-category-requests"
          description="Every officer's requests, newest first."
          columns={REQUEST_COLUMNS}
          rows={data}
          rowKey={(row) => row.id}
          empty="No requests yet."
        />
      )}
    </div>
  );
}
