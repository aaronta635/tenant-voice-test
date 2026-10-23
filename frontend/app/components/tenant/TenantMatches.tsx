'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ConnectButton from '@/app/components/trust/ConnectButton';
import RatingBadge from '@/app/components/trust/RatingBadge';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatMoney, initialsOf } from '@/app/lib/format';
import {
  ESSENTIAL_FILTERS,
  MATCH_LEVEL_LABELS,
  PREFERENCES_HREF,
  getLandlordMatches,
  getPropertyMatches,
  refinePropertyMatches,
  saveMatchEssentials,
  type EssentialFilter,
  type LandlordMatch,
  type LandlordMatches,
  type MatchFilter,
  type MatchLevel,
  type PropertyMatch,
  type PropertyMatches,
} from '@/app/lib/matching';
import { isRemoteImage } from '@/app/lib/remote-image';
import { refusalOf } from '@/app/lib/verification-gate';

type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };
type Order = 'best' | 'price_asc' | 'price_desc';

/** How many reasons a card shows before "more". */
const REASONS_SHOWN = 4;
/** What each must left out, in the words of the empty state. */
const EXCLUDED_LABELS: Record<EssentialFilter, string> = {
  budget: 'over your budget',
  location: 'outside your areas',
  pets: 'not pet-friendly',
  bedrooms: 'too few bedrooms',
  move_in: 'not free by your move-in date',
};
const LEVEL_CLASSES: Record<MatchLevel, string> = {
  strong: 'bg-success text-white',
  good: 'bg-surface text-primary-strong',
  fair: 'bg-surface text-text-body',
};
/** The refusal shown when the AI order needs a verified account; focus moves to it. */
const AI_REFUSAL_ID = 'matches-ai-refusal';

