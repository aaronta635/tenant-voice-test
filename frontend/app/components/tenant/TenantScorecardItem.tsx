'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import ScorecardResult from '@/app/components/scorecards/ScorecardResult';
import ScorecardStatusPill from '@/app/components/scorecards/ScorecardStatusPill';
import Button from '@/app/components/ui/Button';
import { buttonClassName } from '@/app/components/ui/button-styles';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import { formatScorecardAverage, scorecardDates, scorecardHome, type ScorecardRequest } from '@/app/lib/scorecards';

type Props = {
  request: ScorecardRequest;
  onCancel: () => Promise<ScorecardRequest>;
  onShowOnProfile: (visible: boolean) => Promise<ScorecardRequest>;
};

/**
 * One scorecard request on the tenant's dashboard. While it waits the tenant
 * may cancel it, after confirming; a completed one opens to the owner's
 * ratings and comment, with the switch that shows it on their public profile.
 */
export default function TenantScorecardItem({ request, onCancel, onShowOnProfile }: Props) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusNotice, setFocusNotice] = useState(0);
  const feedback = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);

  // The cancel buttons are gone once the request is cancelled: the message takes focus.
  useEffect(() => {
    if (focusNotice) feedback.current?.focus();
  }, [focusNotice]);
  useEffect(() => {
    if (confirming) keepButton.current?.focus();
  }, [confirming]);

  async function run(action: () => Promise<ScorecardRequest>, success: (saved: ScorecardRequest) => string, moveFocus: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await action();
      setConfirming(false);
      setNotice(success(saved));
      if (moveFocus) setFocusNotice((count) => count + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this change. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function keep() {
    setConfirming(false);
    requestAnimationFrame(() => cancelButton.current?.focus());
  }

  return (
    <li className="min-w-0 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-text-dark">{request.owner_name}</p>
          <p className="break-words text-sm text-text-body">{scorecardHome(request)}</p>
          <p className="mt-0.5 text-xs text-text-body">{scorecardDates(request)}</p>
        </div>
        <ScorecardStatusPill status={request.status} />
      </div>

      {request.status === 'pending' ? (
        confirming ? (
          <div role="group" aria-label="Cancel this request?" className="mt-3 rounded-xl border border-border bg-background p-3">
            <p className="text-sm text-text-dark">Cancel your request to {request.owner_name}? They will be told.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="destructive" size="sm" disabled={busy}
                onClick={() => void run(onCancel, () => `Request cancelled. ${request.owner_name} has been told.`, true)}>
                {busy ? 'Cancelling…' : 'Yes, cancel it'}
              </Button>
              <button ref={keepButton} type="button" disabled={busy} onClick={keep}
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-sm text-text-body">Waiting for {request.owner_name} to complete it.</p>
            <button ref={cancelButton} type="button" onClick={() => { setConfirming(true); setNotice(null); }}
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
              Cancel request<span className="sr-only"> to {request.owner_name}</span>
            </button>
          </div>
        )
      ) : request.status === 'completed' ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-sm font-semibold text-text-dark">Average: {formatScorecardAverage(request.average)}</p>
            <Button type="button" variant="secondary" size="sm" aria-expanded={showResult} aria-controls={`${id}-result`}
              onClick={() => setShowResult((shown) => !shown)}>
              {showResult ? 'Hide scorecard' : 'View scorecard'}<span className="sr-only"> from {request.owner_name}</span>
            </Button>
          </div>
          {showResult ? <ScorecardResult id={`${id}-result`} request={request} /> : null}
          <div className="mt-3 flex items-start gap-3">
            <input
              id={`${id}-visible`}
              type="checkbox"
              checked={request.visible_on_profile === true}
              disabled={busy}
              aria-describedby={`${id}-visible-hint`}
              onChange={(event) => {
                const visible = event.target.checked;
                void run(() => onShowOnProfile(visible), () => (
                  visible ? 'This scorecard now counts on your public profile.' : 'This scorecard is off your public profile.'
                ), false);
              }}
              className="mt-1 size-4 shrink-0 accent-primary-strong"
            />
            <div className="min-w-0">
              <label htmlFor={`${id}-visible`} className="block text-sm font-medium text-text-dark">Show on my public profile</label>
              <p id={`${id}-visible-hint`} className="text-sm text-text-body">
                Your public profile shows the average of the scorecards you choose, never who wrote them or what they
                said. It shows none while your profile is hidden or sharing your score is off
                in <Link href="/tenant/settings" className="font-medium text-primary-strong underline">your settings</Link>.
              </p>
            </div>
          </div>
        </div>
      ) : request.status === 'declined' ? (
        <p className="mt-3 break-words text-sm text-text-body">
          {request.owner_name} declined{request.reason ? `: “${request.reason}”` : '.'} You can ask again.
        </p>
      ) : (
        <p className="mt-3 text-sm text-text-body">You cancelled this request. You can ask again.</p>
      )}

      {/* Mounted from the start so its messages are read out, and out of the flow while empty. */}
      <div ref={feedback} tabIndex={-1} className={notice || error ? 'mt-2' : 'h-0 overflow-hidden'}>
        <FormMessage error={error} success={notice} />
      </div>
    </li>
  );
}
