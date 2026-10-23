'use client';

import { useEffect, useState } from 'react';
import OwnerScorecardCard from '@/app/components/owner/OwnerScorecardCard';
import Card from '@/app/components/ui/Card';
import FilterChip from '@/app/components/ui/FilterChip';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import { ApiError } from '@/app/lib/api';
import { scorecards, type ScorecardRequest } from '@/app/lib/scorecards';

type Filter = 'waiting' | 'answered';

/**
 * The scorecard requests an owner or agent received (backend
 * /me/scorecard-requests, R43): tenants who rent or rented one of their homes
 * ask to be rated on the Owner/Agent Tenant Scorecard. Waiting ones first; an
 * answer given here stays in view, with its message, until the filter changes.
 */
export default function OwnerScorecards() {
  const [requests, setRequests] = useState<ScorecardRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>('waiting');
  const [kept, setKept] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    scorecards.list()
      .then((list) => { if (active) { setRequests(list); setLoadError(null); } })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Could not load your scorecard requests. Please try again.');
      });
    return () => { active = false; };
  }, [attempt]);

  function replace(saved: ScorecardRequest) {
    setRequests((list) => list?.map((item) => (item.id === saved.id ? saved : item)) ?? list);
    setKept((ids) => (ids.includes(saved.id) ? ids : [...ids, saved.id]));
    return saved;
  }

  function show(next: Filter) {
    setFilter(next);
    setKept([]);
  }

  const waiting = requests?.filter((item) => item.status === 'pending') ?? [];
  const answered = requests?.filter((item) => item.status !== 'pending') ?? [];
  const shown = requests?.filter((item) => (item.status === 'pending') === (filter === 'waiting') || kept.includes(item.id)) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scorecards"
        description={`Tenants who rent or rented one of your homes can ask you for a scorecard: rate them from 1 to 5 on seven items, or decline. They read your answer and choose whether it shows on their public profile.${waiting.length ? ` ${waiting.length} waiting for your answer.` : ''}`}
      />

      {loadError ? (
        <LoadErrorCard
          title="Scorecard requests could not be loaded"
          message={loadError}
          onRetry={() => { setLoadError(null); setRequests(null); setAttempt((value) => value + 1); }}
        />
      ) : !requests ? (
        <p role="status" className="text-sm text-text-body">Loading your scorecard requests…</p>
      ) : requests.length === 0 ? (
        <Card className="p-8 text-center">
          <h2 className="font-heading text-lg font-semibold text-text-dark">No scorecard requests yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-body">
            When a tenant of one of your homes asks you for a scorecard, it appears here and you are notified.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show scorecard requests">
            <FilterChip selected={filter === 'waiting'} onClick={() => show('waiting')}>To complete ({waiting.length})</FilterChip>
            <FilterChip selected={filter === 'answered'} onClick={() => show('answered')}>Answered and cancelled ({answered.length})</FilterChip>
          </div>
          {shown.length === 0 ? (
            <Card className="p-8 text-center">
              <h2 className="font-heading text-lg font-semibold text-text-dark">
                {filter === 'waiting' ? 'Nothing to complete' : 'Nothing answered yet'}
              </h2>
              <p className="mt-2 text-sm text-text-body">
                {filter === 'waiting' ? 'You have answered every request.' : 'Scorecards you complete or decline appear here.'}
              </p>
            </Card>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-2">
              {shown.map((request) => (
                <OwnerScorecardCard
                  key={request.id}
                  request={request}
                  onSubmit={(answers, comment) => scorecards.submit(request.id, answers, comment).then(replace)}
                  onDecline={(reason) => scorecards.decline(request.id, reason).then(replace)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
