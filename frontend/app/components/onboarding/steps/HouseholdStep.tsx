'use client';

import { useState } from 'react';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import { defined, focusSoon, patchOf, useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { HINT, LABEL } from '@/app/components/onboarding/styles';
import { changedFields, numberOrNull, numberText, textOrNull, type TenantDetails } from '@/app/lib/my-profile';

type MemberDraft = { key: string; name: string; age: string; relationship: string };

const MAX_MEMBERS = 10;

function formFrom(tenant: TenantDetails) {
  return {
    household_size: numberText(tenant.household_size),
    has_pets: tenant.has_pets,
    pets: tenant.household.pets ?? '',
    members: tenant.household.members.map((member, index): MemberDraft => ({
      key: `stored-${index}`,
      name: member.name,
      age: numberText(member.age),
      relationship: member.relationship ?? '',
    })),
  };
}

function valuesFrom(form: ReturnType<typeof formFrom>) {
  return {
    household_size: numberOrNull(form.household_size),
    has_pets: form.has_pets,
    pets: form.has_pets ? textOrNull(form.pets) : null,
    members: form.members.map((member) => ({
      name: member.name.trim(),
      age: numberOrNull(member.age),
      relationship: textOrNull(member.relationship),
    })),
  };
}

/** What the server would refuse among the changed values (backend schemas/profiles.py). */
function problemWith(changes: Partial<ReturnType<typeof valuesFrom>>): { problem: string; field?: string } | null {
  const size = changes.household_size;
  if (size != null && !(Number.isInteger(size) && size >= 1 && size <= 20)) {
    return { problem: 'Enter how many people will live there, from 1 to 20.', field: 'onboarding-household-size' };
  }
  for (const [index, member] of (changes.members ?? []).entries()) {
    if (!member.name) return { problem: 'Give each person a name, or remove them.', field: `onboarding-member-${index}-name` };
    if (member.age != null && !(Number.isInteger(member.age) && member.age >= 0 && member.age <= 120)) {
      return { problem: `Enter ${member.name}'s age in whole years.`, field: `onboarding-member-${index}-age` };
    }
  }
  return null;
}

/** The household and pets (reference steps 2 and 3): private to the tenant. */
export default function HouseholdStep({ profile, handle }: StepProps) {
  const tenant = profile.tenant as TenantDetails;
  const [form, setForm] = useState(() => formFrom(tenant));
  const [stored] = useState(() => valuesFrom(formFrom(tenant)));
  const [added, setAdded] = useState(0);

  useStepAnswers(handle, () => {
    const changes = changedFields(stored, valuesFrom(form));
    const problem = problemWith(changes);
    if (problem) return problem;
    const { pets, members, ...columns } = changes;
    const household = defined({ pets, members });
    return patchOf({ tenant: { ...columns, ...(Object.keys(household).length ? { household } : {}) } }, changes);
  });

  function change<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeMember(key: string, field: keyof Omit<MemberDraft, 'key'>, value: string) {
    change('members', form.members.map((member) => (member.key === key ? { ...member, [field]: value } : member)));
  }

  function addMember() {
    change('members', [...form.members, { key: `new-${added}`, name: '', age: '', relationship: '' }]);
    setAdded((count) => count + 1);
    focusSoon(`onboarding-member-${form.members.length}-name`);
  }

  function removeMember(index: number) {
    const left = form.members.filter((_, place) => place !== index);
    change('members', left);
    // The pressed Remove is gone: the next person's name takes focus, else the add button.
    focusSoon(left.length ? `onboarding-member-${Math.min(index, left.length - 1)}-name` : 'onboarding-member-add');
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-body">Only you can see your household.</p>
      <div className="max-w-xs">
        <Input
          id="onboarding-household-size"
          label="People moving in, including you"
          type="number"
          min={1}
          max={20}
          inputMode="numeric"
          value={form.household_size}
          onChange={(event) => change('household_size', event.target.value)}
        />
      </div>

      <fieldset className="min-w-0">
        <legend className={LABEL}>Who will live with you</legend>
        {form.members.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-control-border px-4 py-6 text-center text-sm text-text-body">
            No household members added yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {form.members.map((member, index) => (
              <li key={member.key} className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-text-dark">Person {index + 1}</p>
                  <Button variant="ghost" size="sm" onClick={() => removeMember(index)}>
                    Remove<span className="sr-only"> person {index + 1}</span>
                  </Button>
                </div>
                <div className="mt-2 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <Input
                    id={`onboarding-member-${index}-name`}
                    label="Full name"
                    maxLength={120}
                    value={member.name}
                    onChange={(event) => changeMember(member.key, 'name', event.target.value)}
                  />
                  <Input
                    id={`onboarding-member-${index}-age`}
                    label="Age (optional)"
                    type="number"
                    min={0}
                    max={120}
                    inputMode="numeric"
                    value={member.age}
                    onChange={(event) => changeMember(member.key, 'age', event.target.value)}
                  />
                  <div className="sm:col-span-2">
                    <Input
                      id={`onboarding-member-${index}-relationship`}
                      label="Relationship to you"
                      placeholder="Partner, friend, sibling"
                      maxLength={60}
                      value={member.relationship}
                      onChange={(event) => changeMember(member.key, 'relationship', event.target.value)}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button
          id="onboarding-member-add"
          variant="secondary"
          className="mt-3 w-full border-dashed"
          onClick={addMember}
          disabled={form.members.length >= MAX_MEMBERS}
        >
          + Add another person
        </Button>
        {form.members.length >= MAX_MEMBERS ? <p className={HINT}>You can add up to {MAX_MEMBERS} people.</p> : null}
      </fieldset>

      <div className="space-y-3">
        <label className="flex min-h-11 items-center gap-3 text-sm text-text-dark">
          <input
            type="checkbox"
            checked={form.has_pets}
            onChange={(event) => change('has_pets', event.target.checked)}
            className="size-4 shrink-0 accent-primary-strong"
          />
          Pets will live with us
        </label>
        {form.has_pets ? (
          <Input
            id="onboarding-pets"
            label="About your pets"
            placeholder="One small dog"
            maxLength={200}
            value={form.pets}
            onChange={(event) => change('pets', event.target.value)}
          />
        ) : null}
      </div>
    </div>
  );
}
