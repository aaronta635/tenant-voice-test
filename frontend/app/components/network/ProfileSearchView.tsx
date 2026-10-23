'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ConnectButton from '@/app/components/trust/ConnectButton';
import RatingBadge from '@/app/components/trust/RatingBadge';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import FormMessage from '@/app/components/ui/FormMessage';
import PageHeader from '@/app/components/ui/PageHeader';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { api } from '@/app/lib/api';
import { searchMembers, type MemberSearchResult } from '@/app/lib/connections';
import { initialsOf, ROLE_LABELS } from '@/app/lib/format';
import { setSearchParams } from '@/app/lib/page-url';

export type ProfileSearchViewProps = {
  title?: string;
  subtitle?: string;
  messagesHref: string;
  defaultRole?: '' | 'landlord' | 'tenant' | 'service_provider';
};
const roles = [
  { value: '', label: 'All roles' }, { value: 'landlord', label: 'Landlords' },
  { value: 'tenant', label: 'Tenants' }, { value: 'service_provider', label: 'Service providers' },
];

export default function ProfileSearchView({ title = 'Search profiles', subtitle = 'Find tenants, landlords, and service providers to connect with.', messagesHref, defaultRole = '' }: ProfileSearchViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qParam = searchParams.get('q') ?? '';
  const roleParam = searchParams.get('role') ?? defaultRole;
  const role = roles.some(option => option.value === roleParam) ? roleParam : '';
  // The box's text, the URL q it last saw, and the q this view last wrote.
  // When q changes to anything this view did not write (a header search, Back,
  // a link), that search replaces the text; its own update leaves the typing.
  const [draft, setDraft] = useState({ value: qParam, seen: qParam, wrote: qParam });
  let synced = draft;
  if (draft.seen !== qParam) {
    synced = qParam === draft.wrote ? { ...draft, seen: qParam } : { value: qParam, seen: qParam, wrote: qParam };
    setDraft(synced);
  }
  const query = synced.value;
  const key = JSON.stringify([query, role]);
  const [response, setResponse] = useState<{ key: string; items: MemberSearchResult[]; error: string | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current = response?.key === key ? response : null;

  function updateUrl(q: string, nextRole: string) {
    setDraft(previous => ({ ...previous, wrote: q }));
    setSearchParams({ q, role: nextRole });
  }

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const items = await searchMembers({ search: query || undefined, role: role || undefined });
        if (active) setResponse({ key, items, error: null });
      } catch {
        if (active) setResponse({ key, items: [], error: 'Could not load profiles. Please try again.' });
      }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, query, role, attempt]);

  useEffect(() => {
    if (query === qParam) return;
    const timer = window.setTimeout(() => {
      setDraft(previous => ({ ...previous, wrote: query }));
      setSearchParams({ q: query });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, qParam]);

  async function message(person: MemberSearchResult) {
    if (busyId) return;
    setBusyId(person.id);
    setFeedback(null);
    try {
      const thread = await api.conversations.startRental({ peer_id: person.id, subject: `Chat with ${person.full_name}` });
      router.push(`${messagesHref}?thread=${thread.id}`);
    } catch {
      setFeedback({ id: person.id, error: 'Could not open the conversation. Please try again.' });
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={subtitle} />
      <Card className="border border-border p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Refine results</h2><Button variant="ghost" onClick={() => { setDraft(previous => ({ ...previous, value: '' })); updateUrl('', ''); }}>Reset</Button></div>
        <Input label="Search profiles" placeholder="Search names or areas" value={query} onChange={event => { const value = event.target.value; setDraft(previous => ({ ...previous, value })); }} />
        <fieldset className="mt-4"><legend className="text-sm font-semibold text-text-body">Role</legend><div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{roles.map(option => <label key={option.value} className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name="profile-search-role" checked={role === option.value} onChange={() => updateUrl(query, option.value)} className="accent-primary" />{option.label}</label>)}</div></fieldset>
      </Card>
      <section aria-label="Profile results" aria-busy={!current}>
        {!current ? <p role="status" className="text-sm text-text-body">Searching…</p> : current.error ? <LoadErrorCard message={current.error} onRetry={() => setAttempt(value => value + 1)} /> : current.items.length === 0 ? <Card className="border border-border p-6"><h2 className="font-semibold">No profiles match this search</h2><p className="mt-2 text-sm text-text-body">Try another name, area, or role.</p></Card> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{current.items.map(person => <Card key={person.id} className="flex min-w-0 flex-col border border-border p-5">
          <div aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface font-bold text-primary-strong">{initialsOf(person.full_name)}</div>
          <div className="mt-3 flex min-w-0 items-start gap-1.5"><h2 className="min-w-0 break-words font-semibold">{person.full_name}</h2>{person.verified ? <VerifiedBadge size="sm" className="mt-1" /> : null}</div>
          <p className="mt-1 text-sm text-text-body">{ROLE_LABELS[person.role] ?? person.role}</p><p className="mt-2 text-sm text-text-body">{[person.location, person.state].filter(Boolean).join(', ') || 'Location not listed'}</p>
          {/* The rating their profile shows: the same reviews counted (R23). */}
          <div className="mb-4 mt-2 flex-1"><RatingBadge average={person.rating_avg} count={person.review_count} /></div>
          <ConnectButton userId={person.id} name={person.full_name} signedIn initialState={person.connection} compact connectedAction={<Button variant="secondary" size="sm" fullWidth disabled={!!busyId} aria-label={`Message ${person.full_name}`} onClick={() => void message(person)}>{busyId === person.id ? 'Opening…' : 'Message'}</Button>} />
          <FormMessage error={feedback?.id === person.id ? feedback.error : undefined} /><p className="sr-only" role="status">{busyId === person.id ? 'Working…' : ''}</p>
        </Card>)}</div>}
      </section>
    </div>
  );
}
