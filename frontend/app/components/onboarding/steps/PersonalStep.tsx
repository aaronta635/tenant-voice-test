'use client';

import { useState } from 'react';
import Input from '@/app/components/ui/Input';
import { patchOf, useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { HINT } from '@/app/components/onboarding/styles';
import { changedFields, isPhone, textOrNull, type MyProfile } from '@/app/lib/my-profile';

function formFrom(profile: MyProfile) {
  return {
    full_name: profile.full_name,
    phone: profile.phone ?? '',
    location: profile.location ?? '',
    state: profile.state ?? '',
  };
}

function valuesFrom(form: ReturnType<typeof formFrom>) {
  return {
    full_name: form.full_name.trim(),
    phone: textOrNull(form.phone),
    location: textOrNull(form.location),
    state: textOrNull(form.state),
  };
}

/** The account's name, phone and suburb (reference step 2, "About you"); every role has them. */
export default function PersonalStep({ profile, handle }: StepProps) {
  const [form, setForm] = useState(() => formFrom(profile));
  // What the server holds: only the fields that differ from it are sent.
  const [stored] = useState(() => valuesFrom(formFrom(profile)));

  useStepAnswers(handle, () => {
    const changes = changedFields(stored, valuesFrom(form));
    if (changes.full_name === '') return { problem: 'Enter your full name.', field: 'onboarding-full-name' };
    if (changes.phone && !isPhone(changes.phone)) {
      return { problem: 'Enter a phone number of 6 to 15 digits.', field: 'onboarding-phone' };
    }
    return patchOf(changes, changes);
  });

  function change(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Input
          id="onboarding-full-name"
          label="Full name"
          autoComplete="name"
          required
          maxLength={120}
          value={form.full_name}
          onChange={(event) => change('full_name', event.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <Input
          id="onboarding-phone"
          label="Phone"
          type="tel"
          autoComplete="tel"
          maxLength={30}
          aria-describedby="onboarding-phone-hint"
          value={form.phone}
          onChange={(event) => change('phone', event.target.value)}
        />
        <p id="onboarding-phone-hint" className={HINT}>
          Never shown on your public profile.
        </p>
      </div>
      <Input
        id="onboarding-suburb"
        label="Suburb you live in"
        autoComplete="address-level2"
        maxLength={80}
        aria-describedby="onboarding-area-hint"
        value={form.location}
        onChange={(event) => change('location', event.target.value)}
      />
      <Input
        id="onboarding-state"
        label="State"
        autoComplete="address-level1"
        maxLength={40}
        aria-describedby="onboarding-area-hint"
        value={form.state}
        onChange={(event) => change('state', event.target.value)}
      />
      <p id="onboarding-area-hint" className="-mt-3 text-xs text-text-body sm:col-span-2">
        Your suburb and state can show on your public profile.
      </p>
    </div>
  );
}
