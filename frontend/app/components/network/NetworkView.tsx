'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import EmptyState from '@/app/components/ui/EmptyState';
import StatCard from '@/app/components/ui/StatCard';
import Input from '@/app/components/ui/Input';
import FormMessage from '@/app/components/ui/FormMessage';
import Modal from '@/app/components/ui/Modal';
import PageHeader from '@/app/components/ui/PageHeader';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import {
  api,
  ApiError,
  getAuthToken,
  type Connection,
  type ProfileSearchResult,
} from '@/app/lib/api';
import { initialsOf, relativeTime, ROLE_LABELS } from '@/app/lib/format';

type RoleFilter = '' | 'landlord' | 'tenant' | 'service_provider';
type SortKey = 'recent' | 'name';

export type NetworkViewProps = {
  title?: string;
  subtitle?: string;
  messagesHref: string;
  searchHref: string;
  recommendationsHref: string;
  signInHint?: string;
};

export default function NetworkView({
  title = 'My network',
  subtitle = 'Manage your connections and grow your professional network.',
  messagesHref,
  searchHref,
  recommendationsHref,
  signInHint = 'Sign in to load your connections and requests.',
}: NetworkViewProps) {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  // Loaded on their own: when they fail, requests, connections and Message still work.
  const [suggestions, setSuggestions] = useState<{ items: ProfileSearchResult[]; failed: boolean } | null>(null);
  const [suggestionsAttempt, setSuggestionsAttempt] = useState(0);
  const suggestionsHeading = useRef<HTMLHeadingElement>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [declining, setDeclining] = useState<Connection | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const authed = !!getAuthToken();
      if (!active) return;
      setSignedIn(authed);
      if (!authed) {
        setLoading(false);
        return;
      }
      try {
        const list = await api.connections.list();
        if (!active) return;
        setConnections(list);
        setLoadError(null);
      } catch {
        if (active) setLoadError('Could not load your network. Please try again.');
      } finally { if (active) setLoading(false); }
    })();
    return () => {
      active = false;
    };
  }, [reload]);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    api.profiles.search({ limit: 24 }).then(
      (people) => {
        if (active) setSuggestions({ items: people.filter(person => !person.connection_status && ['tenant', 'landlord'].includes(person.role)).slice(0, 6), failed: false });
      },
      () => { if (active) setSuggestions({ items: [], failed: true }); },
    );
    return () => { active = false; };
  }, [signedIn, suggestionsAttempt]);

  const requests = useMemo(
    () => connections.filter((c) => c.status === 'pending' && c.direction === 'incoming'),
    [connections],
  );
  const accepted = useMemo(
    () => connections.filter((c) => c.status === 'accepted'),
    [connections],
  );
  const outgoingPending = useMemo(
    () => connections.filter((c) => c.status === 'pending' && c.direction === 'outgoing'),
    [connections],
  );
  // Lists only the requests this person declined, so only the decliner is offered Remove.
  const declined = useMemo(
    () => connections.filter((c) => c.status === 'declined' && c.direction === 'incoming'),
    [connections],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = accepted.filter((c) => {
      if (roleFilter && c.person_role !== roleFilter) return false;
      if (!q) return true;
      return (
        c.person_name.toLowerCase().includes(q) ||
        (c.person_location ?? '').toLowerCase().includes(q) ||
        (ROLE_LABELS[c.person_role] ?? c.person_role).toLowerCase().includes(q)
      );
    });
    if (sortBy === 'name') {
      rows = [...rows].sort((a, b) => a.person_name.localeCompare(b.person_name));
    } else {
      rows = [...rows].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    return rows;
  }, [accepted, query, roleFilter, sortBy]);

  async function respond(id: string, status: 'accepted' | 'declined') {
    if (busyId) return;
    setBusyId(id);
    setActionId(id);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.connections.respond(id, status);
      setConnections((prev) => prev.map((c) => (c.id === id ? updated : c)));
      setNotice(status === 'accepted' ? 'Connection accepted.' : 'Request declined. You can remove it under Declined requests if you change your mind.');
      window.dispatchEvent(new Event('tenantvoice:counts-changed'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that request.');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDecline() {
    if (!declining) return;
    await respond(declining.id, 'declined');
    setDeclining(null);
  }

  async function connect(personId: string) {
    if (busyId) return;
    setBusyId(personId);
    setActionId(personId);
    setError(null);
    setNotice(null);
    try {
      const created = await api.connections.request(personId);
      setConnections((prev) => [created, ...prev]);
      setNotice('Connection request sent.');
      window.dispatchEvent(new Event('tenantvoice:counts-changed'));
      setSuggestions((prev) => prev && {
        ...prev,
        items: prev.items.map((p) =>
          p.id === personId ? { ...p, connection_status: 'pending' } : p,
        ),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send connection request.');
    } finally {
      setBusyId(null);
    }
  }

  async function removeRequest(id: string, success: string, failure: string) {
    if (busyId) return;
    setBusyId(id);
    setActionId(id);
    setError(null);
    setNotice(null);
    try {
      await api.connections.remove(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      setNotice(success);
      window.dispatchEvent(new Event('tenantvoice:counts-changed'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusyId(null);
    }
  }

  async function openThread(personId: string, personName: string) {
    if (busyId) return;
    setBusyId(personId);
    setActionId(personId);
    setError(null);
    setNotice(null);
    try {
      const thread = await api.conversations.startRental({
        peer_id: personId,
        subject: `Chat with ${personName}`,
      });
      router.push(`${messagesHref}?thread=${thread.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not start a conversation with this connection.',
      );
    } finally {
      setBusyId(null);
    }
  }

  function resetFilters() {
    setQuery('');
    setRoleFilter('');
    setSortBy('recent');
  }

  return (
    <div>
      <PageHeader title={title} description={subtitle} />

      {!loading && !signedIn ? (
        <p className="mb-6 rounded-[12px] border border-[#dde1ff] bg-[#f0f1ff] px-4 py-3 text-sm text-[#3f46b0]">
          <Link href="/login" className="font-semibold underline">
            Sign in
          </Link>{' '}
          {signInHint}
        </p>
      ) : null}

      <div className="mt-5" aria-live="polite"><FormMessage success={notice} /></div>
      {loadError ? <LoadErrorCard message={loadError} onRetry={() => { setLoading(true); setReload(value => value + 1); }} /> : loading ? <p role="status" className="py-6 text-sm text-text-body">Loading network…</p> : !signedIn ? null :
      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard value={String(accepted.length)} label="Connections" />
            <StatCard value={String(requests.length)} label="Incoming requests" />
            <StatCard value={String(outgoingPending.length)} label="Sent requests" />
          </div>

          <Card className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-bold text-[#171a1f]">Connection requests</h2>
              <span className="rounded-full bg-[#f0f1ff] px-3 py-1 text-xs font-medium text-primary-strong">
                {requests.length} pending
              </span>
            </div>
            {loading ? (
              <p className="text-sm text-[#565d6d]">Loading…</p>
            ) : requests.length === 0 ? (
              <p className="text-sm text-[#565d6d]">No incoming connection requests.</p>
            ) : (
              <div className="space-y-3">
                {requests.map((request) => (
                  <div
                    key={request.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#eef0f4] bg-[#fafbfc] px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar initials={initialsOf(request.person_name)} />
                      <div className="min-w-0">
                        <p className="break-words text-sm font-bold text-[#171a1f]">
                          {request.person_name}
                        </p>
                        <p className="text-xs text-[#565d6d]">
                          {ROLE_LABELS[request.person_role] ?? request.person_role}
                          {request.person_location ? ` · ${request.person_location}` : ''}
                          {' · '}
                          {relativeTime(request.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        className="min-h-11 rounded-lg px-4"
                        disabled={!!busyId}
                        aria-label={`Accept request from ${request.person_name}`}
                        onClick={() => respond(request.id, 'accepted')}
                      >
                        {busyId === request.id ? 'Working…' : 'Accept'}
                      </Button>
                      <Button
                        variant="secondary"
                        className="min-h-11 rounded-lg border-[#de3b40]/40 px-4 text-danger"
                        disabled={!!busyId}
                        aria-label={`Decline request from ${request.person_name}`}
                        onClick={() => setDeclining(request)}
                      >
                        Decline
                      </Button>
                    </div>
                    <div className="w-full"><FormMessage error={actionId === request.id ? error : null} /></div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-bold text-[#171a1f]">Sent requests</h2>
              <span className="rounded-full bg-[#fff4e5] px-3 py-1 text-xs font-medium text-[#b45309]">
                {outgoingPending.length} pending
              </span>
            </div>
            {loading ? (
              <p className="text-sm text-[#565d6d]">Loading…</p>
            ) : outgoingPending.length === 0 ? (
              <p className="text-sm text-[#565d6d]">
                No sent requests yet. Use Connect on someone to send one.
              </p>
            ) : (
              <div className="space-y-3">
                {outgoingPending.map((request) => (
                  <div
                    key={request.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#eef0f4] bg-[#fafbfc] px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar initials={initialsOf(request.person_name)} />
                      <div className="min-w-0">
                        <p className="break-words text-sm font-bold text-[#171a1f]">
                          {request.person_name}
                        </p>
                        <p className="text-xs text-[#565d6d]">
                          {ROLE_LABELS[request.person_role] ?? request.person_role}
                          {request.person_location ? ` · ${request.person_location}` : ''}
                          {' · '}
                          {relativeTime(request.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[#fff4e5] px-3 py-1 text-xs font-medium text-[#b45309]">
                        Pending
                      </span>
                      <Button
                        variant="ghost"
                        className="min-h-11 rounded-lg px-3 text-xs text-[#565d6d]"
                        disabled={!!busyId}
                        onClick={() => removeRequest(request.id, 'Request cancelled.', 'Could not cancel that request.')}
                      >
                        Cancel<span className="sr-only"> request to {request.person_name}</span>
                      </Button>
                    </div>
                    <div className="w-full"><FormMessage error={actionId === request.id ? error : null} /></div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {declined.length > 0 ? (
            <Card className="p-6">
              <h2 className="text-base font-bold text-text-dark">Declined requests</h2>
              <p className="mb-4 mt-1 text-sm text-text-body">
                Only you can send a new request while it is listed here, from their profile or a search card. Remove it
                to let either of you ask again.
              </p>
              <div className="space-y-3">
                {declined.map((request) => (
                  <div
                    key={request.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar initials={initialsOf(request.person_name)} />
                      <div className="min-w-0">
                        <p className="break-words text-sm font-bold text-text-dark">
                          {request.person_name}
                        </p>
                        <p className="text-xs text-text-body">
                          {ROLE_LABELS[request.person_role] ?? request.person_role}
                          {request.person_location ? ` · ${request.person_location}` : ''}
                          {' · '}
                          {relativeTime(request.responded_at ?? request.created_at)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      className="min-h-11 rounded-lg px-3 text-xs"
                      disabled={!!busyId}
                      aria-label={`Remove declined request from ${request.person_name}`}
                      onClick={() => removeRequest(request.id, `Declined request removed. You or ${request.person_name} can send a new connection request.`, 'Could not remove that declined request.')}
                    >
                      {busyId === request.id ? 'Removing…' : 'Remove'}
                    </Button>
                    <div className="w-full"><FormMessage error={actionId === request.id ? error : null} /></div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {accepted.length === 0 ? (
            <EmptyState
              title="No connections yet"
              description="Connect with tenants, landlords and service providers so you can message them from your network."
              action={<ButtonLink href={searchHref}>Find people</ButtonLink>}
            />
          ) : <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              aria-label="Search your connections"
              placeholder="Search your connections..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 rounded-[10px] bg-white"
            />
            <select
              aria-label="Filter by role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
              className="h-11 rounded-[10px] border border-[#dee1e6] bg-white px-3 text-sm text-[#171a1f]"
            >
              <option value="">All roles</option>
              <option value="landlord">Landlord</option>
              <option value="tenant">Tenant</option>
              <option value="service_provider">Service provider</option>
            </select>
            <Button variant="ghost" onClick={resetFilters}>Reset filters</Button>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef0f4] px-5 py-4">
              <h2 className="text-base font-bold text-[#171a1f]">Connections</h2>
              <select
                aria-label="Sort connections"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="h-11 rounded-[10px] border border-[#dee1e6] bg-white px-3 text-sm text-[#171a1f]"
              >
                <option value="recent">Most recent</option>
                <option value="name">Name A–Z</option>
              </select>
            </div>
            {loading ? (
              <p className="px-5 py-6 text-sm text-[#565d6d]">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[#565d6d]">No connections match your filters.</p>
            ) : (
              filtered.map((connection) => (
                <div
                  key={connection.id}
                  className="flex flex-wrap items-center gap-3 border-b border-[#eef0f4] px-5 py-4 last:border-b-0"
                >
                  <Avatar initials={initialsOf(connection.person_name)} />
                  <div className="min-w-24 flex-1 [overflow-wrap:anywhere]">
                    <p className="break-words text-sm font-bold text-[#171a1f]">
                      {connection.person_name}
                    </p>
                    <p className="text-xs text-[#565d6d]">
                      {ROLE_LABELS[connection.person_role] ?? connection.person_role}
                      {connection.person_location ? ` · ${connection.person_location}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    className="min-h-11 rounded-lg px-4 text-xs"
                    disabled={!!busyId}
                    aria-label={`Message ${connection.person_name}`}
                    onClick={() => openThread(connection.person_id, connection.person_name)}
                  >
                    {busyId === connection.person_id ? 'Opening…' : 'Message'}
                  </Button>
                  <div className="w-full"><FormMessage error={actionId === connection.person_id ? error : null} /></div>
                </div>
              ))
            )}
          </Card>
          </>}
        </section>

        <aside className="min-w-0 space-y-5">
          <Card className="p-5">
            <h2 className="text-sm font-bold">Find connections</h2>
            <div className="mt-3 flex flex-col gap-3">
              <Link href={searchHref} className="rounded-lg border border-primary-strong px-4 py-3 text-center text-sm font-semibold text-primary-strong">Search profiles</Link>
              <Link href={recommendationsHref} className="rounded-lg border border-border px-4 py-3 text-center text-sm font-semibold">View recommendations</Link>
            </div>
          </Card>
          <Card className="p-5">
            <h2 ref={suggestionsHeading} tabIndex={-1} className="text-sm font-bold text-[#171a1f]">People you may know</h2>
            <div className="mt-4 space-y-3">
              {!suggestions ? (
                <p role="status" className="text-sm text-[#565d6d]">Loading suggestions…</p>
              ) : suggestions.failed ? (
                <div role="alert" className="text-sm text-[#565d6d]">
                  <p>Could not load suggestions right now.</p>
                  {/* The button goes away while they load, so focus waits on the card's heading, not the page body. */}
                  <Button variant="secondary" className="mt-3" onClick={() => { suggestionsHeading.current?.focus(); setSuggestions(null); setSuggestionsAttempt((value) => value + 1); }}>
                    Try again<span className="sr-only"> loading suggestions</span>
                  </Button>
                </div>
              ) : suggestions.items.length === 0 ? (
                <p className="text-sm text-[#565d6d]">No suggestions right now.</p>
              ) : (
                suggestions.items.map((person) => (
                  <div key={person.id} className="flex flex-wrap items-center gap-3">
                    <Avatar initials={initialsOf(person.full_name)} />
                    <div className="min-w-24 flex-1 [overflow-wrap:anywhere]">
                      <p className="break-words text-sm font-bold text-[#171a1f]">
                        {person.full_name}
                      </p>
                      <p className="text-xs text-[#565d6d]">
                        {ROLE_LABELS[person.role] ?? person.role}
                      </p>
                    </div>
                    {person.connection_status === 'pending' ? (
                      <span className="rounded-full bg-[#fff4e5] px-2.5 py-1 text-[11px] font-medium text-[#b45309]">
                        Pending
                      </span>
                    ) : person.connection_status === 'accepted' ? (
                      <Button
                        variant="secondary"
                        className="min-h-11 rounded-lg px-3 text-xs"
                        disabled={!!busyId}
                        onClick={() => openThread(person.id, person.full_name)}
                      >
                        {busyId === person.id ? 'Opening…' : 'Message'}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="min-h-11 rounded-lg px-3 text-xs"
                        disabled={!!busyId}
                        aria-label={`Connect with ${person.full_name}`}
                        onClick={() => connect(person.id)}
                      >
                        Connect
                      </Button>
                    )}
                    <div className="w-full"><FormMessage error={actionId === person.id ? error : null} /></div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </aside>
      </div>}

      <Modal open={!!declining} title="Decline connection request?" onClose={() => setDeclining(null)} busy={!!busyId}>
        <p>
          You and {declining?.person_name} won&apos;t be connected, so you can&apos;t message each other from your network. After that, only you can send a new request. Removing it under Declined requests lets them ask again.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={!!busyId} onClick={() => setDeclining(null)}>Keep request</Button>
          <Button type="button" variant="destructive" disabled={!!busyId} onClick={() => void confirmDecline()}>
            {busyId ? 'Declining…' : 'Decline request'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#f0f1ff] text-sm font-bold text-primary-strong">
      {initials}
    </div>
  );
}
