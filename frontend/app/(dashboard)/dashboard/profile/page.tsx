'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  safe,
  type Profile,
  type ProviderService,
  type ServiceProvider,
  type VerificationDocument,
} from '@/app/lib/api';
import { formatDate, formatServicePrice, initialsOf } from '@/app/lib/format';
import { providerHref } from '@/app/lib/provider-view';

const REQUIRED_DOCUMENTS: { type: VerificationDocument['type']; label: string }[] = [
  { type: 'id', label: 'ID' },
  { type: 'abn', label: 'ABN' },
  { type: 'licence', label: 'Licence' },
  { type: 'insurance', label: 'Insurance' },
];

export default function ProviderProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [documents, setDocuments] = useState<VerificationDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    full_name: '',
    headline: '',
    phone: '',
    location: '',
    website: '',
    bio: '',
  });

  useEffect(() => {
    let active = true;
    (async () => {
      const [me, mine, serviceList, docs] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe<ServiceProvider | null>(api.providers.mine(), null),
        safe(api.providers.myServices(), []),
        safe(api.providers.myDocuments(), []),
      ]);
      if (!active) return;
      setProfile(me);
      setProvider(mine);
      setServices(serviceList);
      setDocuments(docs);
      setForm({
        full_name: me?.full_name ?? '',
        headline: mine?.headline ?? '',
        phone: me?.phone ?? '',
        location: [me?.location, me?.state].filter(Boolean).join(', '),
        website: mine?.website ?? '',
        bio: mine?.bio ?? '',
      });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const [suburb, state] = form.location.split(',').map((part) => part.trim());
      const updatedProfile = await api.profiles.update({
        full_name: form.full_name,
        phone: form.phone || null,
        location: suburb || null,
        state: state || null,
      });
      setProfile(updatedProfile);

      if (provider) {
        const updatedProvider = await api.providers.updateMine({
          headline: form.headline || null,
          website: form.website || null,
          bio: form.bio || null,
        });
        setProvider(updatedProvider);
      }
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  const verified = documents.filter((d) => d.status === 'verified');
  const verifiedTypes = new Set(verified.map((d) => d.type));
  const missing = REQUIRED_DOCUMENTS.filter((d) => !verifiedTypes.has(d.type));
  const completion = provider?.profile_completion ?? 0;

  if (loading) {
    return <p className="text-[#5f6b76]">Loading your profile…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-[#1b1b1f]">My Profile</h1>
          <p className="mt-1 text-[#5f6b76]">
            How clients see you on TenantVoice — and how we contact you.
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
          <button
            type="button"
            onClick={editing ? handleSave : () => setEditing(true)}
            disabled={saving}
            className="inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Edit profile'}
          </button>
        </div>
      </div>

      {saved ? (
        <div className="rounded-[14px] border border-[#1b7c4f]/20 bg-[#e6f4ed] px-4 py-3 text-sm font-semibold text-[#1b7c4f]">
          Profile saved.
        </div>
      ) : null}
      {error ? (
        <div className="rounded-[14px] border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </div>
      ) : null}

      {/* Completion */}
      <section className="rounded-[20px] border border-[#efeff2] bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-[#1b1b1f]">Profile completion</p>
            <p className="mt-1 text-sm text-[#5f6b76]">
              {completion}% complete — finish onboarding to rank higher in search.
            </p>
          </div>
          <Link
            href="/dashboard/onboarding"
            className="inline-flex h-10 shrink-0 items-center rounded-full bg-[#0e2a48] px-4 text-sm font-bold text-white"
          >
            Continue setup
          </Link>
        </div>
        <div className="mt-4 h-2 rounded-full bg-[#eeeffd]">
          <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {verified.map((doc) => (
            <span
              key={doc.id}
              className="rounded-full bg-[#e6f4ed] px-2.5 py-1 font-semibold text-[#1b7c4f]"
            >
              ✓ {doc.label ?? doc.type.toUpperCase()}
            </span>
          ))}
          {missing.map((doc) => (
            <span
              key={doc.type}
              className="rounded-full bg-[#fff4e5] px-2.5 py-1 font-semibold text-[#b86e00]"
            >
              ○ {doc.label}
            </span>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Identity card */}
        <aside className="h-fit rounded-[20px] border border-[#efeff2] bg-white p-5 text-center">
          <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-[#eeeffd] text-2xl font-extrabold text-[#0e2a48]">
            {initialsOf(profile?.full_name)}
          </div>
          <h2 className="mt-4 text-lg font-extrabold text-[#1b1b1f]">{profile?.full_name}</h2>
          <p className="text-sm text-[#5f6b76]">
            {provider?.headline ?? provider?.tagline ?? 'Service provider'}
          </p>
          <p className="mt-1 text-xs text-[#8c97a2]">
            {[profile?.location, profile?.state].filter(Boolean).join(', ')} · Member since{' '}
            {formatDate(profile?.created_at)}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {verified.map((doc) => (
              <span
                key={doc.id}
                className="rounded-full bg-[#eeeffd] px-2 py-0.5 text-[11px] font-semibold text-[#0e2a48]"
              >
                ✓ {doc.label ?? doc.type.toUpperCase()}
              </span>
            ))}
          </div>
          <Link
            href="/dashboard/settings"
            className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-full border border-[#efeff2] text-sm font-semibold"
          >
            Account settings
          </Link>
        </aside>

        {/* Editable fields */}
        <div className="space-y-4">
          <section className="rounded-[20px] border border-[#efeff2] bg-white p-5">
            <h3 className="font-bold text-[#1b1b1f]">About</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Full name"
                value={form.full_name}
                onChange={(v) => setForm((f) => ({ ...f, full_name: v }))}
                disabled={!editing}
              />
              <Field
                label="Headline"
                value={form.headline}
                onChange={(v) => setForm((f) => ({ ...f, headline: v }))}
                disabled={!editing}
              />
              <Field
                label="Email"
                value={profile?.email ?? '—'}
                onChange={() => undefined}
                disabled
              />
              <Field
                label="Phone"
                value={form.phone}
                onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                disabled={!editing}
              />
              <Field
                label="Location"
                value={form.location}
                onChange={(v) => setForm((f) => ({ ...f, location: v }))}
                disabled={!editing}
              />
              <Field
                label="Website"
                value={form.website}
                onChange={(v) => setForm((f) => ({ ...f, website: v }))}
                disabled={!editing}
              />
            </div>
            <label
              htmlFor="provider-bio"
              className="mt-4 block text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
            >
              Bio
            </label>
            <textarea
              id="provider-bio"
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              disabled={!editing}
              rows={4}
              className="mt-1.5 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 py-3 text-sm text-[#1b1b1f] outline-none disabled:opacity-70 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
            />
            {provider?.abn ? (
              <p className="mt-2 text-xs text-[#8c97a2]">ABN {provider.abn}</p>
            ) : null}
          </section>

          <section className="rounded-[20px] border border-[#efeff2] bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[#1b1b1f]">Published services</h3>
              <Link href="/dashboard/services" className="text-sm font-semibold text-primary">
                Manage →
              </Link>
            </div>
            {services.filter((s) => s.is_active).length === 0 ? (
              <p className="mt-4 text-sm text-[#8c97a2]">No published services yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-[#f4f4f8]">
                {services
                  .filter((s) => s.is_active)
                  .map((service) => (
                    <li
                      key={service.id}
                      className="flex items-center justify-between py-3 text-sm"
                    >
                      <span className="font-semibold text-[#1b1b1f]">{service.title}</span>
                      <span className="text-[#5f6b76]">
                        {formatServicePrice(service.price, service.pricing_type)}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const id = `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-11 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm text-[#1b1b1f] outline-none disabled:opacity-70 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}
