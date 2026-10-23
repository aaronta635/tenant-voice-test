'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import {
  api,
  ApiError,
  orNotFound,
  type Profile,
  type ProviderService,
  type ServiceProvider,
  type VerificationDocument,
} from '@/app/lib/api';
import { formatDate, formatServicePrice, initialsOf } from '@/app/lib/format';
import { providerHref } from '@/app/lib/provider-view';
import FormMessage from '@/app/components/ui/FormMessage';
import { splitProviderLocation } from '@/app/lib/provider-workspace';
import { announceAccountChange } from '@/app/lib/provider-refresh';
import { abnProblem, formatAbn } from '@/app/lib/abn';
import VerificationDocuments from '@/app/components/provider/VerificationDocuments';

const REQUIRED_DOCUMENTS: { type: VerificationDocument['type']; label: string }[] = [
  { type: 'id', label: 'ID' },
  { type: 'abn', label: 'ABN' },
  { type: 'licence', label: 'Licence' },
  { type: 'insurance', label: 'Insurance' },
];

/** The editable fields as the server holds them. */
function formFrom(profile: Profile | null, provider: ServiceProvider | null) {
  return {
    full_name: profile?.full_name ?? '',
    business_name: provider?.business_name ?? '',
    headline: provider?.headline ?? provider?.tagline ?? '',
    phone: profile?.phone ?? '',
    location: [profile?.location, profile?.state].filter(Boolean).join(', '),
    website: provider?.website ?? '',
    abn: provider?.abn ?? '',
    bio: provider?.bio ?? '',
  };
}