function loadError(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * The homes and landlords the server matched to the tenant's saved preferences
 * (R34), with the facts behind each match, and the musts every home has to
 * meet. Nothing is filtered here: a home that fails a must never arrives.
 */
export default function TenantMatches({ propertyHrefBase = '/tenant/properties' }: { propertyHrefBase?: string }) {
  const [homes, setHomes] = useState<Load<PropertyMatches>>({ status: 'loading' });
  const [landlords, setLandlords] = useState<Load<LandlordMatches>>({ status: 'loading' });
  const [homesAttempt, setHomesAttempt] = useState(0);
  const [landlordsAttempt, setLandlordsAttempt] = useState(0);
  const [order, setOrder] = useState<Order>('best');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  // How many refines came back refused: only then does focus move to the reason.
  const [refusedRefines, setRefusedRefines] = useState(0);

  useEffect(() => {
    let active = true;
    getPropertyMatches()
      .then((data) => { if (active) setHomes({ status: 'ready', data }); })
      .catch((err) => { if (active) setHomes({ status: 'error', message: loadError(err, 'Your matches could not be loaded.') }); });
    return () => { active = false; };
  }, [homesAttempt]);

  useEffect(() => {
    // A refused AI order takes the button's place: focus follows it, unless the tenant moved on.
    // One the page loads with stays where it is, so focus stays at the top of the page.
    if (refusedRefines) focusResult(document.getElementById(AI_REFUSAL_ID), null);
  }, [refusedRefines]);

  useEffect(() => {
    let active = true;
    getLandlordMatches()
      .then((data) => { if (active) setLandlords({ status: 'ready', data }); })
      .catch((err) => {
        if (active) setLandlords({ status: 'error', message: loadError(err, 'Landlord suggestions could not be loaded.') });
      });
    return () => { active = false; };
  }, [landlordsAttempt]);

  function retryHomes() {
    setHomes({ status: 'loading' });
    setHomesAttempt((value) => value + 1);
  }

  function retryLandlords() {
    setLandlords({ status: 'loading' });
    setLandlordsAttempt((value) => value + 1);
  }

  function mustsSaved(data: PropertyMatches) {
    setHomes({ status: 'ready', data });
    // The musts decide which landlords have homes for the tenant too.
    retryLandlords();
  }

  async function refine() {
    setRefining(true);
    setRefineError(null);
    try {
      const data = await refinePropertyMatches();
      setHomes({ status: 'ready', data });
      setOrder('best');
      if (refusalOf(data.verification)) setRefusedRefines((count) => count + 1);
    } catch (err) {
      setRefineError(loadError(err, 'Could not refine the order. Please try again.'));
    } finally {
      setRefining(false);
    }
  }

  const items = useMemo(() => {
    if (homes.status !== 'ready') return [];
    const rows = homes.data.items;
    if (order === 'price_asc') return [...rows].sort((a, b) => a.listing.price - b.listing.price);
    if (order === 'price_desc') return [...rows].sort((a, b) => b.listing.price - a.listing.price);
    return rows;
  }, [homes, order]);

  return (
    <div className="space-y-10">
      <section aria-labelledby="matched-homes-title" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="matched-homes-title" className="text-lg font-bold text-text-dark">Homes that match your preferences</h2>
          {homes.status === 'ready' && homes.data.items.length > 1 ? (
            <label className="flex items-center gap-2 text-sm text-text-body">
              Order:
              <select
                value={order}
                onChange={(event) => setOrder(event.target.value as Order)}
                className="min-h-10 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark"
              >
                <option value="best">Best match</option>
                <option value="price_asc">Lowest price</option>
                <option value="price_desc">Highest price</option>
              </select>
            </label>
          ) : null}
        </div>

        {homes.status === 'loading' ? (
          <p role="status" className="text-sm text-text-body">Finding homes that match your preferences…</p>
        ) : homes.status === 'error' ? (
          <ErrorCard title="Your matches could not be loaded" message={homes.message} onRetry={retryHomes} />
        ) : (
          <div className="space-y-6">
            {homes.data.has_preferences ? <Musts filters={homes.data.filters} onSaved={mustsSaved} /> : null}
            <AiNote
              matches={homes.data}
              refining={refining}
              error={refineError}
              onRefine={refine}
            />
            <HomeList matches={homes.data} items={items} propertyHrefBase={propertyHrefBase} />
          </div>
        )}
      </section>

      {homes.status === 'ready' && !homes.data.has_preferences ? null : (
        <section aria-labelledby="matched-landlords-title" className="min-w-0">
          <h2 id="matched-landlords-title" className="mb-4 text-lg font-bold text-text-dark">Landlords with homes for you</h2>
          {landlords.status === 'loading' ? (
            <p role="status" className="text-sm text-text-body">Finding landlords…</p>
          ) : landlords.status === 'error' ? (
            <ErrorCard title="Landlord suggestions could not be loaded" message={landlords.message} onRetry={retryLandlords} />
          ) : landlords.data.items.length === 0 ? (
            <Card className="p-6 text-sm text-text-body">
              No landlords to suggest yet: none has a home that meets all your musts.
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {landlords.data.items.map((landlord) => (
                <LandlordCard key={landlord.id} landlord={landlord} propertyHrefBase={propertyHrefBase} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ErrorCard({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <Card className="p-6">
      <h3 className="font-heading text-base font-semibold text-text-dark">{title}</h3>
      <p className="mt-1 text-sm text-text-body">{message}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>
    </Card>
  );
}

/** Which of the tenant's preferences every home must meet; the rest only rank a home lower. */
function Musts({ filters, onSaved }: { filters: MatchFilter[]; onSaved: (data: PropertyMatches) => void }) {
  const [marks, setMarks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(filters.map((filter) => [filter.key, filter.essential])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const active = ESSENTIAL_FILTERS.filter(({ key }) => filters.find((filter) => filter.key === key)?.active);
  const unset = ESSENTIAL_FILTERS.filter(({ key }) => !active.some((filter) => filter.key === key));

  function mark(key: EssentialFilter, must: boolean) {
    setSaved(false);
    setMarks((current) => ({ ...current, [key]: must }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const data = await saveMatchEssentials(ESSENTIAL_FILTERS.map(({ key }) => key).filter((key) => marks[key]));
      setSaved(true);
      onSaved(data);
    } catch (err) {
      setError(loadError(err, 'Could not save your musts. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className="p-5">
        <fieldset className="min-w-0">
          <legend className="font-heading text-base font-semibold text-text-dark">What every home must have</legend>
          <p id="musts-hint" className="mt-1 text-sm text-text-body">
            Tick what a home must meet: one that misses it is left out. The others are nice to have, and only move a
            home down the list.
          </p>
          {active.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {active.map(({ key, label }) => (
                <label key={key} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                  <input
                    type="checkbox"
                    checked={marks[key]}
                    aria-describedby="musts-hint"
                    onChange={(event) => mark(key, event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-primary-strong"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text-dark">{label}</span>{' '}
                    <span className="block break-words text-sm text-text-body">
                      {filters.find((filter) => filter.key === key)?.summary}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {unset.length ? (
            <p className="mt-3 text-sm text-text-body">
              Not set yet: {unset.map(({ label }) => label.toLowerCase()).join(', ')}.
            </p>
          ) : null}
        </fieldset>
        <FormMessage error={error} success={saved ? 'Your musts are saved.' : null} className="mt-3" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {active.length ? (
            <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Save musts'}</Button>
          ) : null}
          <Link href={PREFERENCES_HREF} className="inline-flex min-h-10 items-center text-sm font-semibold text-primary-strong underline">
            Edit your preferences
          </Link>
        </div>
      </Card>
    </form>
  );
}

/**
 * Whether the order is the rules' or the model's, and the button that asks the
 * model. The model is paid AI, which needs a verified account (tracker R18):
 * refused, the server keeps the rule order and says why, with the way to the
 * tenant's documents.
 */
function AiNote({ matches, refining, error, onRefine }: {
  matches: PropertyMatches;
  refining: boolean;
  error: string | null;
  onRefine: () => void;
}) {
  if (!matches.items.length) return null;
  // The button only once a key is set, and until the model has ordered these homes.
  const offer = ['ready', 'unavailable', 'cooldown'].includes(matches.ai_status);
  const refused = refusalOf(matches.verification);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="status" className="min-w-0 flex-1 text-sm text-text-body">
        {matches.message ?? 'Ordered by how well each home fits your preferences.'}
      </p>
      {offer ? (
        <Button variant="secondary" size="sm" onClick={onRefine} disabled={refining}>
          {refining ? 'Refining…' : 'Refine order with AI'}
        </Button>
      ) : null}
      {error ? <p role="alert" className="w-full text-sm text-danger">{error}</p> : null}
      {refused ? <VerificationRequired detail={refused} id={AI_REFUSAL_ID} className="w-full" /> : null}
    </div>
  );
}

function HomeList({ matches, items, propertyHrefBase }: {
  matches: PropertyMatches;
  items: PropertyMatch[];
  propertyHrefBase: string;
}) {
  if (!matches.has_preferences) {
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <h3 className="font-heading text-base font-semibold text-text-dark">Tell us what you are looking for</h3>
        <p className="text-sm text-text-body">
          Homes are matched to your saved budget, suburbs, bedrooms, pets and move-in date.
        </p>
        <ButtonLink href={PREFERENCES_HREF} size="sm">Add your preferences</ButtonLink>
      </Card>
    );
  }
  if (!items.length) {
    const reasons = ESSENTIAL_FILTERS
      .filter(({ key }) => matches.excluded[key])
      .map(({ key }) => `${matches.excluded[key]} ${EXCLUDED_LABELS[key]}`);
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <h3 className="font-heading text-base font-semibold text-text-dark">No homes meet all your musts right now</h3>
        <p className="text-sm text-text-body">
          {matches.considered
            ? `Of ${matches.considered} listed home${matches.considered === 1 ? '' : 's'}: ${reasons.join(', ')}.`
            : 'No homes are listed at the moment.'}{' '}
          Mark a must as nice to have, or change your preferences.
        </p>
        <ButtonLink href={PREFERENCES_HREF} variant="secondary" size="sm">Edit your preferences</ButtonLink>
      </Card>
    );
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2" aria-label="Matched homes">
      {items.map((match) => (
        <li key={match.listing.id} className="min-w-0">
          <HomeCard match={match} href={`${propertyHrefBase}/${match.listing.id}`} />
        </li>
      ))}
    </ul>
  );
}

function HomeCard({ match, href }: { match: PropertyMatch; href: string }) {
  const { listing, landlord } = match;
  const titleId = `match-${listing.id}`;
  const rooms = [
    listing.bedrooms != null ? `${listing.bedrooms} bed` : null,
    listing.bathrooms != null ? `${listing.bathrooms} bath` : null,
    listing.parking != null ? `${listing.parking} car` : null,
  ].filter(Boolean).join(' · ');
  const shown = match.reasons.slice(0, REASONS_SHOWN);
  const more = match.reasons.slice(REASONS_SHOWN);
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <article aria-labelledby={titleId} className="flex h-full flex-col">
        <div className="relative h-40 bg-surface">
          {listing.photo_url ? (
            <Image
              src={listing.photo_url}
              alt={listing.title}
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
              unoptimized={isRemoteImage(listing.photo_url)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-body">No photo yet</div>
          )}
        </div>
        <div className="flex flex-1 flex-col p-5">
          {/* On a narrow card the level wraps under the title rather than squeezing it. */}
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h3 id={titleId} className="min-w-48 flex-1 break-words font-heading text-base font-semibold text-text-dark">
              {listing.title}
            </h3>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL_CLASSES[match.match_level]}`}>
              {MATCH_LEVEL_LABELS[match.match_level]}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-body">
            {[listing.suburb, listing.state].filter(Boolean).join(', ') || 'Australia'}
            {rooms ? ` · ${rooms}` : ''}
          </p>
          <p className="mt-2 text-sm font-semibold text-primary-strong">{formatMoney(listing.price)}/wk</p>
          {landlord ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-body">
              <span>Landlord</span>
              {landlord.verified ? <VerifiedBadge size="sm" /> : null}
              <RatingBadge average={landlord.rating_avg} count={landlord.review_count} />
            </div>
          ) : null}
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-body">Why it fits</h4>
          <ul className="mt-1 space-y-1 text-sm text-text-dark">
            {shown.map((reason) => <Reason key={reason} text={reason} />)}
          </ul>
          {more.length ? (
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer font-medium text-primary-strong">
                {more.length} more reason{more.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1 space-y-1 text-text-dark">
                {more.map((reason) => <Reason key={reason} text={reason} />)}
              </ul>
            </details>
          ) : null}
          {match.unmet.length ? (
            <>
              <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-body">Nice-to-haves it misses</h4>
              <ul className="mt-1 space-y-1 text-sm text-text-body">
                {match.unmet.map((miss) => <li key={miss} className="break-words">{miss}</li>)}
              </ul>
            </>
          ) : null}
          <div className="mt-auto pt-4">
            <ButtonLink href={href} variant="secondary" fullWidth>
              View home<span className="sr-only">: {listing.title}</span>
            </ButtonLink>
          </div>
        </div>
      </article>
    </Card>
  );
}

function Reason({ text }: { text: string }) {
  return (
    <li className="flex gap-2 break-words">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 size-4 shrink-0 text-success" aria-hidden>
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
      <span className="min-w-0">{text}</span>
    </li>
  );
}

function LandlordCard({ landlord, propertyHrefBase }: { landlord: LandlordMatch; propertyHrefBase: string }) {
  const titleId = `landlord-${landlord.id}`;
  return (
    <Card className="flex h-full flex-col p-5">
      <article aria-labelledby={titleId} className="flex h-full flex-col">
        <div className="flex items-start gap-3">
          <div aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface text-base font-bold text-primary-strong">
            {initialsOf(landlord.display_name)}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-start gap-1.5">
              <h3 id={titleId} className="min-w-0 break-words text-sm font-bold text-text-dark">{landlord.display_name}</h3>
              {landlord.verified ? <VerifiedBadge size="sm" className="mt-0.5" /> : null}
            </div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-body">{landlord.role_label}</p>
            <div className="mt-1">
              <RatingBadge average={landlord.rating_avg} count={landlord.review_count} />
            </div>
          </div>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-text-dark">
          {landlord.reasons.map((reason) => <Reason key={reason} text={reason} />)}
        </ul>
        <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-body">Homes that fit</h4>
        <ul className="mt-1 space-y-1 text-sm">
          {landlord.listings.map((home) => (
            <li key={home.id} className="min-w-0">
              <Link href={`${propertyHrefBase}/${home.id}`} className="inline-flex min-h-10 items-center break-words font-medium text-primary-strong underline">
                {home.title}{home.suburb ? `, ${home.suburb}` : ''} · {formatMoney(home.price)}/wk
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-auto space-y-2 pt-4">
          <ButtonLink href={`/public/${landlord.id}`} variant="secondary" size="sm" fullWidth>
            View profile<span className="sr-only">: {landlord.display_name}</span>
          </ButtonLink>
          <ConnectButton userId={landlord.id} name={landlord.display_name} signedIn compact />
        </div>
      </article>
    </Card>
  );
}
