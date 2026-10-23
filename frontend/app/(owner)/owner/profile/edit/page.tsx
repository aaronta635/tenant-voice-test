'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { buttonClassName } from '@/app/components/ui/button-styles';
import { ApiError } from '@/app/lib/api';
import {
  changedFields,
  isPhone,
  isPostcode,
  numberOrNull,
  numberText,
  textOrNull,
  updateMyProfile,
  type MyProfile,
} from '@/app/lib/my-profile';
import { useMyProfile } from '@/app/lib/use-my-profile';

/** The editable fields as the server holds them. */
function formFrom(profile: MyProfile) {
  return {
    full_name: profile.full_name,
    phone: profile.phone ?? '',
    location: profile.location ?? '',
    state: profile.state ?? '',
    postcode: profile.postcode ?? '',
    agency_name: profile.landlord?.agency_name ?? '',
    license_number: profile.landlord?.license_number ?? '',
    portfolio_size: numberText(profile.landlord?.portfolio_size),
    bio: profile.landlord?.bio ?? '',
  };
}

/** The fields as the API takes them. */
function valuesFrom(form: ReturnType<typeof formFrom>) {
  return {
    full_name: form.full_name.trim(),
    phone: textOrNull(form.phone),
    location: textOrNull(form.location),
    state: textOrNull(form.state),
    postcode: textOrNull(form.postcode),
    agency_name: textOrNull(form.agency_name),
    license_number: textOrNull(form.license_number),
    portfolio_size: numberOrNull(form.portfolio_size),
    bio: textOrNull(form.bio),
  };
}

/** What the server would refuse among the changed values; one stored earlier is not sent, so never blocks a save. */
function problemWith(changes: Partial<ReturnType<typeof valuesFrom>>): string | null {
  if (changes.full_name === '') return 'Enter your full name.';
  if (changes.phone && !isPhone(changes.phone)) return 'Enter a phone number of 6 to 15 digits.';
  if (changes.postcode && !isPostcode(changes.postcode)) return 'Enter a 4-digit postcode.';
  if (changes.license_number && !/^[A-Za-z0-9 ./-]+$/.test(changes.license_number)) {
    return 'Use only letters, numbers, spaces, dots, slashes and dashes in the licence number.';
  }
  const portfolio = changes.portfolio_size;
  if (portfolio != null && !(Number.isInteger(portfolio) && portfolio >= 0 && portfolio <= 10_000)) {
    return 'Enter how many properties you rent out, as a whole number.';
  }
  return null;
}

export default function OwnerEditProfilePage() {
  const { profile, setProfile, loading, error: loadError, retry } = useMyProfile();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/owner/profile" className="text-sm font-medium text-primary-strong">
          ← Back to profile
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-bold text-text-dark">Edit Profile</h1>
      </div>
      {loading ? (
        <p role="status" className="text-text-body">Loading your profile…</p>
      ) : loadError || !profile ? (
        <LoadErrorCard title="Your profile could not be loaded" message={loadError ?? undefined} onRetry={retry} />
      ) : (
        <OwnerProfileForm profile={profile} onSaved={setProfile} />
      )}
    </div>
  );
}

function OwnerProfileForm({ profile, onSaved }: { profile: MyProfile; onSaved: (profile: MyProfile) => void }) {
  const [form, setForm] = useState(() => formFrom(profile));
  // What the server holds: a save sends only the fields that differ from it.
  const [stored, setStored] = useState(() => valuesFrom(formFrom(profile)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const wasSaving = useRef(false);
  const business = profile.landlord !== null;

  useEffect(() => {
    // The disabled button drops focus while it saves; give it back after.
    if (wasSaving.current && !saving && document.activeElement === document.body) saveButton.current?.focus();
    wasSaving.current = saving;
  }, [saving]);

  function change(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(null);
    const { agency_name, license_number, portfolio_size, bio, ...account } = changedFields(stored, valuesFrom(form));
    const landlord = Object.fromEntries(
      Object.entries({ agency_name, license_number, portfolio_size, bio }).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(account).length === 0 && Object.keys(landlord).length === 0) {
      setError(null);
      setSaved('No changes to save.');
      return;
    }
    const problem = problemWith({ ...account, ...landlord });
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMyProfile({
        ...account,
        ...(business && Object.keys(landlord).length ? { landlord } : {}),
      });
      // Show the fields as stored, as a reload would.
      setForm(formFrom(updated));
      setStored(valuesFrom(formFrom(updated)));
      onSaved(updated);
      setSaved('Profile saved to your account.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <Card className="p-6">
        <div className="grid gap-5 md:grid-cols-2">
          <Input
            label="Full name"
            autoComplete="name"
            required
            maxLength={120}
            value={form.full_name}
            onChange={(e) => change('full_name', e.target.value)}
          />
          <Input label="Email" value={profile.email ?? ''} readOnly />
          <Input
            label="Phone"
            type="tel"
            autoComplete="tel"
            maxLength={30}
            value={form.phone}
            onChange={(e) => change('phone', e.target.value)}
          />
          <Input
            label="Suburb"
            autoComplete="address-level2"
            maxLength={80}
            value={form.location}
            onChange={(e) => change('location', e.target.value)}
          />
          <Input
            label="State"
            autoComplete="address-level1"
            maxLength={40}
            value={form.state}
            onChange={(e) => change('state', e.target.value)}
          />
          <Input
            label="Postcode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={4}
            value={form.postcode}
            onChange={(e) => change('postcode', e.target.value)}
          />
        </div>
        {business ? (
          <>
            <h2 className="mt-8 font-heading text-lg font-semibold text-text-dark">Rental business</h2>
            <p className="mt-1 text-sm text-text-body">
              Your business name and about line show on your public profile; your licence number does not.
            </p>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <Input
                label="Agency or business name"
                autoComplete="organization"
                maxLength={120}
                value={form.agency_name}
                onChange={(e) => change('agency_name', e.target.value)}
              />
              <Input
                label="Licence number"
                maxLength={40}
                value={form.license_number}
                onChange={(e) => change('license_number', e.target.value)}
              />
              <Input
                label="Properties you rent out"
                type="number"
                min={0}
                max={10_000}
                inputMode="numeric"
                value={form.portfolio_size}
                onChange={(e) => change('portfolio_size', e.target.value)}
              />
            </div>
            <div className="mt-5">
              <label
                htmlFor="owner-bio"
                className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#565d6d]"
              >
                About you
              </label>
              <textarea
                id="owner-bio"
                rows={4}
                maxLength={1000}
                value={form.bio}
                onChange={(e) => change('bio', e.target.value)}
                className="mt-1.5 w-full min-w-0 rounded-lg border border-control-border bg-white p-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
              />
            </div>
          </>
        ) : null}
        <FormMessage error={error} success={saved} className="mt-4" />
        <button
          ref={saveButton}
          type="submit"
          className={buttonClassName({ className: 'mt-6 h-10' })}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </Card>
    </form>
  );
}
