'use client';

import { useId, useState, type FormEvent } from 'react';
import StatePill from '@/app/components/admin/StatePill';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import { ApiError } from '@/app/lib/api';
import { formatDate, formatDateTime } from '@/app/lib/format';
import {
  adminDatapointApi,
  REQUEST_NEXT,
  REQUEST_STATUS_LABELS,
  type DatapointRequest,
  type RequestDecision,
} from '@/app/lib/housing-api';
import { REQUEST_COLUMNS, REQUEST_TONES } from './HousingDataRequests';
import { CsvDownloadButton } from './HousingTable';
import { useHousingData } from './use-housing-data';

const DECISION_LABELS: Record<RequestDecision, string> = { accepted: 'Accept', declined: 'Decline', completed: 'Mark completed' };

/** An admin's answer: a decision the request's status allows, and a response the officer reads. */
function AnswerForm({ request, onAnswered }: { request: DatapointRequest; onAnswered: (request: DatapointRequest) => void }) {
  const id = useId();
  const options = REQUEST_NEXT[request.status] ?? [];
  const [decision, setDecision] = useState<RequestDecision>(options[0]);
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!response.trim()) {
      setError('Write a response. The officer reads it in the Housing Portal.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onAnswered(await adminDatapointApi.answer(request.id, decision, response.trim(), request.status));
      setResponse('');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The answer was not saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-decision`} className="text-xs font-semibold uppercase tracking-wide text-text-body">Decision</label>
          <select id={`${id}-decision`} value={decision} onChange={(event) => setDecision(event.target.value as RequestDecision)}
            className="min-h-11 w-full rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong">
            {options.map((option) => <option key={option} value={option}>{DECISION_LABELS[option]}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-response`} className="text-xs font-semibold uppercase tracking-wide text-text-body">Response to the officer</label>
          <textarea id={`${id}-response`} value={response} onChange={(event) => setResponse(event.target.value)} maxLength={1000} rows={2} required
            className="w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong" />
        </div>
      </div>
      <FormMessage error={error} />
      <div><Button type="submit" aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Send answer'}</Button></div>
    </form>
  );
}

/** Housing Portal officers' requests to change a datapoint, which admins answer (GET and PATCH /admin/datapoint-requests). */
export default function AdminDataRequests() {
  const { loading, data, error, retry, replace } = useHousingData(adminDatapointApi.list);
  const answered = (request: DatapointRequest) => replace((items) => items.map((item) => (item.id === request.id ? request : item)));

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Data category requests"
        description="Housing Portal officers ask for changes to the datapoints TenantVoice records, such as the maintenance categories. Answer each one; the officer reads your response in the portal."
        actions={data?.length ? <CsvDownloadButton name="data-category-requests" label="data category requests" columns={REQUEST_COLUMNS} rows={data} /> : null}
      />
      {loading ? (
        <p role="status" className="text-sm text-text-body">Loading the requests…</p>
      ) : !data ? (
        <LoadErrorCard title="Couldn't load the requests" message={error ?? undefined} onRetry={retry} />
      ) : data.length === 0 ? (
        <p className="text-sm text-text-body">No officer has asked for a change yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.map((request) => (
            <li key={request.id}>
              <Card className="flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-body">{request.datapoint_label}</p>
                    <h2 className="mt-1 break-words font-heading text-base font-semibold text-text-dark">{request.requested_change}</h2>
                  </div>
                  <StatePill tone={REQUEST_TONES[request.status] ?? 'neutral'}>{REQUEST_STATUS_LABELS[request.status] ?? request.status}</StatePill>
                </div>
                <p className="break-words text-sm text-text-body"><span className="font-semibold text-text-dark">Why: </span>{request.reason}</p>
                <p className="text-xs text-text-body">From {request.officer_name ?? 'a former officer'} on {formatDate(request.created_at)}</p>
                {request.admin_response ? (
                  <p className="break-words rounded-lg bg-background p-3 text-sm text-text-dark">
                    <span className="font-semibold">Response{request.responded_by_name ? ` from ${request.responded_by_name}` : ''} ({formatDateTime(request.responded_at)}): </span>
                    {request.admin_response}
                  </p>
                ) : null}
                {REQUEST_NEXT[request.status]?.length ? <AnswerForm key={request.status} request={request} onAnswered={answered} /> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
