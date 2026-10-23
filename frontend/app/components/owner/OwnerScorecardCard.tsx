'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import ScorecardForm from '@/app/components/scorecards/ScorecardForm';
import ScorecardResult from '@/app/components/scorecards/ScorecardResult';
import ScorecardStatusPill from '@/app/components/scorecards/ScorecardStatusPill';
import Button from '@/app/components/ui/Button';
import { buttonClassName } from '@/app/components/ui/button-styles';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import {
  formatScorecardAverage,
  REASON_LENGTH,
  scorecardDates,
  scorecardHome,
  type ScorecardAnswers,
  type ScorecardRequest,
} from '@/app/lib/scorecards';

const fieldClass = 'mt-1.5 w-full rounded-[12px] border border-control-border bg-white px-3 py-2 text-sm font-normal text-text-dark outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

type Props = {
  request: ScorecardRequest;
  onSubmit: (answers: ScorecardAnswers, comment: string | null) => Promise<ScorecardRequest>;
  onDecline: (reason: string | null) => Promise<ScorecardRequest>;
};

/**
 * One scorecard request an owner or agent received (R43). While it waits the
 * owner completes the scorecard or declines, with a reason the tenant reads
 * if they give one; either is final, and the tenant is told. A completed one
 * opens to what the owner sent.
 */
export default function OwnerScorecardCard({ request, onSubmit, onDecline }: Props) {
  const id = useId();
  const [open, setOpen] = useState<'scorecard' | 'decline' | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorFocus, setErrorFocus] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusNotice, setFocusNotice] = useState(0);
  const [reason, setReason] = useState('');
  const feedback = useRef<HTMLDivElement>(null);
  const declineError = useRef<HTMLDivElement>(null);
  const openers = useRef<Record<'scorecard' | 'decline', HTMLButtonElement | null>>({ scorecard: null, decline: null });

  // The form that held focus is gone once its answer is saved: the result takes it.
  useEffect(() => {
    if (focusNotice) feedback.current?.focus();
  }, [focusNotice]);
  useEffect(() => {
    if (errorFocus && open === 'decline') declineError.current?.focus();
  }, [errorFocus, open]);

  function show(action: 'scorecard' | 'decline') {
    setOpen(action);
    setError(null);
    setNotice(null);
    setErrorFocus(0);
  }

  function close() {
    const closing = open;
    setOpen(null);
    setError(null);
    // The button that opened the form is back once it closes: focus returns to it.
    requestAnimationFrame(() => (closing ? openers.current[closing]?.focus() : undefined));
  }

  async function run(action: () => Promise<ScorecardRequest>, success: (saved: ScorecardRequest) => string) {
    setBusy(true);
    setError(null);
    try {
      const saved = await action();
      setOpen(null);
      setNotice(success(saved));
      setFocusNotice((count) => count + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your answer. Please try again.');
      setErrorFocus((count) => count + 1);
    } finally {
      setBusy(false);
    }
  }

  function submitScorecard(answers: ScorecardAnswers, comment: string | null) {
    void run(() => onSubmit(answers, comment), (saved) => (
      `Scorecard sent: ${formatScorecardAverage(saved.average)}. ${request.tenant_name} has been told.`
    ));
  }

  function decline(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    void run(() => onDecline(reason.trim() || null), () => `Request declined. ${request.tenant_name} has been told.`);
  }

  return (
    <Card className="min-w-0 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-heading text-lg font-semibold text-text-dark">{request.tenant_name}</h2>
          <p className="mt-1 break-words text-sm text-text-body">{scorecardHome(request)}</p>
          <p className="mt-1 text-xs text-text-body">{scorecardDates(request)}</p>
        </div>
        <ScorecardStatusPill status={request.status} />
      </div>

      {request.status === 'pending' && open === null ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button ref={(element) => { openers.current.scorecard = element; }} type="button" className={buttonClassName({})}
            onClick={() => show('scorecard')}>
            Complete scorecard<span className="sr-only"> for {request.tenant_name}</span>
          </button>
          <button ref={(element) => { openers.current.decline = element; }} type="button"
            className={buttonClassName({ variant: 'secondary' })} onClick={() => show('decline')}>
            Decline<span className="sr-only"> the request from {request.tenant_name}</span>
          </button>
        </div>
      ) : null}

      {open === 'scorecard' ? (
        <ScorecardForm
          tenantName={request.tenant_name}
          busy={busy}
          error={error}
          errorFocus={errorFocus}
          onSubmit={submitScorecard}
          onCancel={close}
        />
      ) : open === 'decline' ? (
        <form onSubmit={decline} noValidate aria-label={`Decline the request from ${request.tenant_name}`} className="mt-4 rounded-xl border border-border bg-background p-4">
          <label className="block text-sm font-semibold text-text-dark">
            Tell {request.tenant_name} why (optional)
            <textarea
              autoFocus
              rows={2}
              maxLength={REASON_LENGTH}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. I only managed the building, not your lease."
              className={fieldClass}
            />
          </label>
          <div ref={declineError} tabIndex={-1} className="mt-3"><FormMessage error={error} /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={busy}>{busy ? 'Declining…' : 'Decline request'}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>Keep it</Button>
          </div>
        </form>
      ) : null}

      {request.status === 'completed' ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-sm font-semibold text-text-dark">Average: {formatScorecardAverage(request.average)}</p>
            <Button type="button" variant="secondary" size="sm" aria-expanded={showResult} aria-controls={`${id}-result`}
              onClick={() => setShowResult((shown) => !shown)}>
              {showResult ? 'Hide the scorecard you sent' : 'View the scorecard you sent'}
            </Button>
          </div>
          {showResult ? <ScorecardResult id={`${id}-result`} request={request} /> : null}
        </div>
      ) : request.status === 'declined' ? (
        <p className="mt-4 break-words text-sm text-text-body">
          You declined this request{request.reason ? `: “${request.reason}”` : '.'}
        </p>
      ) : request.status === 'cancelled' ? (
        <p className="mt-4 text-sm text-text-body">{request.tenant_name} cancelled this request. There is nothing to complete.</p>
      ) : null}

      {/* Mounted from the start so its message is read out, and out of the flow while empty. */}
      <div ref={feedback} tabIndex={-1} className={notice ? 'mt-3 scroll-mt-24' : 'h-0 overflow-hidden'}>
        <FormMessage success={notice} />
      </div>
    </Card>
  );
}
