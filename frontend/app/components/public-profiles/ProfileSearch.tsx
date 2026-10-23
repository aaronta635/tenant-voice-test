'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ProfileCard from '@/app/components/public-profiles/ProfileCard';
import ProfilePagination from '@/app/components/public-profiles/ProfilePagination';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FilterChip from '@/app/components/ui/FilterChip';
import Input from '@/app/components/ui/Input';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { setSearchParams } from '@/app/lib/page-url';
import {
  PROFILE_PAGE_SIZE,
  PROFILE_ROLE_FILTERS,
  parseProfileSearch,
  profileSearchHref,
  searchPublicProfiles,
  type ProfileRoleFilter,
  type PublicProfilePage,
} from '@/app/lib/public-profiles';

const TAB_LABELS: Record<ProfileRoleFilter, string> = { all: 'All', tenant: 'Tenants', landlord: 'Landlords', provider: 'Providers' };
const RESULT_NOUNS: Record<ProfileRoleFilter, [string, string]> = {
  all: ['profile', 'profiles'], tenant: ['tenant', 'tenants'], landlord: ['landlord', 'landlords'], provider: ['provider', 'providers'],
};
// Typing writes the URL once it pauses: every history write commits through
// a router transition, and browsers rate-limit history calls.
const URL_WRITE_DELAY_MS = 350;

type Draft = { value: string; seen: string; wrote: string };
type Result = { key: string; found: PublicProfilePage | null; error: string | null };
type Text = { q: string; location: string };

/**
 * The /search profile search. The URL holds the search (lib/public-profiles:
 * type, role, q, location, page), so a result view can be shared and Back
 * returns to it; every change goes through the History API (lib/page-url).
 */
