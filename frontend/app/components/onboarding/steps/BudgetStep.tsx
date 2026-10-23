'use client';

import { useState } from 'react';
import Input from '@/app/components/ui/Input';
import { patchOf, useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { HINT, LABEL } from '@/app/components/onboarding/styles';
import { changedFields, moveInRange, numberOrNull, numberText, type TenantDetails } from '@/app/lib/my-profile';

function formFrom(tenant: TenantDetails) {
  return {
    budget_min: numberText(tenant.budget_min),
    budget_max: numberText(tenant.budget_max),
    move_in_date: tenant.move_in_date ?? '',
  };
}

function valuesFrom(form: ReturnType<typeof formFrom>) {
  return {
    budget_min: numberOrNull(form.budget_min),
    budget_max: numberOrNull(form.budget_max),
    move_in_date: form.move_in_date || null,
  };
}

/**
 * What the server would refuse among the changed values. The budget is
 * checked whole once either end changed, as the server checks the row.
 */
function problemWith(values: ReturnType<typeof valuesFrom>, changes: Partial<typeof values>) {
  if ('budget_min' in changes || 'budget_max' in changes) {
    const { budget_min: low, budget_max: high } = values;
    for (const [budget, field] of [[low, 'onboarding-budget-min'], [high, 'onboarding-budget-max']] as const) {
      if (budget != null && !(budget >= 0 && budget <= 20_000)) return { problem: 'Enter a weekly budget from $0 to $20,000.', field };
    }
    if (low != null && high != null && low > high) {
      return { problem: "The minimum budget can't be more than the maximum.", field: 'onboarding-budget-min' };
    }
  }
  const { min, max } = moveInRange();
  if (changes.move_in_date && !(changes.move_in_date >= min && changes.move_in_date <= max)) {
    return { problem: 'Choose a move-in date between a year ago and two years from today.', field: 'onboarding-move-in' };
  }
  return null;
}

/** The weekly budget and move-in date (reference step 6): public, on the tenant's profile. */
export default function BudgetStep({ profile, handle }: StepProps) {
  const tenant = profile.tenant as TenantDetails;
  const [form, setForm] = useState(() => formFrom(tenant));
  const [stored] = useState(() => valuesFrom(formFrom(tenant)));
  const { min, max } = moveInRange();

  useStepAnswers(handle, () => {
    const values = valuesFrom(form);
    const changes = changedFields(stored, values);
    return problemWith(values, changes) ?? patchOf({ tenant: changes }, changes);
  });

  function change(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <fieldset className="min-w-0">
        <legend className={LABEL}>Weekly budget</legend>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <Input
            id="onboarding-budget-min"
            label="Minimum ($/week)"
            type="number"
            min={0}
            max={20_000}
            inputMode="numeric"
            placeholder="300"
            value={form.budget_min}
            onChange={(event) => change('budget_min', event.target.value)}
          />
          <Input
            id="onboarding-budget-max"
            label="Maximum ($/week)"
            type="number"
            min={0}
            max={20_000}
            inputMode="numeric"
            placeholder="700"
            value={form.budget_max}
            onChange={(event) => change('budget_max', event.target.value)}
          />
        </div>
      </fieldset>
      <div>
        <Input
          id="onboarding-move-in"
          label="Preferred move-in date"
          type="date"
          min={min}
          max={max}
          aria-describedby="onboarding-move-in-hint"
          value={form.move_in_date}
          onChange={(event) => change('move_in_date', event.target.value)}
        />
        <p id="onboarding-move-in-hint" className={HINT}>
          Owners see the month. Leave it empty if you are flexible.
        </p>
      </div>
      <p className="text-xs text-text-body">Your budget and move-in month show on your public profile.</p>
    </div>
  );
}
