'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  safe,
  type ProviderDashboard,
  type ProviderService,
  type ServiceProvider,
} from '@/app/lib/api';
import { formatMoney, formatPercent, formatServicePrice } from '@/app/lib/format';
import { providerHref } from '@/app/lib/provider-view';

export default function ServicesPage() {
  const [services, setServices] = useState<ProviderService[]>([]);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [stats, setStats] = useState<ProviderDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [list, mine, dashboard] = await Promise.all([
        safe(api.providers.myServices(), []),
        safe<ServiceProvider | null>(api.providers.mine(), null),
        safe<ProviderDashboard | null>(api.dashboard.provider(), null),
      ]);
      if (!active) return;
      setServices(list);
      setProvider(mine);
      setStats(dashboard);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function togglePublished(service: ProviderService) {
    setBusyId(service.id);
    setError(null);
    try {
      const updated = await api.providers.updateService(service.id, {
        is_active: !service.is_active,
      });
      setServices((prev) => prev.map((s) => (s.id === service.id ? updated : s)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that service.');
    } finally {
      setBusyId(null);
    }
  }

  const published = services.filter((s) => s.is_active).length;
  const draft = services.length - published;

  const statCards = [
    {
      label: 'Total services',
      value: String(services.length),
      hint: `${published} published · ${draft} draft`,
    },
    {
      label: 'Active bookings',
      value: stats ? String(stats.active_bookings) : '—',
      hint: stats ? `${stats.due_this_week} due this week` : '',
    },
    {
      label: 'Monthly earnings',
      value: stats ? formatMoney(stats.month_earnings) : '—',
      hint:
        stats?.month_change_pct === null || stats === null
          ? ''
          : `${formatPercent(stats.month_change_pct)} vs last month`,
    },
    {
      label: 'Booking conversion',
      value: stats?.booking_conversion_pct !== null && stats ? `${stats.booking_conversion_pct}%` : '—',
      hint: stats ? `${stats.total_enquiries} enquiries received` : '',
    },
  ];

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">Provider workspace</p>
          <h1 className="text-[32px] font-extrabold tracking-tight text-[#1b1b1f]">
            Manage services
          </h1>
          <p className="mt-1 max-w-2xl text-[#5f6b76]">
            Define what you offer, set fixed prices and control where you&apos;ll travel —
            all from one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {provider ? (
            <Link
              href={providerHref(provider)}
              className="inline-flex h-10 items-center rounded-full border border-[#efeff2] bg-white px-4 text-sm font-semibold"
            >
              Preview public profile
            </Link>
          ) : null}
          <Link
            href="/dashboard/onboarding"
            className="inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-bold text-white"
          >
            Add new service
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="rounded-[18px] border border-[#efeff2] bg-white p-5">
            <p className="text-xs font-bold tracking-wide text-[#8c97a2] uppercase">
              {stat.label}
            </p>
            <p className="mt-2 text-3xl font-extrabold text-[#1b1b1f]">{stat.value}</p>
            <p className="mt-1 text-sm text-[#5f6b76]">{stat.hint}</p>
          </div>
        ))}
      </div>

      {error ? (
        <p className="mt-6 rounded-[12px] border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </p>
      ) : null}

      <div className="mt-8 overflow-hidden rounded-[20px] border border-[#efeff2] bg-white">
        <div className="border-b border-[#efeff2] px-5 py-4">
          <h2 className="font-bold text-[#1b1b1f]">Your services</h2>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-[#8c97a2]">Loading services…</p>
        ) : services.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[#8c97a2]">
            No services yet — add one from onboarding to start taking bookings.
          </p>
        ) : (
          <ul className="divide-y divide-[#f4f4f8]">
            {services.map((service) => (
              <li
                key={service.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-[#1b1b1f]">{service.title}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        service.is_active
                          ? 'bg-[#e6f4ed] text-[#1b7c4f]'
                          : 'bg-[#f4f4f8] text-[#5f6b76]'
                      }`}
                    >
                      {service.is_active ? 'published' : 'draft'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#5f6b76]">
                    {formatServicePrice(service.price, service.pricing_type)} ·{' '}
                    {service.booking_count} bookings
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === service.id}
                    onClick={() => togglePublished(service)}
                    className="h-9 rounded-full border border-[#efeff2] px-3 text-sm font-semibold text-[#5f6b76] disabled:opacity-50"
                  >
                    {service.is_active ? 'Unpublish' : 'Publish'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
