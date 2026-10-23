'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import RepairVisitForm from '@/app/components/provider/RepairVisitForm';
import { ApiError } from '@/app/lib/api';
import { verificationRequired, type VerificationRequiredDetail } from '@/app/lib/verification-gate';
import { formatDate, formatDateTime } from '@/app/lib/format';
import {
  formatVisitLength,
  PRIORITY_LABELS,
  repairCategoryLabel,
  STAGE_LABELS,
  visitHasStarted,
  type ProviderRepair,
  type RepairStage,
  type RepairVisit,
} from '@/app/lib/provider-repairs';

const STAGE_STYLES: Record<RepairStage, string> = {
  assigned: 'bg-surface text-primary-strong',
  scheduled: 'bg-[#fff4e5] text-warning',
  completed: 'bg-[#e6f4ed] text-success',
  cancelled: 'bg-[#f4f4f8] text-text-body',
};
const fieldClass = 'mt-1.5 w-full rounded-[12px] border border-control-border bg-white px-3 py-2 text-sm text-text-dark outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

type Props = {
  repair: ProviderRepair;
  /** The clock the card judges "has the visit started" by; the page moves it on. */
  now: Date;
  onSchedule: (visit: RepairVisit) => Promise<ProviderRepair>;
  onComplete: (note: string) => Promise<ProviderRepair>;
};

/**
 * One repair an owner assigned to the provider. The visit is booked first;
 * the job can be marked done once the visit has started. The street, access
 * notes and tenant come with the booked visit. Booking the first visit takes
 * the job on, which needs a verified provider (R18): the server's refusal
 * shows as VerificationRequired in the visit form.
 */
