'use client';

import { useEffect, useId, useRef, useState } from 'react';
import ScorecardRequestForm from '@/app/components/tenant/ScorecardRequestForm';
import TenantScorecardItem from '@/app/components/tenant/TenantScorecardItem';
import Button from '@/app/components/ui/Button';
import { buttonClassName } from '@/app/components/ui/button-styles';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import { scorecards, type ScorecardRequest } from '@/app/lib/scorecards';

/**
 * The tenant's scorecards on their dashboard (R43, backend
 * /me/scorecard-requests). "Request scorecard" asks the owner or agent of a
 * home they rent or rented to rate them on the Owner/Agent Tenant Scorecard;
 * the list shows each request pending, completed, declined or cancelled,
 * newest first. Notices about them link here (#scorecards).
 */
export default function TenantScorecards() {
  const headingId = useId();
  const formId = useId();
  const [requests, setRequests] = useState<ScorecardRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusNotice, setFocusNotice] = useState(0);
  const requestButton = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    scorecards.list()
      .then((list) => { if (active) { setRequests(list); setLoadError(null); } })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Could not load your scorecards. Please try again.');
      });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (focusNotice) feedback.current?.focus();
  }, [focusNotice]);

  function replace(saved: ScorecardRequest) {
    setRequests((list) => list?.map((item) => (item.id === saved.id ? saved : item)) ?? list);
    return saved;
  }

  function sent(created: ScorecardRequest) {
    setRequests((list) => [created, ...(list ?? [])]);
    setAsking(false);
    setNotice(`Request sent to ${created.owner_name}. You will be told when they answer.`);
    setFocusNotice((count) => count + 1);
  }

  function closeForm() {
    setAsking(false);
    requestAnimationFrame(() => requestButton.current?.focus());
  }

  return (
    <section id="scorecards" aria-labelledby={headingId} className="scroll-mt-24">
      <Card className="p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 sm:flex-1">
            <h2 id={headingId} className="font-heading text-lg font-semibold text-text-dark">Scorecards</h2>
            <p className="mt-1 text-sm text-text-body">
              Ask an owner or agent you rent or rented from to rate you as a tenant. You choose which completed scorecards show on your public profile.
            </p>
          </div>
          <button ref={requestButton} type="button" aria-expanded={asking} aria-controls={asking ? formId : undefined}
            onClick={() => { setAsking((open) => !open); setNotice(null); }}
            className={buttonClassName({ variant: asking ? 'secondary' : 'primary', className: 'shrink-0 self-start' })}>
            Request scorecard
          </button>
        </div>

        {asking ? <ScorecardRequestForm id={formId} onSent={sent} onClose={closeForm} /> : null}

        {/* Mounted from the start so its message is read out, and out of the flow while empty. */}
        <div ref={feedback} tabIndex={-1} className={notice ? 'mt-4' : 'h-0 overflow-hidden'}>
          <FormMessage success={notice} />
        </div>

        <div className="mt-5 border-t border-border pt-5">
          {loadError ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-danger">{loadError}</p>
              <Button type="button" variant="secondary" onClick={() => { setLoadError(null); setRequests(null); setAttempt((value) => value + 1); }}>
                Try again
              </Button>
            </div>
          ) : !requests ? (
            <p role="status" className="text-sm text-text-body">Loading your scorecards…</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-text-body">
              No scorecard requests yet. Once an owner approves your application, or your lease with them starts, you can ask them here.
            </p>
          ) : (
            <ul aria-label="Your scorecard requests" className="divide-y divide-border">
              {requests.map((request) => (
                <TenantScorecardItem
                  key={request.id}
                  request={request}
                  onCancel={() => scorecards.cancel(request.id).then(replace)}
                  onShowOnProfile={(visible) => scorecards.setVisible(request.id, visible).then(replace)}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>
    </section>
  );
}
