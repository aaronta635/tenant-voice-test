'use client';

import { useState } from 'react';
import ChoiceTiles from '@/app/components/onboarding/ChoiceTiles';
import SelectField from '@/app/components/onboarding/SelectField';
import TextAreaField from '@/app/components/onboarding/TextAreaField';
import { patchOf, useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import {
  changedFields,
  numberText,
  PROPERTY_TYPES,
  textOrNull,
  type PropertyType,
  type TenantDetails,
} from '@/app/lib/my-profile';

type Rooms = 'bedrooms_min' | 'bathrooms_min' | 'parking_min';

const ROOMS: { key: Rooms; label: string; most: number }[] = [
  { key: 'bedrooms_min', label: 'Bedrooms (at least)', most: 4 },
  { key: 'bathrooms_min', label: 'Bathrooms (at least)', most: 3 },
  { key: 'parking_min', label: 'Car spaces (at least)', most: 3 },
];

/** "Any", then 1+ up to the most the field offers, with a stored count outside them, such as 0+ or 5+. */
function roomOptions(most: number, stored: string) {
  const counts = Array.from({ length: most }, (_, index) => String(index + 1));
  if (stored && !counts.includes(stored)) counts.push(stored);
  counts.sort((a, b) => Number(a) - Number(b));
  return [{ value: '', label: 'Any' }, ...counts.map((count) => ({ value: count, label: `${count}+` }))];
}

function formFrom(tenant: TenantDetails) {
  const preferences = tenant.rental_preferences;
  return {
    property_types: preferences.property_types,
    bedrooms_min: numberText(preferences.bedrooms_min),
    bathrooms_min: numberText(preferences.bathrooms_min),
    parking_min: numberText(preferences.parking_min),
    notes: preferences.notes ?? '',
  };
}

function valuesFrom(form: ReturnType<typeof formFrom>) {
  const rooms = (value: string) => (value ? Number(value) : null);
  return {
    property_types: form.property_types,
    bedrooms_min: rooms(form.bedrooms_min),
    bathrooms_min: rooms(form.bathrooms_min),
    parking_min: rooms(form.parking_min),
    notes: textOrNull(form.notes),
  };
}

/** The kind of home a tenant wants (reference steps 7 to 9, as far as the profile keeps them): private. */
export default function PropertyStep({ profile, handle }: StepProps) {
  const tenant = profile.tenant as TenantDetails;
  const [initial] = useState(() => formFrom(tenant));
  const [form, setForm] = useState(initial);
  const [stored] = useState(() => valuesFrom(initial));

  useStepAnswers(handle, () => {
    const changes = changedFields(stored, valuesFrom(form));
    return patchOf({ tenant: { rental_preferences: changes } }, changes);
  });

  function change<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <ChoiceTiles<PropertyType>
        legend="Property types"
        hint="Choose every type you would consider."
        options={PROPERTY_TYPES}
        value={form.property_types}
        onChange={(types) => change('property_types', types)}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {ROOMS.map((room) => (
          <SelectField
            key={room.key}
            id={`onboarding-${room.key.replace('_min', '')}`}
            label={room.label}
            options={roomOptions(room.most, initial[room.key])}
            value={form[room.key]}
            onChange={(count) => change(room.key, count)}
          />
        ))}
      </div>
      <TextAreaField
        id="onboarding-preference-notes"
        label="Anything else you need"
        hint="Only you can see this."
        placeholder="Close to a train station, a quiet street"
        rows={3}
        maxLength={1000}
        value={form.notes}
        onChange={(value) => change('notes', value)}
      />
    </div>
  );
}
