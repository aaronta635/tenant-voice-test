'use client';

import { useState } from 'react';
import Input from '@/app/components/ui/Input';
import ChoiceTiles from '@/app/components/onboarding/ChoiceTiles';
import { patchOf, useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { NOTE } from '@/app/components/onboarding/styles';
import {
  changedFields,
  EMPLOYMENT_TYPES,
  numberOrNull,
  numberText,
  textOrNull,
  WORKING_TYPES,
  type EmploymentType,
  type TenantDetails,
} from '@/app/lib/my-profile';

function formFrom(tenant: TenantDetails) {
  const employment = tenant.employment;
  return {
    types: employment.types,
    employer: employment.employer ?? '',
    job_title: employment.job_title ?? '',
    annual_income: numberText(employment.annual_income),
  };
}

function valuesFrom(form: ReturnType<typeof formFrom>) {
  return {
    types: form.types,
    employer: textOrNull(form.employer),
    job_title: textOrNull(form.job_title),
    annual_income: numberOrNull(form.annual_income),
  };
}

/** How the tenant earns (reference step 10), with the employer the profile completion asks for: private. */
export default function EmploymentStep({ profile, handle }: StepProps) {
  const tenant = profile.tenant as TenantDetails;
  const [form, setForm] = useState(() => formFrom(tenant));
  const [stored] = useState(() => valuesFrom(formFrom(tenant)));
  const working = form.types.some((type) => WORKING_TYPES.includes(type));

  useStepAnswers(handle, () => {
    const changes = changedFields(stored, valuesFrom(form));
    const income = changes.annual_income;
    if (income != null && !(income >= 0 && income <= 10_000_000)) {
      return { problem: 'Enter your annual income in dollars, up to 10,000,000.', field: 'onboarding-income' };
    }
    return patchOf({ tenant: { employment: changes } }, changes);
  });

  function change<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-body">Only you can see your employment and income.</p>
      <ChoiceTiles<EmploymentType>
        legend="Employment status"
        options={EMPLOYMENT_TYPES}
        value={form.types}
        onChange={(types) => change('types', types)}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          id="onboarding-employer"
          label={working ? 'Employer or business' : 'Employer or business (if any)'}
          autoComplete="organization"
          maxLength={120}
          value={form.employer}
          onChange={(event) => change('employer', event.target.value)}
        />
        <Input
          id="onboarding-job-title"
          label="Job title"
          autoComplete="organization-title"
          maxLength={120}
          value={form.job_title}
          onChange={(event) => change('job_title', event.target.value)}
        />
        <Input
          id="onboarding-income"
          label="Annual income ($)"
          type="number"
          min={0}
          max={10_000_000}
          inputMode="numeric"
          placeholder="85000"
          value={form.annual_income}
          onChange={(event) => change('annual_income', event.target.value)}
        />
      </div>
      <p className={NOTE}>You can upload payslips or an employment contract in the documents step.</p>
    </div>
  );
}
