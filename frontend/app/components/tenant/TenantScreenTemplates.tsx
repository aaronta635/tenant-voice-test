'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import RentalMessages from '@/app/components/rental/RentalMessages';
import ReviewWizard, { type ReviewWizardStep } from '@/app/components/rental/ReviewWizard';
import {
  api,
  ApiError,
  safe,
  type Application,
  type Connection,
  type Faq,
  type NotificationItem,
  type Plan,
  type Profile,
  type ProfileSearchResult,
  type Property,
  type Subscription,
} from '@/app/lib/api';
import {
  formatDate,
  formatMoney,
  initialsOf,
  relativeTime,
  ROLE_LABELS,
} from '@/app/lib/format';
import type { TenantScreen } from '@/app/lib/tenant-data';

export default function TenantScreenTemplates({ screen }: { screen: TenantScreen }) {
  if (screen.kind === 'messages') return <MessagesScreen />;
  if (screen.kind === 'notifications') return <NotificationsScreen screen={screen} />;
  if (screen.kind === 'subscription') return <SubscriptionScreen screen={screen} />;
  if (screen.kind === 'support') return <SupportScreen screen={screen} />;
  if (screen.kind === 'profile') return <ProfileScreen screen={screen} />;
  if (screen.kind === 'review') return <ReviewScreen screen={screen} />;
  if (screen.kind === 'connections') return <ConnectionsScreen screen={screen} />;
  if (screen.kind === 'score') return <ScoreScreen screen={screen} />;
  if (screen.kind === 'cards') return <CardsScreen screen={screen} />;
  return <FormScreen screen={screen} />;
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------
function PageFrame({
  screen,
  children,
  side,
}: {
  screen: TenantScreen;
  children: React.ReactNode;
  side?: React.ReactNode;
}) {
  return (
    <main className="mx-auto grid w-full max-w-[1240px] gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          {screen.eyebrow ?? 'Tenant workspace'}
        </p>
        <h1 className="mt-2 font-heading text-[30px] font-semibold leading-9 tracking-tight text-[#171a1f]">
          {screen.title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[#565d6d]">{screen.description}</p>
        <div className="mt-8">{children}</div>
      </section>
      <aside className="space-y-6">{side ?? <DefaultSide />}</aside>
    </main>
  );
}

/** Profile-completion percentage derived from the fields a tenant has filled in. */
function completionFor(profile: Profile | null): number {
  if (!profile) return 0;
  const checks = [
    !!profile.full_name,
    !!profile.email,
    !!profile.phone,
    !!profile.location,
    !!profile.state,
    !!profile.avatar_url,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function DefaultSide() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [me, feed] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe(api.notifications.list(false, 3), []),
      ]);
      if (!active) return;
      setProfile(me);
      setNotifications(feed);
    })();
    return () => {
      active = false;
    };
  }, []);

  const completion = completionFor(profile);

  return (
    <>
      <Card className="rounded-[16px] border border-[#dee1e6] p-6">
        <h2 className="text-base font-bold">Profile Completion</h2>
        <div className="mt-6 h-2.5 rounded-full bg-[#e5e7eb]">
          <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
        </div>
        <div className="mt-4 flex justify-between text-sm">
          <span>{completion}% Complete</span>
          <Link href="/tenant/profile-completion" className="text-primary">
            Finish Setup ›
          </Link>
        </div>
      </Card>
      <Card className="rounded-[16px] border border-[#dee1e6] p-6">
        <h2 className="text-base font-bold">Recent Activity</h2>
        {notifications.length === 0 ? (
          <p className="mt-4 text-sm text-[#565d6d]">Nothing yet.</p>
        ) : (
          <ul className="mt-4 space-y-4 text-sm text-[#565d6d]">
            {notifications.map((item) => (
              <li key={item.id}>
                <span className="block text-[#171a1f]">{item.title}</span>
                <span className="text-xs">{relativeTime(item.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function MessagesScreen() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
      <RentalMessages />
    </main>
  );
}

function NotificationsScreen({ screen }: { screen: TenantScreen }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    safe(api.notifications.list(), []).then((list) => {
      if (!active) return;
      setItems(list);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const unread = items.filter((item) => !item.is_read).length;

  async function markAll() {
    await safe(api.notifications.markAllRead(), []);
    setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
  }

  return (
    <PageFrame screen={screen} side={<DefaultSide />}>
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-[#f0f1ff] px-3 py-1 text-sm font-medium text-primary">
          {unread} unread
        </span>
        <Button className="h-10 rounded-[8px]" onClick={markAll} disabled={unread === 0}>
          Mark all as read
        </Button>
      </div>
      <Card className="mt-6 overflow-hidden rounded-[12px] border border-[#dee1e6]">
        {loading ? (
          <p className="px-6 py-8 text-center text-sm text-[#565d6d]">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-[#565d6d]">No notifications yet.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-4 border-b border-[#f1f5f9] px-6 py-5 last:border-b-0"
            >
              <span className="mt-1 flex size-10 items-center justify-center rounded-full bg-[#f0f1ff] text-primary">
                🔔
              </span>
              <div className="flex-1">
                <p className="font-medium text-[#171a1f]">{item.title}</p>
                {item.body ? <p className="mt-1 text-sm text-[#565d6d]">{item.body}</p> : null}
                <p className="mt-1 text-sm text-[#565d6d]">{relativeTime(item.created_at)}</p>
              </div>
              {!item.is_read ? <span className="mt-2 size-2 rounded-full bg-primary" /> : null}
            </div>
          ))
        )}
      </Card>
    </PageFrame>
  );
}

function CardsScreen({ screen }: { screen: TenantScreen }) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const [propertyList, applicationList] = await Promise.all([
        safe(api.properties.listPublic({ limit: 6 }), []),
        safe(api.applications.listMine(), []),
      ]);
      if (!active) return;
      setProperties(propertyList);
      setApplications(applicationList);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const appliedIds = new Set(applications.map((app) => app.property_id));
  const suggestions = properties.filter((property) => !appliedIds.has(property.id));

  return (
    <PageFrame screen={screen}>
      {loading ? (
        <p className="text-sm text-[#565d6d]">Loading…</p>
      ) : suggestions.length === 0 ? (
        <Card className="rounded-[16px] border border-[#dee1e6] p-6 text-sm text-[#565d6d]">
          Nothing new to show — you&apos;ve applied for every listed property.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {suggestions.map((property) => (
            <Card key={property.id} className="rounded-[16px] border border-[#dee1e6] p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-heading text-lg font-semibold">{property.title}</h2>
                  <p className="mt-2 text-sm text-[#565d6d]">
                    {property.suburb ?? property.address} · {formatMoney(property.price)}/wk
                  </p>
                  <p className="mt-1 text-xs text-[#565d6d]">
                    Available {formatDate(property.available_from)}
                  </p>
                </div>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[#f0f1ff] text-primary">
                  ★
                </span>
              </div>
              <Link href={`/tenant/properties/${property.id}`}>
                <Button variant="secondary" className="mt-6 h-10 rounded-[8px]">
                  View details
                </Button>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </PageFrame>
  );
}

function ConnectionsScreen({ screen }: { screen: TenantScreen }) {
  if (screen.slug === 'search-profile' || screen.slug === 'recommendations') {
    return <SearchProfilesScreen screen={screen} />;
  }
  return <NetworkScreen screen={screen} />;
}

function SearchProfilesScreen({ screen }: { screen: TenantScreen }) {
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    safe(api.profiles.search({ search: query || undefined, role: role || undefined }), []).then(
      (list) => {
        if (!active) return;
        setResults(list);
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [query, role]);

  async function connect(id: string) {
    setBusyId(id);
    try {
      await api.connections.request(id);
      setResults((prev) =>
        prev.map((r) => (r.id === id ? { ...r, connection_status: 'pending' } : r)),
      );
    } catch {
      // Already connected or request failed; the row keeps its current state.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-[1240px] gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          Profile discovery
        </p>
        <h1 className="mt-2 font-heading text-[30px] font-semibold leading-9 tracking-tight text-[#171a1f]">
          {screen.title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[#565d6d]">{screen.description}</p>

        {loading ? (
          <p className="mt-6 text-sm text-[#565d6d]">Searching…</p>
        ) : results.length === 0 ? (
          <p className="mt-6 text-sm text-[#565d6d]">No profiles match that search.</p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {results.map((person) => (
              <Card
                key={person.id}
                className="rounded-[12px] border border-[#dee1e6] p-5 text-center"
              >
                <Avatar initials={initialsOf(person.full_name)} size="lg" />
                <h2 className="mt-4 text-sm font-bold text-[#171a1f]">{person.full_name}</h2>
                <p className="mt-1 text-xs font-medium text-[#565d6d]">
                  {ROLE_LABELS[person.role] ?? person.role}
                </p>
                <p className="mx-auto mt-2 min-h-[34px] max-w-[150px] text-xs leading-4 text-[#565d6d]">
                  {[person.location, person.state].filter(Boolean).join(', ') || 'Australia'}
                </p>
                <Button
                  variant={person.connection_status ? 'secondary' : 'primary'}
                  fullWidth
                  className="mt-4 h-9 rounded-[8px] text-xs"
                  disabled={!!person.connection_status || busyId === person.id}
                  onClick={() => connect(person.id)}
                >
                  {person.connection_status === 'accepted'
                    ? 'Connected'
                    : person.connection_status === 'pending'
                      ? 'Pending'
                      : 'Connect'}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      <aside className="h-fit rounded-[12px] border border-[#dee1e6] bg-white">
        <div className="flex items-center justify-between border-b border-[#eef0f4] px-5 py-4">
          <h2 className="text-sm font-bold text-[#171a1f]">Refine Results</h2>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setRole('');
            }}
            className="text-xs font-medium text-[#565d6d]"
          >
            Reset
          </button>
        </div>
        <div className="space-y-5 p-5">
          <Input
            aria-label="Search profiles"
            placeholder="Search names, areas..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 rounded-[8px] bg-white"
          />
          <div>
            <p className="text-xs font-semibold text-[#565d6d]">Role</p>
            <div className="mt-3 space-y-2">
              {[
                { value: '', label: 'All roles' },
                { value: 'landlord', label: 'Landlords' },
                { value: 'tenant', label: 'Tenants' },
                { value: 'service_provider', label: 'Service providers' },
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-sm text-[#171a1f]"
                >
                  <input
                    type="radio"
                    name="role-filter"
                    checked={role === option.value}
                    onChange={() => setRole(option.value)}
                    className="accent-primary"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}

function NetworkScreen({ screen }: { screen: TenantScreen }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const requests = connections.filter(
    (c) => c.status === 'pending' && c.direction === 'incoming',
  );
  const accepted = connections.filter((c) => c.status === 'accepted');

  async function respond(id: string, status: 'accepted' | 'declined') {
    setBusyId(id);
    try {
      const updated = await api.connections.respond(id, status);
      setConnections((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch {
      // Leave the row untouched if the request already changed server-side.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-[1240px] gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          Tenant network
        </p>
        <h1 className="mt-2 font-heading text-[30px] font-semibold leading-9 tracking-tight text-[#171a1f]">
          {screen.title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[#565d6d]">
          Manage incoming requests and existing professional connections.
        </p>

        <div className="mt-8 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#171a1f]">Incoming Requests</h2>
              <span className="rounded-full bg-[#f0f1ff] px-3 py-1 text-xs font-medium text-primary">
                {requests.length} Pending
              </span>
            </div>
            <div className="space-y-3">
              {loading ? (
                <p className="text-sm text-[#565d6d]">Loading…</p>
              ) : requests.length === 0 ? (
                <p className="text-sm text-[#565d6d]">No pending requests.</p>
              ) : (
                requests.map((request) => (
                  <Card key={request.id} className="rounded-[12px] border border-[#dee1e6] p-4">
                    <div className="flex items-center gap-3">
                      <Avatar initials={initialsOf(request.person_name)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{request.person_name}</p>
                        <p className="text-xs text-[#565d6d]">
                          {relativeTime(request.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        className="h-9 rounded-[8px] border-[#de3b40] text-[#de3b40]"
                        disabled={busyId === request.id}
                        onClick={() => respond(request.id, 'declined')}
                      >
                        Decline
                      </Button>
                      <Button
                        className="h-9 rounded-[8px]"
                        disabled={busyId === request.id}
                        onClick={() => respond(request.id, 'accepted')}
                      >
                        Accept
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#171a1f]">Your Connections</h2>
              <span className="text-xs font-medium text-[#565d6d]">{accepted.length} Total</span>
            </div>
            <Card className="overflow-hidden rounded-[12px] border border-[#dee1e6]">
              {accepted.length === 0 ? (
                <p className="px-4 py-6 text-sm text-[#565d6d]">No connections yet.</p>
              ) : (
                accepted.map((connection) => (
                  <div
                    key={connection.id}
                    className="flex items-center gap-3 border-b border-[#eef0f4] px-4 py-4 last:border-b-0"
                  >
                    <Avatar initials={initialsOf(connection.person_name)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{connection.person_name}</p>
                      <p className="text-xs text-[#565d6d]">
                        {ROLE_LABELS[connection.person_role] ?? connection.person_role}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </Card>
          </section>
        </div>
      </section>

      <aside className="space-y-5">
        <Card className="rounded-[12px] border border-[#dee1e6] p-5">
          <h2 className="text-sm font-bold text-[#171a1f]">Quick Actions</h2>
          <Link href="/tenant/search-profile">
            <Button fullWidth className="mt-4 h-10 rounded-[8px]">
              Find people to connect with
            </Button>
          </Link>
        </Card>
      </aside>
    </main>
  );
}

function ProfileScreen({ screen }: { screen: TenantScreen }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [me, apps, network] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe(api.applications.listMine(), []),
        safe(api.connections.list('accepted'), []),
      ]);
      if (!active) return;
      setProfile(me);
      setApplications(apps);
      setConnections(network);
    })();
    return () => {
      active = false;
    };
  }, []);

  const completion = completionFor(profile);
  const tags = [
    profile?.email ? 'Email on file' : null,
    profile?.phone ? 'Phone on file' : null,
    profile?.location ? 'Address on file' : null,
  ].filter((tag): tag is string => !!tag);

  return (
    <PageFrame screen={screen}>
      <Card className="rounded-[16px] border border-[#dee1e6] p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <Avatar initials={initialsOf(profile?.full_name)} size="lg" />
          <div className="flex-1">
            <h2 className="font-heading text-2xl font-bold">{profile?.full_name ?? '—'}</h2>
            <p className="text-[#565d6d]">
              {ROLE_LABELS[profile?.role ?? ''] ?? 'Tenant'} ·{' '}
              {[profile?.location, profile?.state].filter(Boolean).join(', ') || 'Australia'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[#f0f1ff] px-3 py-1 text-xs font-medium text-primary"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Stat value={`${completion}%`} label="Complete" />
          <Stat value={String(applications.length)} label="Applications" />
          <Stat value={String(connections.length)} label="Connections" />
        </div>
      </Card>
    </PageFrame>
  );
}

function FormScreen({ screen }: { screen: TenantScreen }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: '', phone: '', location: '', postcode: '' });

  useEffect(() => {
    let active = true;
    safe<Profile | null>(api.profiles.me(), null).then((me) => {
      if (!active) return;
      setProfile(me);
      setForm({
        full_name: me?.full_name ?? '',
        phone: me?.phone ?? '',
        location: [me?.location, me?.state].filter(Boolean).join(', '),
        postcode: me?.postcode ?? '',
      });
    });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const [suburb, state] = form.location.split(',').map((part) => part.trim());
      setProfile(
        await api.profiles.update({
          full_name: form.full_name,
          phone: form.phone || null,
          location: suburb || null,
          state: state || null,
          postcode: form.postcode || null,
        }),
      );
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your details.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageFrame screen={screen}>
      <Card className="rounded-[16px] border border-[#dee1e6] p-6">
        <div className="grid gap-5 md:grid-cols-2">
          <Input
            label="Full Name"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
          />
          <Input label="Email" value={profile?.email ?? ''} readOnly />
          <Input
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <Input
            label="Suburb, State"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          />
          <Input
            label="Postcode"
            value={form.postcode}
            onChange={(e) => setForm((f) => ({ ...f, postcode: e.target.value }))}
          />
        </div>
        {error ? <p className="mt-4 text-sm text-[#de3b40]">{error}</p> : null}
        {saved ? <p className="mt-4 text-sm text-[#1b7c4f]">Saved.</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <Button className="h-10 rounded-[8px]" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </Card>
    </PageFrame>
  );
}

function ReviewScreen({ screen }: { screen: TenantScreen }) {
  const initialStepBySlug: Partial<Record<string, ReviewWizardStep>> = {
    'write-review': 'property',
    'visual-flow': 'property',
    'tenancy-confirmation': 'tenancy',
    'star-ratings': 'ratings',
    'detailed-review': 'details',
    'photo-upload': 'photos',
    'financial-pricing-review': 'financial',
    'submit-review': 'submit',
  };

  return (
    <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
        Ratings &amp; Reviews
      </p>
      <h1 className="mt-2 font-heading text-[30px] font-semibold leading-9 tracking-tight text-[#171a1f]">
        {screen.title}
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-[#565d6d]">{screen.description}</p>
      <div className="mt-8">
        <ReviewWizard initialStep={initialStepBySlug[screen.slug] ?? 'property'} />
      </div>
    </main>
  );
}

function SubscriptionScreen({ screen }: { screen: TenantScreen }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [planList, mine, me] = await Promise.all([
        safe(api.subscriptions.plans('tenant'), []),
        safe<Subscription | null>(api.subscriptions.mine(), null),
        safe<Profile | null>(api.profiles.me(), null),
      ]);
      if (!active) return;
      setPlans(planList);
      setSubscription(mine);
      setProfile(me);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function choose(planId: string) {
    setBusy(true);
    try {
      setSubscription(await api.subscriptions.select(planId));
      setPlans(await api.subscriptions.plans('tenant'));
    } catch {
      // Keep the current selection if the change fails.
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageFrame screen={screen}>
      {plans.length === 0 ? (
        <p className="text-sm text-[#565d6d]">No access passes are configured yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {plans.map((plan) => (
            <Card key={plan.id} className="rounded-[16px] border border-[#dee1e6] p-6">
              <h2 className="font-heading text-xl font-semibold">{plan.name}</h2>
              <p className="mt-1 text-sm text-[#565d6d]">
                {plan.billing_period === 'one-time' ? 'One Time Purchase' : `Per ${plan.billing_period}`}
              </p>
              <p className="mt-8 font-heading text-3xl font-bold">{formatMoney(plan.price)}</p>
              {plan.description ? (
                <p className="mt-2 text-sm text-[#565d6d]">{plan.description}</p>
              ) : null}
              <Button
                fullWidth
                className="mt-6 h-12 rounded-[10px]"
                disabled={busy || plan.is_current}
                onClick={() => choose(plan.id)}
              >
                {plan.is_current ? 'Current access' : 'Pay for Access'}
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-8 rounded-[16px] border border-[#dee1e6] p-6">
        <h2 className="font-heading text-xl font-semibold">Billing Information</h2>
        <dl className="mt-5 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-[#565d6d]">Name</dt>
            <dd className="font-medium">{profile?.full_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[#565d6d]">Email</dt>
            <dd className="font-medium">{profile?.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[#565d6d]">Status</dt>
            <dd className="font-medium capitalize">{subscription?.status ?? 'none'}</dd>
          </div>
          <div>
            <dt className="text-[#565d6d]">Renewal</dt>
            <dd className="font-medium">{formatDate(subscription?.renews_at)}</dd>
          </div>
        </dl>
      </Card>
    </PageFrame>
  );
}

function SupportScreen({ screen }: { screen: TenantScreen }) {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    safe(api.content.faqs('tenant'), []).then((list) => {
      if (!active) return;
      setFaqs(list);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <PageFrame screen={screen}>
      {loading ? (
        <p className="text-sm text-[#565d6d]">Loading help topics…</p>
      ) : faqs.length === 0 ? (
        <p className="text-sm text-[#565d6d]">No help topics published yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {faqs.map((faq) => (
            <Card key={faq.id} className="rounded-[16px] border border-[#dee1e6] p-6">
              <h2 className="font-heading text-lg font-semibold">{faq.question}</h2>
              <p className="mt-2 text-sm text-[#565d6d]">{faq.answer}</p>
            </Card>
          ))}
        </div>
      )}
    </PageFrame>
  );
}

function ScoreScreen({ screen }: { screen: TenantScreen }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [me, apps, network] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe(api.applications.listMine(), []),
        safe(api.connections.list('accepted'), []),
      ]);
      if (!active) return;
      setProfile(me);
      setApplications(apps);
      setConnections(network);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Each band is derived from real records; the headline score is their average.
  const bands = [
    { label: 'Profile details', value: completionFor(profile) },
    {
      label: 'Application history',
      value: Math.min(100, applications.length * 25),
    },
    {
      label: 'References & network',
      value: Math.min(100, connections.length * 20),
    },
    {
      label: 'Owner scoring',
      value: Math.round(
        (applications.reduce((sum, app) => sum + (app.tenant_score ?? 0), 0) /
          Math.max(applications.filter((a) => a.tenant_score !== null).length, 1)) *
          10,
      ),
    },
  ];
  const score = Math.round(bands.reduce((sum, band) => sum + band.value, 0) / bands.length);

  return (
    <PageFrame screen={screen}>
      <Card className="rounded-[16px] border border-[#dee1e6] p-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-xl font-semibold">Tenant readiness score</h2>
            <p className="mt-1 text-sm text-[#565d6d]">
              Based on your profile, applications, network and owner scoring.
            </p>
          </div>
          <p className="font-heading text-5xl font-bold text-primary">{score}</p>
        </div>
        <div className="mt-8 space-y-4">
          {bands.map((band) => (
            <div key={band.label}>
              <div className="flex justify-between text-sm">
                <span>{band.label}</span>
                <span>{band.value}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[#e5e7eb]">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, band.value)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </PageFrame>
  );
}

// ---------------------------------------------------------------------------
// Small primitives
// ---------------------------------------------------------------------------
function Avatar({ initials, size = 'md' }: { initials: string; size?: 'md' | 'lg' }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-[#f0f1ff] font-bold text-primary ${
        size === 'lg' ? 'size-20 text-xl' : 'size-11 text-sm'
      }`}
    >
      {initials}
    </span>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[12px] bg-[#fafafb] p-5 text-center">
      <p className="font-heading text-3xl font-bold text-primary">{value}</p>
      <p className="mt-1 text-sm text-[#565d6d]">{label}</p>
    </div>
  );
}
