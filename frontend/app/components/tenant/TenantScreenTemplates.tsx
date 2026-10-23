'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import DemoLabel from '@/app/components/demo/DemoLabel';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import NotificationsView from '@/app/components/network/NotificationsView';
import ProfileSearchView from '@/app/components/network/ProfileSearchView';
import RentalMessages from '@/app/components/rental/RentalMessages';
import ReviewWizard, { type ReviewWizardStep } from '@/app/components/rental/ReviewWizard';
import SupportChat from '@/app/components/support/SupportChat';
import {
  api,
  ApiError,
  safe,
  type Application,
  type Connection,
  type Faq,
  type Plan,
  type Profile,
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
import { completionFor, PageFrame } from '@/app/components/tenant/TenantPageFrame';
import TenantFormScreens, {
  ProfileCompletionScreen,
} from '@/app/components/tenant/TenantFormScreens';

export default function TenantScreenTemplates({ screen }: { screen: TenantScreen }) {
  if (screen.kind === 'messages') return <MessagesScreen />;
  if (screen.kind === 'notifications') {
    return (
      <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
        <NotificationsView
          title={screen.title}
          subtitle={screen.description}
        />
      </main>
    );
  }
  if (screen.kind === 'subscription') return <SubscriptionScreen screen={screen} />;
  if (screen.kind === 'support') return <SupportScreen screen={screen} />;
  if (screen.kind === 'profile') return <ProfileScreen screen={screen} />;
  if (screen.kind === 'review') return <ReviewScreen screen={screen} />;
  if (screen.kind === 'connections') return <ConnectionsScreen screen={screen} />;
  if (screen.kind === 'score') return <ScoreScreen screen={screen} />;
  if (screen.kind === 'checklist') return <ProfileCompletionScreen screen={screen} />;
  if (screen.kind === 'cards') return <CardsScreen screen={screen} />;
  return <TenantFormScreens screen={screen} />;
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


function CardsScreen({ screen }: { screen: TenantScreen }) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function retryLoad() {
    setLoading(true);
    setError(null);
    Promise.all([api.properties.listPublic({ limit: 6 }), api.applications.listMine()])
      .then(([propertyList, applicationList]) => {
        setProperties(propertyList);
        setApplications(applicationList);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load recommendations.');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let active = true;
    Promise.all([api.properties.listPublic({ limit: 6 }), api.applications.listMine()])
      .then(([propertyList, applicationList]) => {
        if (!active) return;
        setProperties(propertyList);
        setApplications(applicationList);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : 'Could not load recommendations.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
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
      ) : error ? (
        <Card className="rounded-[16px] border border-[#dee1e6] p-6 text-center">
          <p className="text-sm text-[#de3b40]">{error}</p>
          <Button variant="secondary" className="mt-4 h-10 rounded-[8px]" onClick={retryLoad}>
            Try again
          </Button>
        </Card>
      ) : suggestions.length === 0 ? (
        <Card className="rounded-[16px] border border-[#dee1e6] p-6 text-sm text-[#565d6d]">
          {properties.length === 0
            ? 'No properties are listed yet. Check back soon.'
            : "Nothing new to show — you've applied for every listed property."}
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
    return (
      <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
        <Suspense fallback={<p className="text-sm text-[#565d6d]">Loading…</p>}>
          <ProfileSearchView
            title={screen.title}
            subtitle={screen.description}
            messagesHref="/tenant/messages"
          />
        </Suspense>
      </main>
    );
  }
  return <NetworkScreen screen={screen} />;
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
      <DemoLabel
        variant="notice"
        className="mb-6"
        reason="No payment is taken: choosing a pass records it on your account, and it does not change what you can read yet."
      />
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
      <SupportChat audience="tenant" className="mb-6" />
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
      <DemoLabel
        variant="notice"
        className="mb-6"
        reason="This score is worked out on this page from your profile, applications and connections. It is not a scorecard from an owner: ask an owner for one from the Scorecards card on your dashboard."
      />
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
