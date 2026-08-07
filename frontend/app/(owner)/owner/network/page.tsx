'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import { ChevronRightIcon } from '@/app/components/owner/icons';
import { api, ApiError, safe, type Connection } from '@/app/lib/api';
import { initialsOf, relativeTime, ROLE_LABELS } from '@/app/lib/format';

export default function NetworkConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    safe(api.connections.list(), []).then((list) => {
      if (!active) return;
      setConnections(list);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const requests = useMemo(
    () => connections.filter((c) => c.status === 'pending' && c.direction === 'incoming'),
    [connections],
  );
  const accepted = useMemo(
    () => connections.filter((c) => c.status === 'accepted'),
    [connections],
  );

  async function respond(id: string, status: 'accepted' | 'declined') {
    setBusyId(id);
    setError(null);
    try {
      const updated = await api.connections.respond(id, status);
      setConnections((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not answer that request.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-dark sm:text-[36px]">Network</h1>
        <p className="mt-2 text-lg text-text-body">
          Review connection requests and manage your established professional network.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </p>
      ) : null}

      <div>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="font-heading text-xl font-semibold text-text-dark">Incoming Requests</h2>
          {requests.length > 0 ? (
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {requests.length} New
            </span>
          ) : null}
        </div>
        {loading ? (
          <p className="text-text-body">Loading your network…</p>
        ) : requests.length === 0 ? (
          <p className="text-text-body">No pending connection requests.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {requests.map((request) => (
              <Card key={request.id} className="flex items-center gap-4 p-5">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-bold text-navy">
                  {initialsOf(request.person_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-text-dark">{request.person_name}</p>
                  <p className="text-sm text-text-body">
                    {ROLE_LABELS[request.person_role] ?? request.person_role} ·{' '}
                    {relativeTime(request.created_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="border-[#de3b40]/30 text-[#de3b40]"
                    disabled={busyId === request.id}
                    onClick={() => respond(request.id, 'declined')}
                  >
                    Decline
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busyId === request.id}
                    onClick={() => respond(request.id, 'accepted')}
                  >
                    Accept
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 font-heading text-xl font-semibold text-text-dark">
          Your Connections
          {accepted.length > 0 ? (
            <span className="ml-2 text-sm font-normal text-text-body">{accepted.length} total</span>
          ) : null}
        </h2>
        {loading ? null : accepted.length === 0 ? (
          <p className="text-text-body">You haven&apos;t connected with anyone yet.</p>
        ) : (
          <Card className="overflow-hidden p-0">
            {accepted.map((connection) => (
              <div
                key={connection.id}
                className="flex w-full items-center gap-4 border-b border-border px-6 py-5 text-left last:border-b-0"
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-bold text-navy">
                  {initialsOf(connection.person_name)}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-text-dark">{connection.person_name}</p>
                  <p className="text-sm text-text-body">
                    {ROLE_LABELS[connection.person_role] ?? connection.person_role}
                    {connection.person_location ? ` · ${connection.person_location}` : ''}
                  </p>
                </div>
                <ChevronRightIcon size={20} className="shrink-0 text-text-muted opacity-50" />
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
