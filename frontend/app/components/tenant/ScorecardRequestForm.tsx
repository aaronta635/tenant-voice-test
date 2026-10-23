'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import { SCORECARD_ITEMS, recipientHold, scorecardHome, scorecards, type ScorecardRecipient, type ScorecardRequest } from '@/app/lib/scorecards';

type Props = {
  id: string;
  onSent: (created: ScorecardRequest) => void;
  onClose: () => void;
};

const keyOf = (recipient: ScorecardRecipient) => `${recipient.owner_id}:${recipient.property_id}`;

/**
 * Asking for a scorecard: the owners and agents the server says the tenant
 * may ask (a lease with them, or an application they approved), one per home,
 * and the questions they will answer. Someone already asked for a home waits
 * for their answer and cannot be asked again until then; one who completed
 * the scorecard for a home is not asked again, and one who declined, or was
 * asked and then cancelled, only after a wait (recipientHold).
 */
export default function ScorecardRequestForm({ id, onSent, onClose }: Props) {
  const [recipients, setRecipients] = useState<ScorecardRecipient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageBox = useRef<HTMLDivElement>(null);
  const firstChoice = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  useEffect(() => {
    let active = true;
    scorecards.recipients()
      .then((list) => { if (active) { setRecipients(list); setLoadError(null); } })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Could not find whom you can ask. Please try again.');
      });
    return () => { active = false; };
  }, [attempt]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || !recipients) return;
    const chosen = recipients.find((recipient) => keyOf(recipient) === choice);
    if (!chosen) {
      setError('Choose the owner or agent who should complete your scorecard.');
      firstChoice.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSent(await scorecards.request(chosen.owner_id, chosen.property_id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your request. Please try again.');
      messageBox.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const available = recipients?.filter((recipient) => !recipientHold(recipient)) ?? [];

  return (
    <form id={id} onSubmit={send} noValidate aria-label="Request a scorecard" className="mt-4 min-w-0 rounded-xl border border-border bg-background p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-strong">Scorecard they will complete</p>
      <p className="mt-1 text-sm font-semibold text-text-dark">Owner / Agent Tenant Scorecard</p>
      <details className="mt-2 text-sm text-text-body">
        <summary className="cursor-pointer font-medium text-primary-strong underline">Preview the questions</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {SCORECARD_ITEMS.map((item) => <li key={item.key}>{item.label}</li>)}
          <li>Optional comment</li>
        </ol>
        <p className="mt-2">Each one is rated from 1 to 5. You both read the result, and you choose whether it shows on your public profile.</p>
      </details>

      {loadError ? (
        <div className="mt-4 space-y-3">
          <p role="alert" className="text-sm text-danger">{loadError}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => { setLoadError(null); setRecipients(null); setAttempt((value) => value + 1); }}>
              Try again
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : !recipients ? (
        <p role="status" className="mt-4 text-sm text-text-body">Finding the owners and agents you can ask…</p>
      ) : recipients.length === 0 ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-text-body">
            There is nobody to ask yet. You can ask the owner or agent of a home you rent or rented through
            TenantVoice: once they approve your application, or your lease with them starts.
          </p>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      ) : (
        <>
          <fieldset className="mt-4 min-w-0">
            <legend className="text-sm font-semibold text-text-dark">Who should complete it?</legend>
            <div className="mt-2 space-y-2">
              {recipients.map((recipient, index) => {
                const hold = recipientHold(recipient);
                return (
                  <div key={keyOf(recipient)} className="flex min-w-0 items-start gap-3 rounded-lg border border-border bg-white p-3">
                    <input
                      ref={recipient === available[0] ? firstChoice : undefined}
                      id={`${fieldId}-${index}`}
                      type="radio"
                      name={`${fieldId}-recipient`}
                      value={keyOf(recipient)}
                      checked={choice === keyOf(recipient)}
                      disabled={busy || !!hold}
                      onChange={() => { setChoice(keyOf(recipient)); setError(null); }}
                      aria-describedby={`${fieldId}-${index}-detail`}
                      className="mt-1 size-4 shrink-0 accent-primary-strong"
                    />
                    <div className="min-w-0">
                      <label htmlFor={`${fieldId}-${index}`} className="block break-words text-sm font-medium text-text-dark">
                        {recipient.owner_name} · {recipient.owner_role_label}
                      </label>
                      <p id={`${fieldId}-${index}-detail`} className="break-words text-sm text-text-body">
                        {scorecardHome(recipient)} · {recipient.source === 'agreement' ? 'your lease' : 'your approved application'}
                        {hold ? <span className="block text-warning">{hold}</span> : null}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div ref={messageBox} tabIndex={-1} className="mt-3"><FormMessage error={error} /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || available.length === 0}>{busy ? 'Sending…' : 'Send request'}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          </div>
        </>
      )}
    </form>
  );
}
