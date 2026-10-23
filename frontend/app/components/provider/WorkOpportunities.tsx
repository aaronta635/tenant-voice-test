'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import EmptyState from '@/app/components/ui/EmptyState';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import OpportunityCard from '@/app/components/provider/OpportunityCard';
import { ApiError } from '@/app/lib/api';
import { areaList, workOpportunities, type WorkOpportunities as Opportunities } from '@/app/lib/work-opportunities';

const NOTE = 'Each owner is here for what their public profile and listings show, not for a confirmed need for your services. Connect first to learn what they need.';

/**
 * Owners and landlords in the areas the provider serves, ranked by the
 * server: listings in those areas first, then owners based there, then the
 * provider's states, and within each by rating, verification and listings.
 */
export default function WorkOpportunities({ nav }: { nav?: ReactNode }) {
  const [result, setResult] = useState<Opportunities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noProvider, setNoProvider] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    workOpportunities()
      .then((data) => { if (active) setResult(data); })
      .catch((err: unknown) => {
        if (!active) return;
        // Before onboarding step 1 there is no provider profile to match on.
        if (err instanceof ApiError && err.status === 404) setNoProvider(true);
        else setError(err instanceof ApiError ? err.message : 'Could not load work opportunities. Please try again.');
      });
    return () => { active = false; };
  }, [attempt]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Recommendations" description="Owners and landlords in the areas you serve, closest first, then by their rating, verification and listings." />
        <Link href="/dashboard/network" className="rounded-lg px-3 py-2 text-sm font-semibold text-primary-strong hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary">
          View my network &rarr;
        </Link>
      </header>
      {nav}

      {noProvider ? (
        <EmptyState title="Create your provider profile" description="Finish the first onboarding step to see owners in the areas you serve." action={<Link href="/dashboard/onboarding" className="font-bold text-primary-strong underline">Start onboarding</Link>} />
      ) : error ? (
        <LoadErrorCard title="Work opportunities could not be loaded" message={error} onRetry={() => { setError(null); setResult(null); setAttempt((value) => value + 1); }} />
      ) : !result ? (
        <p role="status" className="text-sm text-text-body">Finding owners in your areas…</p>
      ) : result.areas.length === 0 && result.items.length === 0 ? (
        <Card className="p-8 text-center">
          <h2 className="font-heading text-lg font-semibold text-text-dark">Add the areas you serve</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-body">
            Owners are matched on your suburb and your services&apos; service areas. Add your suburb on your{' '}
            <Link href="/dashboard/profile" className="font-semibold text-primary-strong underline">profile</Link>, or a service area on{' '}
            <Link href="/dashboard/services" className="font-semibold text-primary-strong underline">your services</Link>.
          </p>
        </Card>
      ) : (
        <section aria-labelledby="work-opportunities-heading" className="space-y-4">
          <div>
            <h2 id="work-opportunities-heading" className="font-heading text-xl font-semibold text-text-dark">Owners in your areas</h2>
            <p className="mt-1 text-sm leading-6 text-text-body">
              {/* A provider whose profile names only a state is matched on it, with no area to list. */}
              {result.areas.length ? `Based on ${areaList(result.areas)}.` : 'Based on the state on your profile.'} {NOTE}
            </p>
          </div>
          {inAreas(result).length === 0 ? (
            <Card className="p-8 text-center">
              <h3 className="font-heading text-lg font-semibold text-text-dark">No owners in your areas yet</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-text-body">Owners appear here as they list properties or add a suburb in the areas you serve. More service areas widen the search.</p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {inAreas(result).map((owner) => <OpportunityCard key={owner.id} owner={owner} />)}
            </div>
          )}
        </section>
      )}
      {result && inState(result).length ? (
        <section aria-labelledby="work-opportunities-state" className="space-y-4">
          <div>
            <h2 id="work-opportunities-state" className="font-heading text-xl font-semibold text-text-dark">Elsewhere in your state</h2>
            <p className="mt-1 text-sm leading-6 text-text-body">These owners share your state, outside the areas you serve.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {inState(result).map((owner) => <OpportunityCard key={owner.id} owner={owner} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// Owners who only share the provider's state are no match for an area they serve: they go under their own heading.
const inState = (result: Opportunities) => result.items.filter((owner) => owner.match === 'same_state');
const inAreas = (result: Opportunities) => result.items.filter((owner) => owner.match !== 'same_state');
