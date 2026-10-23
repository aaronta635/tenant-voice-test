'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import TenantMatches from '@/app/components/tenant/TenantMatches';
import ConnectButton from '@/app/components/trust/ConnectButton';
import RatingBadge from '@/app/components/trust/RatingBadge';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { api, ApiError } from '@/app/lib/api';
import { searchMembers, type MemberSearchResult } from '@/app/lib/connections';
import { initialsOf, ROLE_LABELS } from '@/app/lib/format';

type PersonRole = '' | 'tenant' | 'landlord' | 'service_provider';

/**
 * People + property recommendations (taupe Recommendations page layout). The
 * properties are the tenant's matches from the server (TenantMatches); the
 * people are filtered here by the options picked beside them.
 */
export default function NetworkRecommendations({
  signedIn,
  messagesHref = '/tenant/messages',
  propertyHrefBase = '/tenant/properties',
  showProperties = true,
  clientsOnly = false,
}: {
  signedIn: boolean;
  messagesHref?: string;
  propertyHrefBase?: string;
  /** The tenant's matched homes and landlords (TenantMatches); owners and providers want people only. */
  showProperties?: boolean;
  clientsOnly?: boolean;
}) {
  const router = useRouter();
  const [people, setPeople] = useState<MemberSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [personRole, setPersonRole] = useState<PersonRole>('');
  const [location, setLocation] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({
    personRole: '' as PersonRole,
    location: '',
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const profiles = await (signedIn ? (clientsOnly
          ? Promise.all([
              searchMembers({ role: 'landlord', limit: 24 }),
              searchMembers({ role: 'tenant', limit: 24 }),
            ]).then(([owners, tenants]) => [...owners, ...tenants])
          : searchMembers({ limit: 24 })) : Promise.resolve([]));
        if (!active) return;
        setPeople(profiles);
      } catch (err) {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Could not load recommendations.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [signedIn, clientsOnly, attempt]);

  const suggestedPeople = useMemo(() => {
    const loc = appliedFilters.location.trim().toLowerCase();
    return people
      .filter((p) => {
        if (appliedFilters.personRole && p.role !== appliedFilters.personRole) return false;
        if (!loc) return true;
        return (
          (p.location ?? '').toLowerCase().includes(loc) ||
          (p.state ?? '').toLowerCase().includes(loc)
        );
      })
      .slice(0, 6);
  }, [people, appliedFilters]);

  async function messagePerson(person: MemberSearchResult) {
    setBusyId(person.id);
    setError(null);
    try {
      const thread = await api.conversations.startRental({
        peer_id: person.id,
        subject: `Chat with ${person.full_name}`,
      });
      router.push(`${messagesHref}?thread=${thread.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not start a conversation with this person.',
      );
    } finally {
      setBusyId(null);
    }
  }

  function applyFilters() {
    setAppliedFilters({ personRole, location });
  }

  function resetFilters() {
    setPersonRole('');
    setLocation('');
    setAppliedFilters({ personRole: '', location: '' });
  }

  return (
    <div className="space-y-6">
      {!signedIn ? (
        <p className="rounded-[12px] border border-[#dde1ff] bg-[#f0f1ff] px-4 py-3 text-sm text-[#3f46b0]">
          <Link href="/login" className="font-semibold underline">
            Sign in
          </Link>{' '}
          to see homes matched to your preferences, people recommendations and connection actions.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-[12px] border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 space-y-10">
          {signedIn && showProperties ? <TenantMatches propertyHrefBase={propertyHrefBase} /> : null}

          <div>
            <h2 className="mb-4 text-lg font-bold text-[#171a1f]">{clientsOnly ? 'Potential clients' : 'People You Might Know'}</h2>
            {/* Only the people read failed: the matches above load and fail on their own. */}
            {loadError ? (
              <LoadErrorCard title="People suggestions could not be loaded" message={loadError} onRetry={() => {
                setLoadError(null);
                setLoading(true);
                setAttempt((value) => value + 1);
              }} />
            ) : loading ? (
              <p className="text-sm text-[#565d6d]">Loading…</p>
            ) : suggestedPeople.length === 0 ? (
              <Card className="rounded-[16px] border border-[#dee1e6] p-6 text-sm text-[#565d6d] shadow-none">
                No people suggestions match your filters.
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {suggestedPeople.map((person) => (
                  <Card
                    key={person.id}
                    className="rounded-[16px] border border-[#dee1e6] p-5 text-center shadow-none"
                  >
                    <div aria-hidden="true" className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#f0f1ff] text-base font-bold text-primary-strong">
                      {initialsOf(person.full_name)}
                    </div>
                    <div className="mt-3 flex min-w-0 items-start justify-center gap-1.5">
                      <h3 className="min-w-0 break-words text-sm font-bold text-[#171a1f]">{person.full_name}</h3>
                      {person.verified ? <VerifiedBadge size="sm" className="mt-0.5" /> : null}
                    </div>
                    <p className="mt-1 text-xs font-medium uppercase tracking-wide text-[#565d6d]">
                      {ROLE_LABELS[person.role] ?? person.role}
                    </p>
                    <p className="mx-auto mt-2 min-h-[32px] max-w-[180px] text-xs leading-4 text-[#565d6d]">
                      {[person.location, person.state].filter(Boolean).join(', ') || 'Australia'}
                    </p>
                    {/* The rating their profile shows: the same reviews counted (R23). */}
                    <div className="mt-1 flex justify-center">
                      <RatingBadge average={person.rating_avg} count={person.review_count} />
                    </div>
                    <ConnectButton
                      userId={person.id}
                      name={person.full_name}
                      signedIn
                      initialState={person.connection}
                      compact
                      className="mt-4"
                      connectedAction={
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth
                          disabled={busyId === person.id}
                          aria-label={`Message ${person.full_name}`}
                          onClick={() => messagePerson(person)}
                        >
                          {busyId === person.id ? 'Opening…' : 'Message'}
                        </Button>
                      }
                    />
                  </Card>
                ))}
              </div>
            )}
          </div>

        </section>

        <aside>
          <Card className="rounded-[16px] border border-[#dee1e6] p-5 shadow-none">
            <h2 className="text-sm font-bold text-[#171a1f]">Refine people</h2>
            <div className="mt-5 space-y-5">
              <div>
                <p className="text-xs font-semibold text-[#565d6d]">Person Type</p>
                <div className="mt-2 space-y-2">
                  {(
                    [
                      { value: '', label: 'All Types' },
                      { value: 'tenant', label: 'Tenants' },
                      { value: 'landlord', label: 'Property Owners' },
                      { value: 'service_provider', label: 'Providers' },
                    ] as const
                  ).filter((option) => !clientsOnly || option.value !== 'service_provider').map((option) => (
                    <label
                      key={option.value || 'all'}
                      className="flex cursor-pointer items-center gap-2 text-sm text-[#171a1f]"
                    >
                      <input
                        type="radio"
                        name="person-type"
                        checked={personRole === option.value}
                        onChange={() => setPersonRole(option.value)}
                        className="accent-primary"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>

              <Input
                label="Location"
                placeholder="e.g. Sydney, NSW"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="h-10 rounded-[8px] bg-white"
              />


              <Button fullWidth className="h-10 rounded-[10px]" onClick={applyFilters}>
                Apply Filters
              </Button>
              <Button
                variant="ghost"
                fullWidth
                className="h-10 rounded-[10px] bg-[#f8f9fa]"
                onClick={resetFilters}
              >
                Reset
              </Button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
