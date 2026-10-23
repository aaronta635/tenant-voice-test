'use client';

import { forwardRef, useEffect, useRef, type ReactNode } from 'react';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import type { ProviderRecommendation, ProviderRecommendationsResponse } from '@/app/lib/api';
import { initialsOf } from '@/app/lib/format';

const MATCH_LABELS = {
  strong: 'Strong profile match',
  possible: 'Possible match',
  explore: 'Worth exploring',
} as const;

type Props = {
  heading: string;
  intro: string;
  result: ProviderRecommendationsResponse | null;
  loading: boolean;
  busyId: string | null;
  /** The person last sent a request or a message; the outcome shows in their card. */
  actionId: string | null;
  actionError: string | null;
  actionNotice: string | null;
  /** Requests sent from this page: shown as pending, and no longer counted as new, without moving the card. */
  requestedIds: string[];
  emptyAction?: ReactNode;
  onConnect: (person: ProviderRecommendation) => void;
  onMessage: (person: ProviderRecommendation) => void;
};

/** Potential connections as cards, new people first. The heading takes focus after a search. */
const RecommendationResults = forwardRef<HTMLHeadingElement, Props>(function RecommendationResults(
  { heading, intro, result, loading, busyId, actionId, actionError, actionNotice, requestedIds, emptyAction, onConnect, onMessage },
  headingRef,
) {
  const feedback = useRef<HTMLDivElement>(null);

  // The busy button was disabled, so focus is lost: move it to the error beside that button,
  // unless the provider has moved on while waiting.
  useEffect(() => {
    const message = feedback.current;
    const active = document.activeElement;
    if (actionError && message && (!active || active === document.body || message.parentElement?.contains(active))) message.focus();
  }, [actionError]);

  const requested = new Set(requestedIds);
  const newPeople = result?.items.filter((person) => !person.connection_status) ?? [];
  const newCount = newPeople.filter((person) => !requested.has(person.id)).length;
  const groups = [
    { label: 'New potential connections', items: newPeople },
    { label: 'Existing and pending connections', items: result?.items.filter((person) => !!person.connection_status) ?? [] },
  ].filter((group) => group.items.length > 0);

  return (
    <section aria-labelledby="provider-matches-heading" aria-busy={loading}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 ref={headingRef} id="provider-matches-heading" tabIndex={-1} className="font-heading text-xl font-semibold text-text-dark focus:outline-none">{heading}</h2>
        <p className="text-sm text-text-body" role="status">
          {loading ? 'Finding matches…' : result ? `${newCount} new potential connection${newCount === 1 ? '' : 's'}` : ''}
        </p>
      </div>
      <p className="mb-5 text-sm leading-6 text-text-body">{intro}</p>

      {!result && loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {[1, 2, 3].map((id) => <Card key={id} className="h-64 animate-pulse border border-border p-5 motion-reduce:animate-none"><div className="mb-5 size-12 rounded-full bg-surface" /><div className="mb-3 h-4 w-2/3 rounded bg-surface" /><div className="h-3 w-full rounded bg-surface" /></Card>)}
        </div>
      ) : result?.items.length === 0 ? (
        <Card className="border border-border p-8 text-center">
          <h3 className="font-heading text-lg font-semibold text-text-dark">No matches for this search yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-body">Try a nearby suburb, a state, any area, or both landlords and tenants.</p>
          {emptyAction ? <div className="mt-5">{emptyAction}</div> : null}
        </Card>
      ) : result ? (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.label}>
              <h3 className="mb-3 text-lg font-semibold">{group.label}</h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((person) => {
                  // Every card keeps its live regions mounted: one inserted with its text is often not
                  // read out. Only the card acted on gets the messages, the margin and the focus.
                  // Until then the wrapper has zero height: it would keep the 8px margin that
                  // FormMessage's space-y-2 gives its empty alert, making every card taller.
                  const acted = actionId === person.id;
                  return <Card key={person.id} className="flex min-w-0 flex-col border border-border p-5">
                    <div className="mb-4 flex items-start gap-3">
                      <div aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface text-base font-semibold text-primary-strong">{initialsOf(person.full_name)}</div>
                      <div className="min-w-0">
                        <h4 className="break-words font-semibold text-text-dark">{person.full_name}</h4>
                        <p className="mt-0.5 text-sm text-text-body">{person.role === 'landlord' ? 'Landlord' : 'Tenant'}</p>
                        <p className="mt-1 break-words text-xs text-text-body">{[person.location, person.state].filter(Boolean).join(', ') || 'Location not listed'}</p>
                      </div>
                    </div>
                    <span className={`mb-4 self-start rounded-full px-3 py-1 text-xs font-semibold ${person.match_level === 'strong' ? 'bg-success/10 text-success' : 'bg-surface text-primary-strong'}`}>{MATCH_LABELS[person.match_level]}</span>
                    <div className="mb-5 flex-1">
                      <h5 className="text-xs font-semibold uppercase tracking-wide text-text-body">Why this profile</h5>
                      <ul className="mt-2 space-y-2 text-sm leading-6 text-text-body">
                        {person.reasons.map((reason, index) => <li key={`${person.id}-${index}`} className="flex gap-2"><span aria-hidden="true" className="text-primary-strong">&bull;</span><span>{reason}</span></li>)}
                      </ul>
                    </div>
                    {person.connection_status === 'accepted' ? (
                      <Button type="button" variant="secondary" fullWidth disabled={!!busyId || loading} aria-label={`Message connection ${person.full_name}`} onClick={() => onMessage(person)}>{busyId === person.id ? 'Opening conversation…' : 'Message connection'}</Button>
                    ) : person.connection_status === 'pending' || requested.has(person.id) ? (
                      <Button type="button" variant="secondary" fullWidth disabled>Connection pending</Button>
                    ) : (
                      <Button type="button" fullWidth disabled={!!busyId || loading} aria-label={`Connect with ${person.full_name}`} onClick={() => onConnect(person)}>{busyId === person.id ? 'Sending request…' : 'Connect'}</Button>
                    )}
                    <div ref={acted ? feedback : undefined} tabIndex={acted ? -1 : undefined} className={acted && (actionError || actionNotice) ? 'mt-3 scroll-mt-24' : 'h-0'}>
                      <FormMessage error={acted ? actionError : null} success={acted ? actionNotice : null} />
                    </div>
                  </Card>;
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
});

export default RecommendationResults;