export default function ProfileSearch() {
  const params = useSearchParams();
  const search = parseProfileSearch(params);
  const { role, q, location, page } = search;
  const id = useId();
  const keywords = useUrlDraft(q);
  const area = useUrlDraft(location);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const shownPage = useRef(page);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = JSON.stringify([role, q, location, page, attempt]);
  const current = result?.key === key ? result : null;

  useEffect(() => {
    let active = true;
    searchPublicProfiles({ role, q, location, page }).then(
      (found) => { if (active) setResult({ key, found, error: null }); },
      (error) => {
        if (active) setResult({ key, found: null, error: error instanceof ApiError ? error.message : 'Please try again.' });
      },
    );
    return () => { active = false; };
  }, [key, role, q, location, page]);

  // A write still pending after leaving would rewrite the next page's URL.
  useEffect(() => () => { if (writeTimer.current) clearTimeout(writeTimer.current); }, []);

  // A new page of results takes focus from the page link that asked for it.
  useEffect(() => {
    if (!current || shownPage.current === page) return;
    shownPage.current = page;
    focusResult(headingRef.current, resultsRef.current);
  }, [current, page]);

  function cancelWrite() {
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = null;
  }
  function writeText(text: Text) {
    cancelWrite();
    keywords.wrote(text.q);
    area.wrote(text.location);
    setSearchParams({ type: 'profiles', q: text.q, location: text.location, page: null });
  }
  function writeTextSoon(text: Text) {
    cancelWrite();
    writeTimer.current = setTimeout(() => writeText(text), URL_WRITE_DELAY_MS);
  }
  function flushText() {
    if (writeTimer.current) writeText({ q: keywords.value, location: area.value });
  }
  function chooseRole(next: ProfileRoleFilter) {
    flushText();
    setSearchParams({ type: 'profiles', role: next, page: null }, 'push');
  }
  function clearText() {
    keywords.set('');
    area.set('');
    writeText({ q: '', location: '' });
  }

  const total = current?.found?.total ?? 0;
  const items = current?.found?.items ?? [];
  const first = (page - 1) * PROFILE_PAGE_SIZE + 1;
  const [singular, plural] = RESULT_NOUNS[role];
  const place = location.trim();
  const filtered = !!(q.trim() || place);

  return (
    <div className="mt-6 min-w-0">
      <form
        role="search"
        aria-label="Profiles"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
        onSubmit={(event) => { event.preventDefault(); flushText(); }}
      >
        <Input
          label="Name or keywords"
          type="search"
          placeholder="Name, business or keywords"
          maxLength={100}
          value={keywords.value}
          onChange={(event) => { keywords.set(event.target.value); writeTextSoon({ q: event.target.value, location: area.value }); }}
          onBlur={flushText}
        />
        <Input
          label="Location"
          type="search"
          placeholder="Suburb or area"
          maxLength={100}
          value={area.value}
          onChange={(event) => { area.set(event.target.value); writeTextSoon({ q: keywords.value, location: event.target.value }); }}
          onBlur={flushText}
        />
        <Button type="submit" className="sm:col-span-2 lg:col-span-1">Search</Button>
      </form>

      <div role="group" aria-label="Profile type" className="mt-5 flex flex-wrap gap-2">
        {PROFILE_ROLE_FILTERS.map((value) => (
          <FilterChip key={value} selected={role === value} onClick={() => chooseRole(value)}>{TAB_LABELS[value]}</FilterChip>
        ))}
      </div>

      <section ref={resultsRef} aria-labelledby={`${id}-results`} aria-busy={!current} className="mt-6 min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 ref={headingRef} id={`${id}-results`} tabIndex={-1} className="font-heading text-xl font-bold text-text-dark">
            {current?.found ? `${total} ${total === 1 ? singular : plural}` : `${plural[0].toUpperCase()}${plural.slice(1)}`}
            {place ? <span className="font-normal text-text-body"> · in {place}</span> : null}
          </h2>
          <p role="status" className="text-sm text-text-body">
            {!current ? 'Loading profiles…' : items.length ? `Showing ${first}–${first + items.length - 1} of ${total}` : ''}
          </p>
        </div>
        {!current ? (
          <ul aria-hidden className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((index) => <li key={index} className="h-72 animate-pulse rounded-[20px] border border-border bg-white" />)}
          </ul>
        ) : current.error ? (
          <LoadErrorCard title="Couldn't load profiles" message={current.error} onRetry={() => setAttempt((value) => value + 1)} />
        ) : items.length === 0 ? (
          <Card className="mt-4 flex flex-col items-start gap-3 p-6">
            {total ? (
              <>
                <h3 className="font-heading text-h4 font-semibold">No profiles on this page</h3>
                <p className="text-sm text-text-body">This search has {total} {total === 1 ? singular : plural}, on fewer pages.</p>
                <Button variant="secondary" onClick={() => setSearchParams({ page: null })}>Go to the first page</Button>
              </>
            ) : (
              <>
                <h3 className="font-heading text-h4 font-semibold">No profiles found</h3>
                <p className="text-sm text-text-body">
                  {filtered
                    ? 'Try another name, keyword or suburb, or clear the search.'
                    : `No ${role === 'all' ? 'members' : plural} have a public profile yet.`}
                </p>
                {filtered ? <Button variant="secondary" onClick={clearText}>Clear search</Button> : null}
              </>
            )}
          </Card>
        ) : (
          <>
            <ul className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((profile) => <li key={profile.id} className="min-w-0"><ProfileCard profile={profile} /></li>)}
            </ul>
            <ProfilePagination
              page={page}
              totalPages={Math.ceil(total / PROFILE_PAGE_SIZE)}
              hrefFor={(number) => profileSearchHref({ ...search, page: number })}
            />
          </>
        )}
      </section>
    </div>
  );
}

/**
 * A text box's value, kept in step with its URL parameter. When the parameter
 * changes to anything this view did not write (Back, a link), that value
 * replaces the text; this view's own write leaves later typing alone.
 */
function useUrlDraft(urlValue: string) {
  const [draft, setDraft] = useState<Draft>({ value: urlValue, seen: urlValue, wrote: urlValue });
  let synced = draft;
  if (draft.seen !== urlValue) {
    synced = urlValue === draft.wrote ? { ...draft, seen: urlValue } : { value: urlValue, seen: urlValue, wrote: urlValue };
    setDraft(synced);
  }
  return {
    value: synced.value,
    set: (value: string) => setDraft((previous) => ({ ...previous, value })),
    wrote: (value: string) => setDraft((previous) => ({ ...previous, wrote: value })),
  };
}
