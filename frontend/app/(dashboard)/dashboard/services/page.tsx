'use client';

import { Suspense, useEffect, useEffectEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  api,
  ApiError,
  orNotFound,
  type ProviderDashboard,
  type ProviderService,
  type ServiceProvider,
} from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatMoneyExact, formatPercent, formatServicePrice } from '@/app/lib/format';
import { ADD_SERVICE_HREF } from '@/app/lib/list-options';
import { setSearchParams } from '@/app/lib/page-url';
import { providerHref } from '@/app/lib/provider-view';
import StatCard from '@/app/components/ui/StatCard';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import FormMessage from '@/app/components/ui/FormMessage';
import Modal from '@/app/components/ui/Modal';
import EmptyState from '@/app/components/ui/EmptyState';
import ServiceEditor from '@/app/components/provider/ServiceEditor';

export default function ServicesPage() {
  return <Suspense fallback={<p role="status">Loading services…</p>}><Services /></Suspense>;
}

function Services() {
  // "List your service" opens ADD_SERVICE_HREF: the new-service form, once the
  // provider profile it belongs to has loaded, also when chosen on this page.
  const addRequested = useSearchParams().get('new') === '1';
  const page = useRef<HTMLDivElement>(null);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [stats, setStats] = useState<ProviderDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [removing, setRemoving] = useState<ProviderService | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  // undefined = closed, null = new service, otherwise the service being edited.
  const [editing, setEditing] = useState<ProviderService | null | undefined>(undefined);
  const openRequestedForm = useEffectEvent(() => {
    // Once: a reload after closing the form shows the list.
    setSearchParams({ new: null });
    openEditor(null);
  });
  useEffect(() => {
    if (addRequested && !loading && provider) openRequestedForm();
  }, [addRequested, loading, provider]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const mine = await orNotFound<ServiceProvider | null>(api.providers.mine(), null);
        if (!active) return;
        setProvider(mine);
        if (mine) {
          const [list, dashboard] = await Promise.all([api.providers.myServices(), api.dashboard.provider()]);
          if (!active) return;
          setServices(list); setStats(dashboard);
        }
      } catch (err) {
        if (active) setLoadError(err instanceof Error ? err.message : 'Could not load services.');
      } finally { if (active) setLoading(false); }

    })();
    return () => {
      active = false;
    };
  }, [attempt]);

  async function togglePublished(service: ProviderService) {
    if (busyId) return;
    setActionId(service.id);
    setNotice(null);
    setBusyId(service.id);
    setError(null);
    try {
      const updated = await api.providers.updateService(service.id, {
        is_active: !service.is_active,
      });
      setServices((prev) => prev.map((s) => (s.id === service.id ? updated : s)));
      setNotice(`${service.title} ${updated.is_active ? "enabled" : "saved as draft"}.${!provider?.is_published && updated.is_active ? " Your profile is not published yet." : ""}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that service.');
    } finally {
      setBusyId(null);
    }
  }

  function openEditor(service: ProviderService | null) {
    // Clear the last result, so the next one is read out even if it reads the same.
    setNotice(null);
    setError(null);
    setEditing(service);
  }

  function handleSaved(saved: ProviderService) {
    setServices((prev) =>
      prev.some((s) => s.id === saved.id) ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved],
    );
    // A new row's region would arrive already holding the result, so an
    // added service's result goes to the page-wide region instead.
    setActionId(editing ? saved.id : null);
    setNotice(`${saved.title} ${editing ? "updated" : "added"}.`);
    setEditing(undefined);
  }

  async function removeService(service: ProviderService) {
    if (busyId) return;
    setRemoving(null);
    setActionId(service.id);
    setNotice(null);
    setBusyId(service.id);
    setError(null);
    try {
      await api.providers.deleteService(service.id);
      setServices((prev) => prev.filter((s) => s.id !== service.id));
      setActionId(null);
      setNotice(`${service.title} removed.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that service.');
    } finally {
      setBusyId(null);
    }
  }

  // Move focus to the result, unless the provider has moved on while it
  // saved, say to the header search.
  useEffect(() => {
    if (notice || error) {
      const feedback = document.getElementById(`service-feedback-${actionId ?? 'global'}`);
      focusResult(feedback, page.current);
    }
  }, [notice, error, actionId]);

  const published = services.filter((s) => s.is_active).length;
  const draft = services.length - published;

  const statCards = [
    {
      label: 'Total services',
      value: String(services.length),
      hint: `${published} enabled · ${draft} draft${provider?.is_published ? "" : " · Profile not published"}`,
    },
    {
      label: 'Active bookings',
      value: stats ? String(stats.active_bookings) : '—',
      hint: stats ? `${stats.due_this_week} due in the next 7 days` : '',
    },
    {
      label: 'Earned this month',
      value: stats ? formatMoneyExact(stats.month_earnings) : '—',
      hint:
        stats?.month_change_pct === null || stats === null
          ? ''
          : `${formatPercent(stats.month_change_pct)} vs same period last month`,
    },
    {
      label: 'Booking conversion',
      value: stats?.booking_conversion_pct !== null && stats ? `${stats.booking_conversion_pct}%` : '—',
      hint: stats ? `${stats.decided_enquiries ?? "—"} decided enquiries` : '',
    },
  ];

  return (
    <div ref={page}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary-strong">Provider workspace</p>
          <h1 className="font-heading text-h2 font-semibold text-text-dark">
            My services
          </h1>
          <p className="mt-1 max-w-2xl text-[#5f6b76]">
            Define what you offer, set clear prices and control where you&apos;ll travel —
            all from one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {provider?.is_published ? (
            <Link
              href={providerHref(provider)}
              className="inline-flex min-h-11 items-center rounded-lg border border-control-border bg-white px-4 text-sm font-semibold"
            >
              Preview public profile
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => openEditor(null)}
            disabled={loading || !!loadError || !provider}
            className="order-first inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            Add new service
          </button>
        </div>
      </div>

      {!loading && !loadError && provider ? <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statCards.map((stat) => <StatCard key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} />)}
      </div> : null}

      {/* Blank, not unmounted, while a row's action runs: a removal's or a
          new service's result lands here, and a live region added along
          with its text is often not read out. */}
      <div id="service-feedback-global" tabIndex={-1} className="scroll-mt-24"><FormMessage error={actionId ? null : error} success={actionId ? null : notice} className="mt-4" /></div>
      {!loading && !loadError && provider && !provider.is_published ? <p className="mt-5 rounded-xl border border-warning bg-warning/10 p-4 text-sm text-warning">Your profile is not public yet. Enabled services will appear when you <Link href="/dashboard/onboarding" className="font-bold underline">finish setup and publish</Link>.</p> : null}

      <div className="mt-8 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-[#efeff2] px-5 py-4">
          <h2 className="font-bold text-[#1b1b1f]">Your services</h2>
        </div>
        {loading ? (
          <p role="status" className="px-5 py-8 text-center text-sm text-[#5f6b76]">Loading services…</p>
        ) : loadError ? <LoadErrorCard message={loadError} onRetry={() => { setLoadError(null); setLoading(true); setAttempt((n) => n + 1); }} /> : !provider ? <EmptyState title="Create your provider profile" description="Finish the first onboarding step before adding services." action={<Link href={addRequested ? `/dashboard/onboarding?${new URLSearchParams({ next: ADD_SERVICE_HREF })}` : '/dashboard/onboarding'} className="font-bold text-primary-strong underline">Start onboarding</Link>} /> : services.length === 0 ? (
          <EmptyState title="No services yet" description="Add a service and price so clients know what you offer." action={<button type="button" className="min-h-11 rounded-lg bg-primary-strong px-4 font-bold text-white" onClick={() => openEditor(null)}>Add new service</button>} />
        ) : (
          <ul className="divide-y divide-[#f4f4f8]">
            {services.map((service) => (
              <li
                key={service.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-[#1b1b1f]">{service.title}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        service.is_active && provider?.is_published
                          ? 'bg-[#e6f4ed] text-[#1b7c4f]'
                          : service.is_active ? 'bg-warning/10 text-warning'
                          : 'bg-[#f4f4f8] text-[#5f6b76]'
                      }`}
                    >
                      {service.is_active ? provider?.is_published ? 'Published' : 'Ready to publish' : 'Draft'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#5f6b76]">
                    {formatServicePrice(service.price, service.pricing_type)} ·{' '}
                    {service.booking_count} {service.booking_count === 1 ? 'booking' : 'bookings'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === service.id}
                    aria-label={`Edit ${service.title}`}
                    onClick={() => openEditor(service)}
                    className="min-h-11 rounded-lg border border-control-border px-3 text-sm font-semibold text-[#1b1b1f] disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busyId === service.id}
                    aria-label={`${service.is_active ? "Disable" : "Enable"} ${service.title}`}
                    onClick={() => togglePublished(service)}
                    className="min-h-11 rounded-lg border border-control-border px-3 text-sm font-semibold text-[#5f6b76] disabled:opacity-50"
                  >
                    {service.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === service.id}
                    aria-label={`Remove ${service.title}`}
                    onClick={() => setRemoving(service)}
                    className="min-h-11 rounded-lg border border-[#f3c6c6] px-3 text-sm font-semibold text-[#b42318] hover:bg-[#fdecee] disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
                {/* Mounted in every row so a result is read out, and out of
                    the flow while empty so the row's gap does not grow. */}
                <div id={`service-feedback-${service.id}`} tabIndex={-1} className={actionId === service.id && (error || notice) ? 'w-full basis-full scroll-mt-24' : 'sr-only'}><FormMessage error={actionId === service.id ? error : null} success={actionId === service.id ? notice : null} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={!!removing} title="Remove service?" onClose={() => setRemoving(null)} busy={!!busyId}>
        <p>Remove “{removing?.title}”? This cannot be undone.</p>
        <div className="mt-4 flex gap-2"><button className="min-h-11 rounded-lg border px-4" onClick={() => setRemoving(null)}>Keep service</button><button className="min-h-11 rounded-lg border border-danger px-4 text-danger" onClick={() => removing && void removeService(removing)}>Remove service</button></div>
      </Modal>
      {editing !== undefined ? (
        <ServiceEditor service={editing} onClose={() => setEditing(undefined)} onSaved={handleSaved} />
      ) : null}
    </div>
  );
}
