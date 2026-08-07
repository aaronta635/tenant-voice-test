'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, safe, type Profile, type ServiceProvider } from '@/app/lib/api';
import { formatDate, ROLE_LABELS } from '@/app/lib/format';

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [me, mine] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe<ServiceProvider | null>(api.providers.mine(), null),
      ]);
      if (!active) return;
      setProfile(me);
      setProvider(mine);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function updateProvider(patch: Partial<ServiceProvider>, message: string) {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.providers.updateMine(patch);
      setProvider(updated);
      setNotice(message);
      window.setTimeout(() => setNotice(null), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that setting.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-[#5f6b76]">Loading settings…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-[32px] font-extrabold tracking-tight text-[#1b1b1f]">Settings</h1>
        <p className="mt-1 text-[#5f6b76]">
          Account, visibility, and listing controls for your provider workspace.
        </p>
      </div>

      {notice ? (
        <div className="rounded-[14px] border border-[#1b7c4f]/20 bg-[#e6f4ed] px-4 py-3 text-sm font-semibold text-[#1b7c4f]">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-[14px] border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </div>
      ) : null}

      <section className="rounded-[20px] border border-[#efeff2] bg-white p-5">
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
            className="inline-flex h-9 items-center rounded-full border border-[#efeff2] px-3 text-sm font-semibold"
          >
            Edit profile
          </Link>
        </div>
      </section>

      {provider ? (
        <section className="rounded-[20px] border border-[#efeff2] bg-white p-5">
          <h2 className="font-bold text-[#1b1b1f]">Privacy &amp; visibility</h2>
          <ul className="mt-4 space-y-3">
            <Toggle
              label="Show online status on public profile"
              checked={provider.is_online}
              disabled={busy}
              onChange={() =>
                updateProvider(
                  { is_online: !provider.is_online },
                  provider.is_online ? 'Online status hidden.' : 'Online status shown.',
                )
              }
            />
            <Toggle
              label="List my profile in the marketplace"
              checked={provider.is_published}
              disabled={busy}
              onChange={() =>
                updateProvider(
                  { is_published: !provider.is_published },
                  provider.is_published ? 'Listing paused.' : 'Listing published.',
                )
              }
            />
          </ul>
          <p className="mt-3 text-xs text-[#8c97a2]">
            Your verification documents stay private — only TenantVoice trust reviewers can see
            them.
          </p>
        </section>
      ) : (
        <section className="rounded-[20px] border border-dashed border-[#c5cad3] bg-white p-5 text-sm text-[#5f6b76]">
          You don&apos;t have a provider profile yet.{' '}
          <Link href="/dashboard/onboarding" className="font-semibold text-primary">
            Finish onboarding
          </Link>{' '}
          to publish one.
        </section>
      )}

      <section className="rounded-[20px] border border-[#fde8e8] bg-white p-5">
        <h2 className="font-bold text-[#b42318]">Danger zone</h2>
        <p className="mt-1 text-sm text-[#5f6b76]">
          Pausing hides you from search. Deleting a listing removes it from the marketplace.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !provider?.is_published}
            onClick={() => updateProvider({ is_published: false }, 'Listing paused.')}
            className="inline-flex h-9 items-center rounded-full border border-[#efeff2] px-3 text-sm font-semibold disabled:opacity-50"
          >
            Pause listing
          </button>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#f4f4f8] pb-3 last:border-0">
      <span className="text-[#8c97a2]">{label}</span>
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
    <li className="flex items-center justify-between gap-4">
      <span className="text-sm text-[#1b1b1f]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-primary' : 'bg-[#c5cad3]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </li>
  );
}
