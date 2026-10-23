'use client';

// Inspection records (R13): an inspection the owner schedules, such as a
// remote viewing or a routine inspection (mobile_inspections). The meeting
// link goes in the notes, which the attendee reads; the findings go in the
// history, which only the owner reads. The owner schedules, edits,
// completes and cancels them; an attendee reads the ones they are invited to.

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import StatusPill from '@/app/components/inspections/StatusPill';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import {
  inspectionTime,
  inspectionsApi,
  RECORD_NOTES_LIMIT,
  RECORD_TYPES,
  sydneyLocalOf,
  sydneyMinLocal,
  TIME_STEP_SECONDS,
  type InspectionAttendee,
  type InspectionRecord,
  type RecordInput,
} from '@/app/lib/inspections';

type Props = {
  mode: 'owner' | 'attendee';
  /** One listing's records, with the form to schedule one (owner); all of them without it. */
  propertyId?: string;
};

const card = 'min-w-0 rounded-2xl border border-border bg-white p-5';
type Loaded = { key: string; records: InspectionRecord[] };

export default function InspectionRecords({ mode, propertyId }: Props) {
  const key = `${mode}:${propertyId ?? 'all'}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attendees, setAttendees] = useState<InspectionAttendee[]>([]);
  const [attempt, setAttempt] = useState(0);
  const owner = mode === 'owner';

  useEffect(() => {
    let active = true;
    inspectionsApi.records(propertyId).then(
      (records) => { if (active) { setLoaded({ key, records }); setFailure(null); } },
      (err) => {
        if (active) setFailure({ key, message: err instanceof ApiError ? err.message : 'Inspections could not be loaded.' });
      },
    );
    return () => { active = false; };
  }, [propertyId, key, attempt]);

  useEffect(() => {
    if (!owner || !propertyId) return;
    let active = true;
    // Without the list the form still works, with no attendee to choose.
    inspectionsApi.attendees(propertyId).then((list) => { if (active) setAttendees(list); }, () => undefined);
    return () => { active = false; };
  }, [owner, propertyId]);

  const current = loaded?.key === key ? loaded.records : null;
  const failed = failure?.key === key ? failure : null;
  const reload = () => setAttempt((value) => value + 1);
  const heading = owner ? 'Scheduled inspections' : 'Inspections scheduled with you';

  return (
    <section aria-labelledby={`records-heading-${mode}`} className={card}>
      <h2 id={`records-heading-${mode}`} className="font-heading text-h4 font-semibold text-text-dark">{heading}</h2>
      <p className="mt-1 text-sm text-text-body">
        {owner
          ? 'Private viewings, remote inspections and routine or condition inspections. The attendee can read the notes, so put the meeting link and what to check there. Findings you add when you complete or cancel one stay with you.'
          : 'Inspections an owner scheduled with you, with any meeting link they added. Times are Sydney time.'}
      </p>
      {owner && propertyId ? (
        <RecordForm
          attendees={attendees}
          submitLabel="Schedule inspection"
          onSave={(input) => inspectionsApi.createRecord(propertyId, input)}
          onSaved={reload}
          // mobile_create_inspection tells the attendee only when there is one.
          done={(input) => (input.attendee_id ? 'Inspection scheduled. The attendee has been told.' : 'Inspection scheduled.')}
        />
      ) : null}
      {failed ? (
        <div className="mt-3 space-y-3">
          <p role="alert" className="text-sm text-danger">{failed.message}</p>
          <Button variant="secondary" size="sm" onClick={() => { setFailure(null); reload(); }}>Try again</Button>
        </div>
      ) : !current ? (
        <p role="status" className="mt-3 text-sm text-text-body">Loading inspections…</p>
      ) : current.length === 0 ? (
        <p className="mt-3 text-sm text-text-body">
          {owner ? 'Nothing scheduled yet.' : 'No owner has scheduled an inspection with you.'}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {current.map((record) => (
            <RecordRow key={record.id} record={record} owner={owner} showProperty={!propertyId}
              attendees={attendees} onChanged={reload} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecordRow({ record, owner, showProperty, attendees, onChanged }: {
  record: InspectionRecord;
  owner: boolean;
  showProperty: boolean;
  attendees: InspectionAttendee[];
  onChanged: () => void;
}) {
  const [panel, setPanel] = useState<'edit' | 'status' | null>(null);
  const scheduled = record.status === 'Scheduled';
  const last = record.history[record.history.length - 1];
  const href = owner ? `/owner/properties/${record.property_id}?tab=inspections` : `/tenant/properties/${record.property_id}`;
  // The attendee may not be among the applicants offered (one who withdrew).
  const choices = record.attendee_id && !attendees.some((person) => person.user_id === record.attendee_id)
    ? [...attendees, { user_id: record.attendee_id, name: record.attendee_name || 'Current attendee' }]
    : attendees;

  return (
    <li className="flex min-w-0 flex-col gap-2 py-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words font-semibold text-text-dark">{record.type} · {inspectionTime(record.scheduled_at)}</p>
        <StatusPill kind="record" status={record.status} />
      </div>
      {showProperty || !owner ? (
        <p className="break-words text-text-body">
          {/* A leased home's listing page is not public: an attendee gets its name, not a link to "not found". */}
          {owner || record.listed !== false ? (
            <Link href={href} className="font-semibold text-primary-strong underline">{record.property_title || 'Property'}</Link>
          ) : (
            <span className="font-semibold text-text-dark">{record.property_title || 'Property'}</span>
          )}
          {record.address ? ` · ${record.address}` : ''}
        </p>
      ) : null}
      {owner ? <p className="text-text-body">Attendee: {record.attendee_name || 'None'}</p> : null}
      {record.notes ? <p className="whitespace-pre-line break-words text-text-dark">{record.notes}</p> : null}
      {last && last.status !== 'Scheduled' && last.note ? (
        <p className="whitespace-pre-line break-words text-text-body">{last.status}: {last.note}</p>
      ) : null}
      {owner && scheduled ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" aria-expanded={panel === 'edit'} onClick={() => setPanel(panel === 'edit' ? null : 'edit')}>
            Edit
          </Button>
          <Button size="sm" variant="secondary" aria-expanded={panel === 'status'} onClick={() => setPanel(panel === 'status' ? null : 'status')}>
            Complete or cancel
          </Button>
        </div>
      ) : null}
      {panel === 'edit' ? (
        <RecordForm
          attendees={choices}
          initial={record}
          submitLabel="Save changes"
          onSave={(input) => inspectionsApi.updateRecord(record.id, input)}
          onSaved={() => { setPanel(null); onChanged(); }}
          done="Inspection updated."
        />
      ) : null}
      {panel === 'status' ? <StatusForm record={record} onSaved={() => { setPanel(null); onChanged(); }} /> : null}
    </li>
  );
}

function RecordForm({ attendees, initial, submitLabel, onSave, onSaved, done }: {
  attendees: InspectionAttendee[];
  initial?: InspectionRecord;
  submitLabel: string;
  onSave: (input: RecordInput) => Promise<unknown>;
  onSaved: () => void;
  /** The success message, or how to word it from what was sent. */
  done: string | ((input: RecordInput) => string);
}) {
  const prefix = initial ? `record-${initial.id}` : 'record-new';
  const [type, setType] = useState<string>(initial?.type ?? RECORD_TYPES[1]);
  const [when, setWhen] = useState(initial ? sydneyLocalOf(initial.scheduled_at) : '');
  const [attendee, setAttendee] = useState(initial?.attendee_id ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!when) {
      setError('Choose a date and time.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      // An unchanged time goes back as the instant it is, not as the minute typed: a time in the
      // repeated hour or with seconds would come back another instant and read as a reschedule.
      const unchanged = initial !== undefined && when === sydneyLocalOf(initial.scheduled_at);
      const input: RecordInput = {
        type, scheduled_at: unchanged ? initial.scheduled_at : when, attendee_id: attendee || null, notes: notes.trim() || null,
      };
      await onSave(input);
      setSuccess(typeof done === 'function' ? done(input) : done);
      if (!initial) {
        setWhen('');
        setNotes('');
        setAttendee('');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The inspection could not be saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    // noValidate: the database judges a time, so the browser never holds one back, such as a
    // mobile record's 10:03 when only its notes change.
    <form noValidate onSubmit={(event) => void save(event)}
      className="mt-4 grid min-w-0 gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
      <div className="min-w-0">
        <label htmlFor={`${prefix}-type`} className="block text-sm font-semibold text-text-dark">Type</label>
        <select id={`${prefix}-type`} value={type} onChange={(event) => setType(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3 text-sm text-text-dark">
          {RECORD_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <div className="min-w-0">
        <label htmlFor={`${prefix}-when`} className="block text-sm font-semibold text-text-dark">Date and time (Sydney time)</label>
        <input id={`${prefix}-when`} type="datetime-local" value={when} min={sydneyMinLocal()} step={TIME_STEP_SECONDS}
          onChange={(event) => setWhen(event.target.value)}
          className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-sm text-text-dark" />
      </div>
      <div className="min-w-0 sm:col-span-2">
        <label htmlFor={`${prefix}-attendee`} className="block text-sm font-semibold text-text-dark">
          Attendee <span className="font-normal text-text-body">(someone who applied; told by notification)</span>
        </label>
        <select id={`${prefix}-attendee`} value={attendee} onChange={(event) => setAttendee(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3 text-sm text-text-dark">
          <option value="">No attendee</option>
          {attendees.map((person) => <option key={person.user_id} value={person.user_id}>{person.name}</option>)}
        </select>
      </div>
      <div className="min-w-0 sm:col-span-2">
        <label htmlFor={`${prefix}-notes`} className="block text-sm font-semibold text-text-dark">
          Notes the attendee can read <span className="font-normal text-text-body">(meeting link, what to check)</span>
        </label>
        <textarea id={`${prefix}-notes`} value={notes} maxLength={RECORD_NOTES_LIMIT} rows={3}
          onChange={(event) => setNotes(event.target.value)}
          className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm text-text-dark" />
        <p className="text-xs text-text-body">{notes.length}/{RECORD_NOTES_LIMIT}</p>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        <FormMessage error={error} success={success} className="mt-2" />
      </div>
    </form>
  );
}

function StatusForm({ record, onSaved }: { record: InspectionRecord; onSaved: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cancelling cannot be undone and tells the attendee, so it asks first, as cancelling a time does.
  const [confirming, setConfirming] = useState(false);
  const noteId = `record-${record.id}-status-note`;

  async function save(status: 'Completed' | 'Cancelled') {
    setBusy(true);
    setError(null);
    try {
      await inspectionsApi.setRecordStatus(record.id, status, note.trim() || null);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The inspection could not be updated. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-border p-4">
      <div>
        <label htmlFor={noteId} className="block text-sm font-semibold text-text-dark">
          Findings or reason <span className="font-normal text-text-body">(optional; only you see this)</span>
        </label>
        <textarea id={noteId} value={note} rows={3} maxLength={1000} onChange={(event) => setNote(event.target.value)}
          className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm text-text-dark" />
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Cancel this inspection?">
          <p className="text-sm text-text-dark">
            Cancel this inspection? It cannot be undone{record.attendee_id ? ', and the attendee is told' : ''}.
          </p>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void save('Cancelled')}>
            {busy ? 'Cancelling…' : 'Yes, cancel it'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Keep it</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void save('Completed')}>Mark completed</Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirming(true)}>Cancel inspection</Button>
        </div>
      )}
      <FormMessage error={error} />
    </div>
  );
}
