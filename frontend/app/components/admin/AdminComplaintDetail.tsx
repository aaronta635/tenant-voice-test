'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import ComplaintStatePill from '@/app/components/admin/ComplaintStatePill';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import {
  adminComplaintsApi,
  complaintStatusLabel,
  SEVERITY_LABELS,
  statusAction,
  stepStatusLabel,
  type AdminComplaintDetail as Detail,
  type AdminComplaintStep,
  type Assignee,
  type ComplaintStatus,
  type Party,
} from '@/app/lib/admin-complaints-api';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDate, messageTimestamp } from '@/app/lib/format';

type Loaded = { attempt: number; complaint: Detail | null; error: string | null; missing: boolean };

const NOTE_REQUIRED = 'Write a note. Both parties see it with the new status.';
// A complaint lodged about a tenancy: the shared review function changes its status and tells the tenant.
const GENERAL_SOURCE = 'tenant_general_complaint';
const STALE = 'This complaint changed while you were looking at it, so nothing was saved. It has been reloaded: check it and try again.';

/**
 * One complaint (GET /admin/complaints/{id}): what was reported and answered,
 * its whole timeline, and the forms that change its status (with the note
 * both parties read) and hand it to an admin.
 */
export default function AdminComplaintDetail({ complaintId }: { complaintId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [assignees, setAssignees] = useState<Assignee[] | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const current = loaded?.attempt === attempt ? loaded : null;

  useEffect(() => {
    let active = true;
    adminComplaintsApi.get(complaintId).then(
      (complaint) => { if (active) setLoaded({ attempt, complaint, error: null, missing: false }); },
      (error) => {
        if (!active) return;
        setLoaded({
          attempt, complaint: null, missing: error instanceof ApiError && error.status === 404,
          error: error instanceof ApiError ? error.message : 'Please try again.',
        });
      },
    );
    return () => { active = false; };
  }, [attempt, complaintId]);

  useEffect(() => {
    let active = true;
    adminComplaintsApi.assignees().then(
      (people) => { if (active) setAssignees(people); },
      () => { if (active) setAssignees([]); },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => { if (message) focusResult(messageRef.current, pageRef.current); }, [message]);

  function saved(complaint: Detail, text: string) {
    setLoaded((previous) => (previous ? { ...previous, complaint } : previous));
    setMessage({ text, error: false });
  }

  function stale() {
    setMessage({ text: STALE, error: true });
    setAttempt((value) => value + 1);
  }

  // The last complaint shown stays while it reloads after a refused change.
  const complaint = current?.complaint ?? (loaded?.complaint && message?.error ? loaded.complaint : null);
  return (
    <div ref={pageRef} className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
      <Link href="/admin/complaints" className="text-sm font-semibold text-primary-strong underline">← All complaints</Link>
      {!complaint && !current ? (
        <p role="status" className="text-sm text-text-body">Loading the complaint…</p>
      ) : !complaint ? (
        current?.missing ? (
          <Card className="p-6">
            <h1 className="font-heading text-h3 font-semibold">Complaint not found</h1>
            <p className="mt-2 text-sm text-text-body">No complaint has this id. A repair is handled on the maintenance pages.</p>
          </Card>
        ) : (
          <LoadErrorCard title="Couldn't load the complaint" message={current?.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
        )
      ) : (
        <>
          <header className="min-w-0">
            <h1 className="break-words font-heading text-h2 font-semibold text-text-dark">{complaint.subject}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-body">
              <ComplaintStatePill complaint={complaint} />
              <span>{complaint.category_label}{complaint.category_active ? '' : ' (older category)'}</span>
              {complaint.severity ? <span>{SEVERITY_LABELS[complaint.severity] ?? complaint.severity} severity</span> : null}
              <span>Lodged {formatDate(complaint.lodged_at)}</span>
              {complaint.resolved_at ? <span>Finished {formatDate(complaint.resolved_at)}</span> : null}
            </p>
          </header>

          <div ref={messageRef} tabIndex={-1}>
            <FormMessage error={message?.error ? message.text : null} success={message && !message.error ? message.text : null} />
          </div>

          <Card className="p-5">
            <h2 className="font-heading text-h4 font-semibold text-text-dark">What was reported</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <PartyFact label="Lodged by" party={complaint.complainant} />
              <PartyFact label="About" party={complaint.against} />
              {complaint.property_title ? <Fact label="Property" value={complaint.property_title} /> : null}
            </dl>
            <p className="mt-4 whitespace-pre-wrap break-words text-sm text-text-dark">{complaint.description}</p>
            {complaint.evidence_urls.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {complaint.evidence_urls.map((url, index) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-primary-strong underline">
                      Evidence {index + 1}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {complaint.response ? (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-text-body">
                  Response{complaint.responded_at ? ` · ${formatDate(complaint.responded_at)}` : ''}
                </h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text-dark">{complaint.response}</p>
              </div>
            ) : null}
            {complaint.resolution_note ? (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-text-body">Outcome</h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text-dark">{complaint.resolution_note}</p>
              </div>
            ) : null}
          </Card>

          <Card className="p-5">
            <h2 className="font-heading text-h4 font-semibold text-text-dark">Status</h2>
            {complaint.transitions.length ? (
              <StatusForm
                key={`${complaint.status}-${complaint.timeline.length}`}
                complaint={complaint}
                onSaved={(updated) => saved(updated, `The complaint is now ${complaintStatusLabel(updated).toLowerCase()}. Both parties were told.`)}
                onStale={stale}
              />
            ) : (
              <p className="mt-2 text-sm text-text-body">
                {complaint.withdrawn
                  ? 'The person who lodged it withdrew this complaint, so its status no longer changes.'
                  : 'This status cannot change from here.'}
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-heading text-h4 font-semibold text-text-dark">Handled by</h2>
            <AssignmentForm
              key={complaint.assignee?.id ?? 'nobody'}
              complaint={complaint}
              assignees={assignees}
              onSaved={(updated) => saved(updated, updated.assignee
                ? `${updated.assignee.full_name ?? 'The admin'} now handles this complaint.`
                : 'Nobody handles this complaint now.')}
              onStale={stale}
            />
          </Card>

          <Card className="p-5">
            <h2 className="font-heading text-h4 font-semibold text-text-dark">Timeline</h2>
            <p className="mt-1 text-sm text-text-body">
              Both parties see these steps, except who handles the complaint.
            </p>
            <ol className="mt-3 space-y-3">
              {complaint.timeline.map((step) => (
                <li key={step.id} className="text-sm">
                  <p className="text-text-dark">
                    <span className="font-semibold">{describe(step)}</span>
                    <span className="text-text-body"> · <time dateTime={step.created_at}>{messageTimestamp(step.created_at)}</time></span>
                  </p>
                  {step.note ? <p className="mt-1 whitespace-pre-wrap break-words text-text-body">{step.note}</p> : null}
                  {step.source !== 'web' ? <p className="text-xs text-text-body">Recorded in another TenantVoice app</p> : null}
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </div>
  );
}

/** A step of the admin timeline in one sentence, naming who took it. */
function describe(step: AdminComplaintStep) {
  const who = step.actor?.full_name ?? 'Someone';
  switch (step.event_type) {
    case 'CREATED':
      return `${who} lodged it`;
    case 'UPDATED':
      return `${who} updated the details`;
    case 'RESPONDED':
      return `${who} responded`;
    case 'ASSIGNED':
      return step.assignee ? `${who} handed it to ${step.assignee.full_name ?? 'an admin'}` : `${who} unassigned it`;
    case 'STATUS_CHANGED': {
      const to = stepStatusLabel(step.to_status);
      const from = stepStatusLabel(step.from_status);
      return to ? `${who} moved it ${from ? `from ${from} ` : ''}to ${to}` : `${who} changed its status`;
    }
    default:
      return `${who}: ${(step.event_type ?? 'update').replace(/_/g, ' ').toLowerCase()}`;
  }
}

function StatusForm({ complaint, onSaved, onStale }: {
  complaint: Detail; onSaved: (complaint: Detail) => void; onStale: () => void;
}) {
  const id = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [next, setNext] = useState<ComplaintStatus>(complaint.transitions[0]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const missingNote = error === NOTE_REQUIRED;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!note.trim()) {
      setError(NOTE_REQUIRED);
      noteRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await adminComplaintsApi.setStatus(complaint, next, note));
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409) onStale();
      else setError(err instanceof ApiError ? err.message : 'The status was not changed. Please try again.');
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-status`} className="text-xs font-semibold uppercase tracking-wide text-text-body">New status</label>
        <select
          id={`${id}-status`}
          value={next}
          onChange={(event) => setNext(event.target.value as ComplaintStatus)}
          className="min-h-11 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong sm:max-w-xs"
        >
          {complaint.transitions.map((status) => (
            <option key={status} value={status}>{statusAction(complaint.status, status)}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-note`} className="text-xs font-semibold uppercase tracking-wide text-text-body">Note (required)</label>
        <textarea
          ref={noteRef}
          id={`${id}-note`}
          value={note}
          onChange={(event) => { setNote(event.target.value); if (missingNote) setError(null); }}
          maxLength={1200}
          rows={3}
          required
          aria-invalid={missingNote || undefined}
          aria-describedby={`${id}-note-help`}
          className="w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
        />
        <p id={`${id}-note-help`} className="text-xs text-text-body">
          {complaint.source === GENERAL_SOURCE
            ? 'Both parties see this note in the complaint\'s timeline. The tenant is told of the new status, as in the mobile app, and the other party in a notification. It is kept with your name and the time.'
            : 'Both parties see this note in the complaint\'s timeline and in a notification. It is kept with your name and the time.'}
        </p>
      </div>
      <FormMessage error={error} />
      <div>
        <Button type="submit" aria-disabled={busy || undefined}>{busy ? 'Saving…' : statusAction(complaint.status, next)}</Button>
      </div>
    </form>
  );
}

function AssignmentForm({ complaint, assignees, onSaved, onStale }: {
  complaint: Detail; assignees: Assignee[] | null; onSaved: (complaint: Detail) => void; onStale: () => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState(complaint.assignee?.id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const people = [...(assignees ?? [])];
  // Someone who handles it but is no longer an active admin stays choosable.
  if (complaint.assignee && !people.some((person) => person.id === complaint.assignee?.id)) {
    people.push({ id: complaint.assignee.id, full_name: complaint.assignee.full_name ?? 'An admin', email: null });
  }
  const unchanged = choice === (complaint.assignee?.id ?? '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || unchanged) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await adminComplaintsApi.assign(complaint.id, choice || null, note));
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409) onStale();
      else setError(err instanceof ApiError ? err.message : 'The complaint was not handed over. Please try again.');
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-4">
      <p className="text-sm text-text-body">
        {complaint.assignee ? `${complaint.assignee.full_name ?? 'An admin'} handles it now.` : 'Nobody handles it yet.'}
        {' '}Only TenantVoice staff see this.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={`${id}-admin`} className="text-xs font-semibold uppercase tracking-wide text-text-body">Admin</label>
          <select
            id={`${id}-admin`}
            value={choice}
            disabled={assignees === null}
            onChange={(event) => setChoice(event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
          >
            <option value="">{assignees === null ? 'Loading the admins…' : 'Nobody'}</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={`${id}-note`} className="text-xs font-semibold uppercase tracking-wide text-text-body">Note (optional)</label>
          <input
            id={`${id}-note`}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
          />
        </div>
      </div>
      <FormMessage error={error} />
      <div>
        <Button type="submit" variant="secondary" aria-disabled={busy || unchanged || undefined}>
          {busy ? 'Saving…' : choice ? 'Hand it over' : 'Unassign'}
        </Button>
      </div>
    </form>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-body">{label}</dt>
      <dd className="break-words font-semibold text-text-dark">{value}</dd>
    </div>
  );
}

function PartyFact({ label, party }: { label: string; party: Party | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-body">{label}</dt>
      <dd className="break-words font-semibold">
        {party ? (
          <Link href={`/admin/users/${encodeURIComponent(party.id)}`} className="text-primary-strong underline">
            {party.full_name ?? 'An account'}
          </Link>
        ) : (
          <span className="text-text-dark">A property</span>
        )}
      </dd>
    </div>
  );
}
