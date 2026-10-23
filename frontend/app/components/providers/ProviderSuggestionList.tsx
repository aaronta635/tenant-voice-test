'use client';

import { useEffect, useState, type ReactNode } from 'react';
import ProviderSuggestionCard from '@/app/components/providers/ProviderSuggestionCard';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import { ApiError } from '@/app/lib/api';
import { contextSentence, getProviderSuggestions, type ProviderSuggestions } from '@/app/lib/provider-suggestions';

type Load =
  | { status: 'loading' }
  // refused: the property is not the owner's (404) or the category is not in the catalogue (422).
  | { status: 'error'; message: string; refused: 'property' | 'category' | null }
  | { status: 'ready'; data: ProviderSuggestions };

type Props = {
  /** A category code or URL slug; null for every category. */
  category?: string | null;
  /** Owners only: one of their properties; null for all of them. */
  propertyId?: string | null;
  limit?: number;
  reasonsShown?: number;
  /** Shown when there is no place to match on, such as a link to add one. */
  noPlaceHint?: ReactNode;
  /** Offered instead of a retry when the property asked for is not the owner's (404). */
  onPropertyGone?: () => void;
  /** Offered instead of a retry when the category asked for is not one the catalogue has (422). */
  onCategoryRefused?: () => void;
  gridClassName?: string;
};

const count = (number: number) => `${number} provider${number === 1 ? '' : 's'}`;

/**
 * The providers the server suggests for the signed-in member's places (R31),
 * in its order, with its reasons. Nothing is ranked or filtered here. The
 * status line says what each load found, so a screen reader hears the
 * answer to every change of filter.
 */
export default function ProviderSuggestionList({
  category = null,
  propertyId = null,
  limit,
  reasonsShown,
  noPlaceHint,
  onPropertyGone,
  onCategoryRefused,
  gridClassName = 'grid gap-4 md:grid-cols-2 xl:grid-cols-3',
}: Props) {
  const [attempt, setAttempt] = useState(0);
  // Each answer is kept with the query it answers, so a new filter shows "Finding" until its own arrives.
  const query = JSON.stringify([category, propertyId, limit, attempt]);
  const [answer, setAnswer] = useState<{ query: string; load: Load } | null>(null);

  useEffect(() => {
    let active = true;
    getProviderSuggestions({ category, propertyId, limit })
      .then((data) => { if (active) setAnswer({ query, load: { status: 'ready', data } }); })
      .catch((err: unknown) => {
        if (!active) return;
        const message = err instanceof ApiError ? err.message : 'Provider suggestions could not be loaded. Please try again.';
        const status = err instanceof ApiError ? err.status : 0;
        const refused = status === 404 && propertyId ? 'property' : status === 422 && category ? 'category' : null;
        setAnswer({ query, load: { status: 'error', message, refused } });
      });
    return () => { active = false; };
  }, [category, propertyId, limit, query]);

  const load: Load = answer?.query === query ? answer.load : { status: 'loading' };
  const found = load.status === 'ready' ? load.data : null;
  const where = found ? contextSentence(found.context) : null;
  const status = load.status === 'loading'
    ? 'Finding providers…'
    : !found ? ''
      : !found.items.length ? 'No providers to suggest yet.'
        : where ? `${count(found.items.length)} for ${where}.` : `${count(found.items.length)}, ranked on their rating and price.`;

  return (
    <div className="space-y-4">
      {/* One status line for every load, so each answer is announced; the error has its own alert. */}
      <p role="status" className={load.status === 'loading' || found?.items.length ? 'text-sm text-text-body' : 'sr-only'}>{status}</p>
      {load.status === 'error' ? (
        <ErrorCard
          load={load}
          onPropertyGone={onPropertyGone}
          onCategoryRefused={onCategoryRefused}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : found && !found.items.length ? (
        <Card className="flex flex-col items-start gap-3 p-6">
          <h3 className="font-heading text-base font-semibold text-text-dark">No providers to suggest yet</h3>
          <p className="text-sm text-text-body">
            {found.category ? `No providers listed under ${found.category.name}` : 'No providers on TenantVoice'}
            {where ? ` work in ${where} yet.` : ' can take a booking yet.'}
          </p>
          <ButtonLink href={found.category ? `/categories/${found.category.slug}` : '/categories'} variant="secondary" size="sm">
            Browse all providers
          </ButtonLink>
        </Card>
      ) : found ? (
        <>
          {!where && noPlaceHint ? <div className="text-sm text-text-body">{noPlaceHint}</div> : null}
          <ul aria-label="Suggested providers" className={gridClassName}>
            {found.items.map((suggestion) => (
              <li key={suggestion.id} className="min-w-0">
                <ProviderSuggestionCard suggestion={suggestion} suburb={found.context.suburb} reasonsShown={reasonsShown} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function ErrorCard({ load, onPropertyGone, onCategoryRefused, onRetry }: {
  load: Extract<Load, { status: 'error' }>;
  onPropertyGone?: () => void;
  onCategoryRefused?: () => void;
  onRetry: () => void;
}) {
  const gone = load.refused === 'property' && onPropertyGone;
  const unknown = load.refused === 'category' && onCategoryRefused;
  return (
    <Card className="p-6">
      <h3 className="font-heading text-base font-semibold text-text-dark">
        {gone ? 'This property could not be found' : unknown ? 'This category is not offered' : 'Provider suggestions could not be loaded'}
      </h3>
      <p role="alert" className="mt-1 text-sm text-text-body">
        {gone ? 'It may have been removed, or it is not one of your properties.' : load.message}
      </p>
      {gone ? (
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={onPropertyGone}>Show all my properties</Button>
      ) : unknown ? (
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={onCategoryRefused}>Show every category</Button>
      ) : (
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>
      )}
    </Card>
  );
}
