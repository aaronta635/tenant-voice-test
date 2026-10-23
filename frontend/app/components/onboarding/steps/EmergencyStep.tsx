'use client';

import { useState } from 'react';
import Input from '@/app/components/ui/Input';
import { patchOf, useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { NOTE } from '@/app/components/onboarding/styles';
import { changedFields, isEmail, isPhone, textOrNull, type TenantDetails } from '@/app/lib/my-profile';

function formFrom(tenant: TenantDetails) {
  const contact = tenant.emergency_contact;
  return {
    name: contact.name ?? '',
    relationship: contact.relationship ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
  };
}

function valuesFrom(form: ReturnType<typeof formFrom>) {
  return {
    name: textOrNull(form.name),
    relationship: textOrNull(form.relationship),
    phone: textOrNull(form.phone),
    email: textOrNull(form.email),
  };
}

/** What the server would refuse: once any of it changed, the contact needs a name and a way to reach them. */
function problemWith(values: ReturnType<typeof valuesFrom>, changes: Partial<typeof values>) {
  if (changes.phone && !isPhone(changes.phone)) {
    return { problem: "Enter your emergency contact's phone number, 6 to 15 digits.", field: 'onboarding-emergency-phone' };
  }
  if (changes.email && !isEmail(changes.email)) {
    return { problem: "Enter your emergency contact's email address.", field: 'onboarding-emergency-email' };
  }
  if (Object.keys(changes).length === 0) return null;
  const reachable = Boolean(values.phone || values.email);
  if (!values.name && (reachable || values.relationship)) {
    return { problem: "Add your emergency contact's name.", field: 'onboarding-emergency-name' };
  }
  if (values.name && !reachable) {
    return { problem: 'Add a phone number or email for your emergency contact.', field: 'onboarding-emergency-phone' };
  }
  return null;
}

/** Someone to call in an emergency (reference step 16): optional, and only the tenant sees it. */
export default function EmergencyStep({ profile, handle }: StepProps) {
  const tenant = profile.tenant as TenantDetails;
  const [form, setForm] = useState(() => formFrom(tenant));
  const [stored] = useState(() => valuesFrom(formFrom(tenant)));

  useStepAnswers(handle, () => {
    const values = valuesFrom(form);
    const changes = changedFields(stored, values);
    return problemWith(values, changes) ?? patchOf({ tenant: { emergency_contact: changes } }, changes);
  });

  function change(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-5">
      <p className={NOTE}>Your emergency contact is private. It never appears on your profile, and owners never see it.</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          id="onboarding-emergency-name"
          label="Full name"
          maxLength={120}
          value={form.name}
          onChange={(event) => change('name', event.target.value)}
        />
        <Input
          id="onboarding-emergency-relationship"
          label="Relationship"
          placeholder="Parent, sibling, friend"
          maxLength={60}
          value={form.relationship}
          onChange={(event) => change('relationship', event.target.value)}
        />
        <Input
          id="onboarding-emergency-phone"
          label="Phone"
          type="tel"
          maxLength={30}
          value={form.phone}
          onChange={(event) => change('phone', event.target.value)}
        />
        <Input
          id="onboarding-emergency-email"
          label="Email"
          type="email"
          maxLength={254}
          value={form.email}
          onChange={(event) => change('email', event.target.value)}
        />
      </div>
    </div>
  );
}
