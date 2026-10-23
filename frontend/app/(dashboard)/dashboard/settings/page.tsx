'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ProfileSettingsForm from '@/app/components/profile/ProfileSettingsForm';
import Modal from '@/app/components/ui/Modal';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { api, ApiError, orNotFound, type Profile, type ServiceProvider } from '@/app/lib/api';
import { formatDate, ROLE_LABELS } from '@/app/lib/format';
import type { MyProfile } from '@/app/lib/my-profile';
import { announceAccountChange } from '@/app/lib/provider-refresh';

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmPause, setConfirmPause] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [me, mine] = await Promise.all([
          api.profiles.me(),
          orNotFound<ServiceProvider | null>(api.providers.mine(), null),
        ]);
        if (!active) return;
        setProfile(me);
        setProvider(mine);
      } catch (err) {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Could not load your settings.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  async function updateProvider(patch: Partial<ServiceProvider>, message: string) {
    if (!provider || busy) return;
    setNotice(null);
    setBusy(true);
    setError(null);
    try {
      const updated = await api.providers.updateMine(patch);
      setProvider(updated);
      setNotice(message);
      announceAccountChange();

    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that setting.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div><h1 className="font-heading text-h2 font-semibold text-text-dark">Settings</h1><p role="status">Loading settings…</p></div>;
  if (loadError) {
    return (
      <div className="space-y-6"><h1 className="font-heading text-h2 font-semibold text-text-dark">Settings</h1><LoadErrorCard
            message={loadError}
            onRetry={() => {
              setLoading(true);
              setLoadError(null);
              setReloadKey((k) => k + 1);
            }}
          /></div>
    );
  }

  // GET /profiles/me holds the settings shared with the mobile app (MyProfile).
  const shared = profile && 'settings' in profile ? (profile as MyProfile) : null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-h2 font-semibold text-text-dark">Settings</h1>
        <p className="mt-1 text-[#5f6b76]">
          Account, visibility, and listing controls for your provider workspace.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-white shadow-sm p-5">
        <h2 className="font-bold text-[#1b1b1f]">Account</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Row label="Signed in as" value={profile?.email ?? '—'} />
          <Row label="Role" value={ROLE_LABELS[profile?.role ?? ''] ?? profile?.role ?? '—'} />
          <Row label="Member since" value={formatDate(profile?.created_at)} />
          {provider ? (
            <Row label="Profile completion" value={`${provider.profile_completion}%`} />
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/dashboard/profile"
            className="inline-flex min-h-11 items-center rounded-lg border border-control-border px-3 text-sm font-semibold"
          >
            Edit profile
          </Link>
        </div>
      </section>

      {provider ? (
        <section className="rounded-xl border border-border bg-white shadow-sm p-5">
          <h2 className="font-bold text-[#1b1b1f]">Privacy &amp; visibility</h2>
          <ul className="mt-4 space-y-3">
            <li className="text-sm text-text-muted">Online presence is not shown publicly. Set your booking hours under <Link className="font-semibold text-primary-strong underline" href="/dashboard/availability">Availability</Link>.</li>
            {provider.is_published ? <Toggle label="List my profile in the marketplace" checked disabled={busy} onChange={() => setConfirmPause(true)} /> : <li className="rounded-xl border border-control-border p-4 text-sm"><p>Your provider profile is not published.</p><Link href="/dashboard/onboarding" className="mt-2 inline-flex min-h-11 items-center font-bold text-primary-strong underline">Review setup and publish</Link></li>}
          </ul>
          <FormMessage error={error} success={notice} className="mt-4" />
          <p className="mt-3 text-xs text-[#5f6b76]">
            Your verification documents stay private — only TenantVoice trust reviewers can see
            them.
          </p>
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-[#c5cad3] bg-white shadow-sm p-5 text-sm text-[#5f6b76]">
          You don&apos;t have a provider profile yet.{' '}
          <Link href="/dashboard/onboarding" className="font-semibold text-primary-strong underline">
            Finish onboarding
          </Link>{' '}
          to publish one.
        </section>
      )}

      {shared ? (
        <section aria-label="Notifications and privacy" className="rounded-xl border border-border bg-white shadow-sm p-5">
          <ProfileSettingsForm role="service_provider" profile={shared} onSaved={setProfile} />
        </section>
      ) : null}

      <Modal open={confirmPause} title="Pause your provider profile?" onClose={() => setConfirmPause(false)} busy={busy}>
        <p>Clients will no longer find your profile in the marketplace. Existing bookings and messages remain available.</p>
        <div className="mt-4 flex gap-2"><button type="button" disabled={busy} className="min-h-11 rounded-lg border px-4" onClick={() => setConfirmPause(false)}>Keep profile live</button><button type="button" disabled={busy} className="min-h-11 rounded-lg border border-danger px-4 text-danger" onClick={async () => { await updateProvider({ is_published: false }, 'Provider profile paused.'); setConfirmPause(false); }}>Pause profile</button></div>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#f4f4f8] pb-3 last:border-0">
      <span className="text-[#5f6b76]">{label}</span>
      <span className="font-semibold text-[#1b1b1f]">{value}</span>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <li>
      <button type="button" role="switch" aria-checked={checked} aria-disabled={disabled} onClick={() => { if (!disabled) onChange(); }} className="flex min-h-11 w-full items-center justify-between gap-4 rounded-lg text-left disabled:opacity-50">
        <span className="text-sm text-text-dark">{label}</span>
        <span className="flex shrink-0 items-center gap-2" aria-hidden="true">
          <span className="min-w-6 text-xs font-semibold">{checked ? 'On' : 'Off'}</span>
          <span data-switch-track className={`relative block h-6 w-11 shrink-0 rounded-full border-2 border-control-border ${checked ? 'bg-primary-strong' : 'bg-white'}`}>
            <span data-switch-thumb className={`absolute top-0.5 left-0.5 size-4 rounded-full border border-control-border ${checked ? 'translate-x-5 bg-white' : 'bg-text-muted'}`} />
          </span>
        </span>
      </button>
    </li>
  );
}
