'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import { formatVisitLength, visitFormValues, visitProblem, type ProviderRepair, type RepairVisit } from '@/app/lib/provider-repairs';
import type { VerificationRequiredDetail } from '@/app/lib/verification-gate';

const LENGTHS = [30, 60, 90, 120, 180, 240, 480];
const fieldClass = 'mt-1.5 min-h-11 w-full rounded-[12px] border border-control-border bg-white px-3 py-2 text-sm text-text-dark outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const labelClass = 'block text-sm font-semibold text-text-dark';

type Props = {
  repair: ProviderRepair;
  busy: boolean;
  /** The problem the server gave for the last attempt, shown in the form. */
  error: string | null;
  /** A verification gate's refusal of the last attempt (R18), shown in its place. */
  gate?: VerificationRequiredDetail | null;
  /** Counts the server's refusals: each one moves focus to its message. */
  errorFocus: number;
  onSubmit: (visit: RepairVisit) => void;
  onCancel: () => void;
};

/**
 * Book or move a repair's visit, in Sydney time as the server books it. The
 * time is checked against the clock when the form is sent, not when it opened.
 */
export default function RepairVisitForm({ repair, busy, error, gate = null, errorFocus, onSubmit, onCancel }: Props) {
  const id = useId();
  const [initial] = useState(() => visitFormValues(repair));
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [length, setLength] = useState(initial.duration);
  const [note, setNote] = useState(initial.note);
  const [problem, setProblem] = useState<string | null>(null);
  const message = useRef<HTMLDivElement>(null);
  const lengths = LENGTHS.includes(length) ? LENGTHS : [...LENGTHS, length].sort((a, b) => a - b);
  const moving = repair.stage === 'scheduled';

  // The disabled button that was pressed has lost focus: the reason takes it.
  useEffect(() => {
    if (errorFocus) message.current?.focus();
  }, [errorFocus]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const reason = visitProblem(date, time, new Date());
    setProblem(reason);
    if (reason) {
      document.getElementById(`${id}-date`)?.focus();
      return;
    }
    onSubmit({ date, time, duration_minutes: length, note: note.trim() || null });
  }

  return (
    // Named for its repair, so its buttons are told apart from another card's open form.
    <form onSubmit={submit} noValidate aria-label={`Visit for ${repair.title}`} className="mt-4 rounded-xl border border-border bg-background p-4">
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-bold text-text-dark sm:col-span-3">{moving ? 'Move the visit' : 'Book the visit'} (Sydney time)</legend>
        <label className={labelClass}>
          Day
          <input id={`${id}-date`} type="date" required value={date} onChange={(event) => setDate(event.target.value)}
            aria-invalid={!!problem} aria-describedby={problem || error ? `${id}-error` : undefined} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Start time
          <input type="time" required step={300} value={time} onChange={(event) => setTime(event.target.value)}
            aria-invalid={!!problem} aria-describedby={problem || error ? `${id}-error` : undefined} className={fieldClass} />
        </label>
        <label className={labelClass}>
          About how long
          <select value={length} onChange={(event) => setLength(Number(event.target.value))} className={fieldClass}>
            {lengths.map((minutes) => <option key={minutes} value={minutes}>{formatVisitLength(minutes)}</option>)}
          </select>
        </label>
        <label className={`${labelClass} sm:col-span-3`}>
          Note for the tenant and owner (optional)
          <textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. I'll call 30 minutes before I arrive." className={fieldClass} />
        </label>
      </fieldset>
      <div ref={message} id={`${id}-error`} tabIndex={-1} className="mt-3">
        {gate && !problem ? <VerificationRequired detail={gate} /> : null}
        <FormMessage error={problem ?? error} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : moving ? 'Move visit' : 'Book visit'}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