export default function RepairCard({ repair, now, onSchedule, onComplete }: Props) {
  const id = useId();
  const [open, setOpen] = useState<'visit' | 'done' | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [gate, setGate] = useState<VerificationRequiredDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const feedback = useRef<HTMLDivElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const doneError = useRef<HTMLDivElement>(null);
  const [focusFeedback, setFocusFeedback] = useState(0);
  const [errorFocus, setErrorFocus] = useState(0);
  const started = visitHasStarted(repair, now);
  const place = [repair.suburb, repair.state].filter(Boolean).join(', ');

  // The form that held focus is gone once an action saves: the result takes it.
  useEffect(() => {
    if (focusFeedback) feedback.current?.focus();
  }, [focusFeedback]);
  // So does the server's reason for refusing it; the visit form moves its own.
  useEffect(() => {
    if (errorFocus && open === 'done') doneError.current?.focus();
  }, [errorFocus, open]);

  function show(action: 'visit' | 'done') {
    setOpen(action);
    setFormError(null);
    setGate(null);
    setNotice(null);
    // A refusal shown in an earlier form must not pull focus into this one.
    setErrorFocus(0);
  }

  async function run(action: () => Promise<ProviderRepair>, success: (saved: ProviderRepair) => string) {
    setBusy(true);
    setFormError(null);
    setGate(null);
    try {
      const saved = await action();
      setOpen(null);
      setNote('');
      setNotice(success(saved));
      setFocusFeedback((count) => count + 1);
    } catch (err) {
      const refusal = verificationRequired(err);
      if (refusal) setGate(refusal);
      else setFormError(err instanceof ApiError ? err.message : 'Could not save this repair. Please try again.');
      setErrorFocus((count) => count + 1);
    } finally {
      setBusy(false);
    }
  }

  function book(visit: RepairVisit) {
    void run(() => onSchedule(visit), (saved) => `Visit ${repair.stage === 'scheduled' ? 'moved to' : 'booked for'} ${formatDateTime(saved.appointment_at)}. The tenant and the owner have been told.`);
  }

  function markDone(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (note.trim().length < 3) {
      setFormError('Say what you did, in a few words, for the tenant and the owner.');
      noteField.current?.focus();
      return;
    }
    // The clock again, at the moment of sending: the page's may be a minute old.
    if (!visitHasStarted(repair, new Date())) {
      setFormError('This repair cannot be marked done before its visit.');
      return;
    }
    void run(() => onComplete(note.trim()), () => 'Repair marked done. The tenant and the owner have been told, and the tenant confirms it next.');
  }

  return (
    <Card className="min-w-0 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-heading text-lg font-semibold text-text-dark">{repair.title}</h2>
          <p className="mt-1 text-sm text-text-body">
            {repair.category_label ?? repairCategoryLabel(repair.category)} · {PRIORITY_LABELS[repair.priority] ?? 'Medium priority'}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${STAGE_STYLES[repair.stage]}`}>{STAGE_LABELS[repair.stage]}</span>
      </div>

      <p className="mt-3 whitespace-pre-line break-words text-sm text-text-dark">{repair.description}</p>

      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-semibold text-text-dark">Where</dt>
          <dd className="break-words text-text-body">
            {repair.address ?? (place || 'Area not given')}
            {repair.property_title ? <span className="block">{repair.property_title}</span> : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-text-dark">Assigned by</dt>
          <dd className="break-words text-text-body">{repair.owner_name ?? 'The property owner'}</dd>
        </div>
        {repair.appointment_at ? (
          <div className="min-w-0">
            <dt className="font-semibold text-text-dark">Visit</dt>
            <dd className="text-text-body">
              {formatDateTime(repair.appointment_at)}
              {repair.estimated_duration_minutes ? ` · about ${formatVisitLength(repair.estimated_duration_minutes)}` : ''}
            </dd>
          </div>
        ) : null}
        {repair.tenant_name ? (
          <div className="min-w-0">
            <dt className="font-semibold text-text-dark">Tenant</dt>
            <dd className="break-words text-text-body">{repair.tenant_name}</dd>
          </div>
        ) : null}
        {repair.access_notes ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="font-semibold text-text-dark">Access</dt>
            <dd className="whitespace-pre-line break-words text-text-body">{repair.access_notes}</dd>
          </div>
        ) : null}
        {repair.appointment_note ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="font-semibold text-text-dark">Your visit note</dt>
            <dd className="whitespace-pre-line break-words text-text-body">{repair.appointment_note}</dd>
          </div>
        ) : null}
        {repair.stage === 'completed' ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="font-semibold text-text-dark">Done {repair.completed_at ? formatDate(repair.completed_at) : ''}</dt>
            <dd className="whitespace-pre-line break-words text-text-body">{repair.completion_note ?? 'No note was left.'}</dd>
          </div>
        ) : null}
      </dl>

      {repair.status === 'awaiting_confirmation' ? (
        <p className="mt-4 text-sm text-text-body">Waiting for the tenant to confirm the work.</p>
      ) : repair.stage === 'completed' && repair.tenant_rating ? (
        <p className="mt-4 text-sm text-text-body">The tenant rated the work {repair.tenant_rating} out of 5.</p>
      ) : null}

      {repair.stage === 'assigned' ? (
        <p className="mt-4 text-sm text-text-body">The street address, access notes and tenant appear here once you book the visit.</p>
      ) : null}

      {open === 'visit' ? (
        <RepairVisitForm repair={repair} busy={busy} error={formError} gate={gate} errorFocus={errorFocus} onSubmit={book} onCancel={() => { setOpen(null); setFormError(null); setGate(null); }} />
      ) : open === 'done' ? (
        <form onSubmit={markDone} noValidate aria-label={`Mark ${repair.title} done`} className="mt-4 rounded-xl border border-border bg-background p-4">
          <label className="block text-sm font-semibold text-text-dark">
            What did you do?
            <textarea ref={noteField} autoFocus rows={3} maxLength={2000} value={note} disabled={busy}
              onChange={(event) => setNote(event.target.value)} aria-invalid={!!formError} aria-describedby={`${id}-done-error`}
              placeholder="e.g. Replaced the burst pipe under the sink and tested for leaks." className={fieldClass} />
          </label>
          <div ref={doneError} id={`${id}-done-error`} tabIndex={-1} className="mt-3"><FormMessage error={formError} /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save as done'}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { setOpen(null); setFormError(null); }}>Cancel</Button>
          </div>
        </form>
      ) : repair.stage === 'assigned' || repair.stage === 'scheduled' ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant={repair.stage === 'assigned' ? 'primary' : 'secondary'} onClick={() => show('visit')}
            aria-label={`${repair.stage === 'scheduled' ? 'Move visit' : 'Book visit'} for ${repair.title}`}>
            {repair.stage === 'scheduled' ? 'Move visit' : 'Book visit'}
          </Button>
          {repair.stage === 'scheduled' ? (
            <>
              {/* Named "Mark done: <title>", so a voice command saying what it reads finds it. */}
              <Button type="button" disabled={!started} onClick={() => show('done')}
                aria-describedby={started ? undefined : `${id}-wait`}>
                Mark done<span className="sr-only">: {repair.title}</span>
              </Button>
              {!started ? <p id={`${id}-wait`} className="text-sm text-text-body">You can mark it done once the visit starts.</p> : null}
            </>
          ) : null}
        </div>
      ) : null}

      {/* Mounted from the start so its message is read out, and out of the flow while empty. */}
      <div ref={feedback} tabIndex={-1} className={notice ? 'mt-3 scroll-mt-24' : 'h-0 overflow-hidden'}>
        <FormMessage success={notice} />
      </div>
    </Card>
  );
}