export default function ProviderProfilePage() {
  const saveButton = useRef<HTMLButtonElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [documents, setDocuments] = useState<VerificationDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const emptyForm = {
    full_name: '',
    business_name: '',
    headline: '',
    phone: '',
    location: '',
    website: '',
    abn: '',
    bio: '',
  };
  const [form, setForm] = useState(emptyForm);
  // What the server holds: saves only send fields that differ from it, and
  // Cancel restores it.
  const [original, setOriginal] = useState(emptyForm);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [me, mine, serviceList, docs] = await Promise.all([
          api.profiles.me(),
          orNotFound<ServiceProvider | null>(api.providers.mine(), null),
          orNotFound(api.providers.myServices(), []),
          orNotFound(api.providers.myDocuments(), []),
        ]);
        if (!active) return;
        setProfile(me);
        setProvider(mine);
        setServices(serviceList);
        setDocuments(docs);
        const loaded = formFrom(me, mine);
        setForm(loaded);
        setOriginal(loaded);
      } catch (err) {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Could not load your profile.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  function cancelEdit() {
    setForm(original);
    setEditing(false);
    setError(null);
  }

  async function handleSave() {
    if (!form.full_name.trim()) {
      setError('Your full name can’t be empty.');
      document.getElementById('field-account-full-name')?.focus();
      return;
    }
    if (form.website.trim() && !/^https?:\/\//i.test(form.website.trim())) {
      setError('Enter a website beginning with https:// or http://.');
      document.getElementById('field-website')?.focus();
      return;
    }
    // Checked only when changed: an ABN another app stored never blocks other edits.
    const abnError = form.abn.trim() !== original.abn.trim() ? abnProblem(form.abn) : null;
    if (abnError) {
      setError(abnError);
      document.getElementById('field-abn')?.focus();
      return;
    }
    if (!provider && ['business_name', 'headline', 'website', 'abn', 'bio'].some((key) => form[key as keyof typeof form] !== original[key as keyof typeof original])) {
      setError('Complete onboarding step 1 before saving business details.');
      return;
    }
    setSaved(false);
    setSaving(true);
    setError(null);
    // What the server holds after this save, whichever of its calls succeed.
    let savedProfile = profile;
    let savedProvider = provider;
    try {
      const changed = (key: keyof typeof form) => form[key].trim() !== original[key].trim();
      if (changed('full_name') || changed('phone') || changed('location')) {
        const { location, state } = splitProviderLocation(form.location);
        savedProfile = await api.profiles.update({
          full_name: form.full_name.trim(),
          phone: form.phone.trim() || null,
          location,
          state: state || null,
        });
        setProfile(savedProfile);
      }

      const providerPatch: Partial<ServiceProvider> = {};
      if (changed('business_name')) providerPatch.business_name = form.business_name.trim() || null;
      if (changed('headline')) {
        providerPatch.headline = form.headline.trim() || null;
        providerPatch.tagline = form.headline.trim() || null;
      }
      if (changed('website')) providerPatch.website = form.website.trim() || null;
      if (changed('abn')) providerPatch.abn = form.abn.trim() ? formatAbn(form.abn) : null;
      if (changed('bio')) providerPatch.bio = form.bio.trim() || null;
      if (provider && Object.keys(providerPatch).length > 0) {
        savedProvider = await api.providers.updateMine(providerPatch);
        setProvider(savedProvider);
      }
      // Show the fields as stored, so a cleared or normalised value reads
      // exactly as it will after a reload.
      setForm(formFrom(savedProfile, savedProvider));
      setEditing(false);
      setSaved(true);
      announceAccountChange();

    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      // Cancel and the next save start from the server's copy, including any
      // part that saved before a later call failed.
      setOriginal(formFrom(savedProfile, savedProvider));
      setSaving(false);
      requestAnimationFrame(() => saveButton.current?.focus());
    }
  }

  const pending = documents.filter((d) => d.status !== 'verified');
  const coveredTypes = new Set(documents.map((d) => d.type));
  const missing = REQUIRED_DOCUMENTS.filter((d) => !coveredTypes.has(d.type));
  const completion = provider?.profile_completion ?? 0;
  const isLive = Boolean(provider?.is_published);
  const setupDone = completion >= 100 && isLive;

  const completionHint = setupDone
    ? missing.length === 0 && pending.length === 0
      ? 'Your marketplace profile is live and fully set up.'
      : pending.length > 0
        ? 'Profile is live. Credentials are with the trust team for review.'
        : 'Your marketplace profile is live. Verified credentials help you rank higher.'
    : isLive
      ? 'Live on the marketplace — fill the remaining gaps to rank higher in search.'
      : 'Finish onboarding and publish to appear in marketplace search.';

  if (loading) {
    return <div><h1 className="font-heading text-h2 font-semibold text-text-dark">Profile</h1><p role="status">Loading your profile…</p></div>;
  }
  if (loadError) {
    return (
      <div className="space-y-6"><h1 className="font-heading text-h2 font-semibold text-text-dark">Profile</h1><LoadErrorCard
        message={loadError}
        onRetry={() => {
          setLoading(true);
          setLoadError(null);
          setReloadKey((k) => k + 1);
        }}
      /></div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="font-heading text-h2 font-semibold text-text-dark">Profile</h1>
          <p className="mt-1 text-[#5f6b76]">
            How clients see you on TenantVoice — and how we contact you.
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
          {editing ? (
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="inline-flex min-h-11 items-center rounded-lg border border-control-border bg-white px-4 text-sm font-semibold disabled:opacity-60"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            ref={saveButton}
            onClick={editing ? handleSave : () => { setSaved(false); setEditing(true); }}
            disabled={saving}
            className="order-first inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Edit profile'}
          </button>
        </div>
      </div>

      <FormMessage error={error} success={saved ? 'Profile saved.' : null} />
      {!provider ? <p className="rounded-xl border border-warning bg-warning/10 p-4 text-sm text-warning">You can update your contact details now. <Link href="/dashboard/onboarding" className="font-bold underline">Complete onboarding step 1</Link> to edit your business name, headline, website, ABN, bio and documents.</p> : null}

      {/* Completion */}
      <section className="rounded-xl border border-border bg-white shadow-sm p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-[#1b1b1f]">Profile completion</p>
            <p className="mt-1 text-sm text-[#5f6b76]">
              {completion}% complete — {completionHint}
            </p>
          </div>
          {!setupDone ? (
            <Link
              href="/dashboard/onboarding"
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-[#0e2a48] px-4 text-sm font-bold text-white"
            >
              {isLive ? 'Improve profile' : 'Continue setup'}
            </Link>
          ) : missing.length > 0 || pending.length > 0 ? (
            // The credentials are further down this page; with setup done,
            // onboarding would open on its review step instead. A Link, not
            // a plain <a>: Next ignores Back to a history entry it did not
            // make, so Back from a page opened afterwards would leave that
            // page on screen.
            <Link
              href="#verification-documents"
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-control-border bg-white px-4 text-sm font-semibold text-[#1b1b1f]"
            >
              Manage credentials
            </Link>
          ) : (
            <span className="inline-flex h-11 shrink-0 items-center rounded-full bg-[#e6f4ed] px-4 text-sm font-bold text-[#1b7c4f]">
              Setup complete
            </span>
          )}
        </div>
        <div role="progressbar" aria-label="Profile completion" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100} className="mt-4 h-2 rounded-full border border-control-border bg-[#eeeffd]">
          <div className="h-full rounded-full bg-primary forced-colors:bg-[Highlight]" style={{ width: `${completion}%` }} />
        </div>
        <p className="mt-3 text-sm text-text-muted">{documents.filter((doc) => doc.status === 'verified').length} verified credentials · {documents.filter((doc) => doc.status === 'pending').length} pending review. Manage documents below.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Identity card */}
        <aside className="h-fit rounded-xl border border-border bg-white shadow-sm p-5 text-center">
          <div aria-hidden="true" className="mx-auto flex size-24 items-center justify-center shrink-0 rounded-full bg-surface text-2xl font-extrabold text-navy">
            {initialsOf(provider?.business_name || profile?.full_name)}
          </div>
          <h2 className="mt-4 text-lg font-extrabold text-[#1b1b1f]">
            {provider?.business_name || profile?.full_name || 'Your business'}
          </h2>
          <p className="text-sm text-[#5f6b76]">
            {provider?.headline ?? provider?.tagline ?? 'Service provider'}
          </p>
          <p className="mt-1 text-xs text-[#5f6b76]">
            {[profile?.location, profile?.state].filter(Boolean).join(', ') || 'Add your location'}
            {' · '}
            Member since {formatDate(profile?.created_at)}
          </p>
          {provider?.is_published ? (
            <p className="mt-2 text-xs font-semibold text-[#1b7c4f]">Live on marketplace</p>
          ) : (
            <p className="mt-2 text-xs font-semibold text-warning">Not published yet</p>
          )}
          {provider?.is_published ? (
            <Link
              href={providerHref(provider)}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary-strong px-4 text-sm font-bold text-white"
            >
              View public profile
            </Link>
          ) : (
            <Link
              href="/dashboard/onboarding"
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary-strong px-4 text-sm font-bold text-white"
            >
              Finish & publish
            </Link>
          )}
          <Link
            href="/dashboard/settings"
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-control-border text-sm font-semibold"
          >
            Account settings
          </Link>
        </aside>

        {/* Editable fields */}
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-white shadow-sm p-5">
            <h2 className="font-bold text-[#1b1b1f]">About</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                autoComplete="organization"
                label="Display / business name"
                value={form.business_name}
                onChange={(v) => setForm((f) => ({ ...f, business_name: v }))}
                disabled={!editing || !provider}
              />
              <Field
                label="Headline"
                value={form.headline}
                onChange={(v) => setForm((f) => ({ ...f, headline: v }))}
                disabled={!editing || !provider}
              />
              <Field
                required
                autoComplete="name"
                label="Account full name"
                value={form.full_name}
                onChange={(v) => setForm((f) => ({ ...f, full_name: v }))}
                disabled={!editing}
              />
              <Field
                label="Email"
                value={profile?.email ?? '—'}
                onChange={() => undefined}
                disabled
              />
              <Field
                type="tel"
                autoComplete="tel"
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
                type="url"
                autoComplete="url"
                label="Website"
                value={form.website}
                onChange={(v) => setForm((f) => ({ ...f, website: v }))}
                disabled={!editing || !provider}
              />
              <Field
                label="ABN"
                inputMode="numeric"
                hint="Optional. The 11 digits from ABN Lookup, printed on your invoices."
                value={form.abn}
                onChange={(v) => setForm((f) => ({ ...f, abn: v }))}
                disabled={!editing || !provider}
              />
            </div>
            <label
              htmlFor="provider-bio"
              className="mt-4 block text-xs font-bold tracking-wide text-[#5f6b76] uppercase"
            >
              Bio
            </label>
            {editing && provider ? <textarea
              id="provider-bio"
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              disabled={!editing}
              maxLength={5000}
              rows={4}
              className="mt-1.5 w-full rounded-[14px] border border-control-border bg-[#fafafe] px-4 py-3 text-sm text-[#1b1b1f] outline-none disabled:opacity-70 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
            /> : <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text-dark">{form.bio || "Not provided"}</p>}
          </section>

          <section className="rounded-xl border border-border bg-white shadow-sm p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#1b1b1f]">{provider?.is_published ? "Published services" : "Enabled services (profile not published)"}</h2>
              <Link href="/dashboard/services" className="text-sm font-semibold text-primary-strong">
                Manage →
              </Link>
            </div>
            {services.filter((s) => s.is_active).length === 0 ? (
              <p className="mt-4 text-sm text-[#5f6b76]">No published services yet.</p>
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

          <section className="rounded-xl border border-border bg-white shadow-sm p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#1b1b1f]">Availability</h2>
              <Link href="/dashboard/availability" className="text-sm font-semibold text-primary-strong">
                Set hours →
              </Link>
            </div>
            <p className="mt-3 text-sm text-[#5f6b76]">
              {provider?.availability_note
                ? provider.availability_note
                : 'Add weekly hours so clients can book real time slots on your public profile.'}
            </p>
          </section>

          <VerificationDocuments documents={documents} enabled={Boolean(provider)} onChange={(docs) => { setDocuments(docs); void api.providers.mine().then(setProvider).catch(() => undefined); }} />
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
  type = "text",
  autoComplete,
  inputMode,
  hint,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  type?: string;
  autoComplete?: string;
  inputMode?: 'numeric';
  /** Shown under the input while editing, and read with it. */
  hint?: string;
  required?: boolean;
}) {
  const id = `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-bold tracking-wide text-[#5f6b76] uppercase"
      >
        {label}{required ? " (required)" : ""}
      </label>
      {disabled ? <p className="whitespace-pre-wrap break-words text-sm text-text-dark">{value || "Not provided"}</p> : <>
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-describedby={hint ? `${id}-hint` : undefined}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-11 w-full rounded-[14px] border border-control-border bg-[#fafafe] px-4 text-sm text-[#1b1b1f] outline-none disabled:opacity-70 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
        />
        {hint ? <p id={`${id}-hint`} className="mt-1 text-xs text-text-body">{hint}</p> : null}
      </>}
    </div>
  );
}
