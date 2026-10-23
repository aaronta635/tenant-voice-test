'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import {
  COMMENT_LENGTH,
  RATINGS,
  SCORECARD_ITEMS,
  unratedItems,
  type ScorecardAnswers,
  type ScorecardItemKey,
} from '@/app/lib/scorecards';

const fieldClass = 'mt-1.5 w-full rounded-[12px] border border-control-border bg-white px-3 py-2 text-sm font-normal text-text-dark outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
// The radio itself is visually hidden; the box after it shows its state and its focus.
const ratingClass = [
  'flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg border border-control-border bg-white text-sm font-semibold text-text-dark',
  'peer-checked:border-primary-strong peer-checked:bg-primary-strong peer-checked:text-white',
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-strong',
  'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
].join(' ');

type Props = {
  tenantName: string;
  busy: boolean;
  /** Why the server refused the last submit, or null. */
  error: string | null;
  /** Bumped by the caller when error should take focus. */
  errorFocus: number;
  onSubmit: (answers: ScorecardAnswers, comment: string | null) => void;
  onCancel: () => void;
};

/**
 * The owner's Owner/Agent Tenant Scorecard: a rating from 1 to 5 for each of
 * the seven items, a radio group each, and an optional comment. Nothing is
 * sent until every item is rated: the first one missing takes focus, and each
 * one missing says so in its group's name until it is rated.
 */
export default function ScorecardForm({ tenantName, busy, error, errorFocus, onSubmit, onCancel }: Props) {
  const id = useId();
  const [ratings, setRatings] = useState<Partial<Record<ScorecardItemKey, number>>>({});
  const [comment, setComment] = useState('');
  const [tried, setTried] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const messageBox = useRef<HTMLDivElement>(null);
  const firstChoice = useRef<Partial<Record<ScorecardItemKey, HTMLInputElement | null>>>({});
  const unrated = unratedItems(ratings);
  const flagged = new Set(tried ? unrated : []);
  const problem = flagged.size
    ? `Rate every item from 1 to 5: ${flagged.size === 1 ? '1 still needs' : `${flagged.size} still need`} a rating.`
    : null;

  // The button that opened the form is gone: the form takes focus, named for the tenant.
  useEffect(() => {
    form.current?.focus();
  }, []);
  useEffect(() => {
    if (errorFocus) messageBox.current?.focus();
  }, [errorFocus]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setTried(true);
    if (unrated.length) {
      firstChoice.current[unrated[0]]?.focus();
      return;
    }
    onSubmit(ratings as ScorecardAnswers, comment.trim() || null);
  }

  return (
    <form ref={form} tabIndex={-1} onSubmit={submit} noValidate aria-label={`Scorecard for ${tenantName}`}
      className="mt-4 min-w-0 rounded-xl border border-border bg-background p-4">
      <p className="text-sm text-text-body">
        Rate each item from 1 (poor) to 5 (excellent). {tenantName} reads every rating and your comment, and they cannot be changed once sent.
      </p>
      <div className="mt-4 space-y-4">
        {SCORECARD_ITEMS.map((item, index) => (
          <fieldset key={item.key} className="min-w-0">
            <legend className="text-sm font-semibold text-text-dark">
              <span aria-hidden>{index + 1}. </span>{item.label}
              {flagged.has(item.key) ? <span className="ml-2 font-normal text-danger">Needs a rating</span> : null}
            </legend>
            {/* Five equal columns: one row from a phone's width up. */}
            <div className="mt-2 grid max-w-xs grid-cols-5 gap-1.5">
              {RATINGS.map((value) => (
                <label key={value}>
                  <input
                    ref={value === RATINGS[0] ? (element) => { firstChoice.current[item.key] = element; } : undefined}
                    type="radio"
                    name={`${id}-${item.key}`}
                    value={value}
                    checked={ratings[item.key] === value}
                    disabled={busy}
                    onChange={() => setRatings((current) => ({ ...current, [item.key]: value }))}
                    className="peer sr-only"
                  />
                  <span className={ratingClass}>
                    {value}<span className="sr-only"> out of 5</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <label className="mt-4 block text-sm font-semibold text-text-dark">
        Comment (optional)
        <textarea
          rows={3}
          maxLength={COMMENT_LENGTH}
          value={comment}
          disabled={busy}
          onChange={(event) => setComment(event.target.value)}
          placeholder="e.g. Always paid on time and left the garden tidy."
          className={fieldClass}
        />
      </label>
      <div ref={messageBox} tabIndex={-1} className="mt-3">
        <FormMessage error={problem ?? error} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Submit scorecard'}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
