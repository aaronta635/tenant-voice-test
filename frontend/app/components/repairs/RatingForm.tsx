'use client';

import { useId, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';

type Props = {
  /** "Confirm and rate" or "Rate this repair". */
  action: string;
  legend: string;
  onSubmit: (rating: number) => Promise<unknown>;
};

/** A rating of 1 to 5 for a repair, which the tenant gives when confirming it or after the owner resolved it. */
export default function RatingForm({ action, legend, onSubmit }: Props) {
  const id = useId();
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!rating) {
      setError('Choose a rating from 1 to 5.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(rating);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your rating. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={action} className="mt-4 rounded-xl border border-border bg-background p-4">
      {/* min-w-0: a fieldset is as wide as its content by default, and the legend repeats the repair's title. */}
      <fieldset disabled={busy} className="min-w-0">
        <legend id={`${id}-legend`} className="max-w-full text-sm font-semibold [overflow-wrap:anywhere] text-text-dark">{legend}</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-legend`} aria-describedby={`${id}-error`}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" aria-pressed={rating === value} aria-label={`${value} out of 5`}
              onClick={() => { setRating(value); setError(null); }}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-semibold focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong ${rating === value ? 'border-primary bg-[#eeeffd] text-primary-strong' : 'border-control-border bg-white text-text-dark'}`}>
              {value}
            </button>
          ))}
        </div>
      </fieldset>
      <div id={`${id}-error`} className="mt-3"><FormMessage error={error} /></div>
      <Button type="submit" className="mt-3" disabled={busy}>{busy ? 'Saving…' : action}</Button>
    </form>
  );
}
