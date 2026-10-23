'use client';

import { useState } from 'react';
import Input from '@/app/components/ui/Input';
import { patchOf, useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { HINT } from '@/app/components/onboarding/styles';
import { changedFields, numberOrNull, numberText, textOrNull, type LandlordDetails } from '@/app/lib/my-profile';

const EMPTY: LandlordDetails = { agency_name: null, license_number: null, portfolio_size: null, bio: null };

function formFrom(landlord: LandlordDetails) {
  return {
    agency_name: landlord.agency_name ?? '',
    license_number: landlord.license_number ?? '',
    portfolio_size: numberText(landlord.portfolio_size),
  };
}

function valuesFrom(form: ReturnType<typeof formFrom>) {
  return {
    agency_name: textOrNull(form.agency_name),
    license_number: textOrNull(form.license_number),
    portfolio_size: numberOrNull(form.portfolio_size),
  };
}

/** A landlord's or agent's business: the name shows on their public profile, the licence never does. */
export default function BusinessStep({ profile, handle }: StepProps) {
  const landlord = profile.landlord ?? EMPTY;
  const [form, setForm] = useState(() => formFrom(landlord));
  const [stored] = useState(() => valuesFrom(formFrom(landlord)));

  useStepAnswers(handle, () => {
    const changes = changedFields(stored, valuesFrom(form));
    if (changes.license_number && !/^[A-Za-z0-9 ./-]+$/.test(changes.license_number)) {
      return {
        problem: 'Use only letters, numbers, spaces, dots, slashes and dashes in the licence number.',
        field: 'onboarding-licence',
      };
    }
    const portfolio = changes.portfolio_size;
    if (portfolio != null && !(Number.isInteger(portfolio) && portfolio >= 0 && portfolio <= 10_000)) {
      return { problem: 'Enter how many properties you rent out, as a whole number.', field: 'onboarding-portfolio' };
    }
    return patchOf({ landlord: changes }, changes);
  });

  function change(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Input
          id="onboarding-agency"
          label="Agency or business name (optional)"
          autoComplete="organization"
          maxLength={120}
          value={form.agency_name}
          onChange={(event) => change('agency_name', event.target.value)}
        />
      </div>
      <div>
        <Input
          id="onboarding-licence"
          label="Licence number (optional)"
          maxLength={40}
          aria-describedby="onboarding-licence-hint"
          value={form.license_number}
          onChange={(event) => change('license_number', event.target.value)}
        />
        <p id="onboarding-licence-hint" className={HINT}>
          Private: never shown on your profile.
        </p>
      </div>
      <Input
        id="onboarding-portfolio"
        label="Properties you rent out"
        type="number"
        min={0}
        max={10_000}
        inputMode="numeric"
        value={form.portfolio_size}
        onChange={(event) => change('portfolio_size', event.target.value)}
      />
    </div>
  );
}
