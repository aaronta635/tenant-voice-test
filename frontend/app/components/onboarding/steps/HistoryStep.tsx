'use client';

import { useState } from 'react';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import SelectField from '@/app/components/onboarding/SelectField';
import { focusSoon, useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { HINT } from '@/app/components/onboarding/styles';
import {
  BOND_ANSWERS,
  numberOrNull,
  numberText,
  sydneyToday,
  textOrNull,
  type BondReturned,
  type RentalHistoryInput,
  type TenantDetails,
} from '@/app/lib/my-profile';

const MAX_ENTRIES = 20;
const EMPTY = {
  address: '',
  suburb: '',
  state: '',
  start_date: '',
  end_date: '',
  current: false,
  weekly_rent: '',
  landlord_name: '',
  landlord_contact: '',
  reason_for_leaving: '',
  bond_returned: '' as BondReturned | '',
};
type Draft = typeof EMPTY;
/** The entry being added ('new') or the place of the one being changed. */
type Editing = 'new' | number | null;

const BOND_CHOICES: { value: BondReturned | ''; label: string }[] = [{ value: '', label: 'Not saying' }, ...BOND_ANSWERS];

function draftOf(entry: RentalHistoryInput): Draft {
  return {
    address: entry.address,
    suburb: entry.suburb ?? '',
    state: entry.state ?? '',
    start_date: entry.start_date ?? '',
    end_date: entry.end_date ?? '',
    current: entry.current,
    weekly_rent: numberText(entry.weekly_rent),
    landlord_name: entry.landlord_name ?? '',
    landlord_contact: entry.landlord_contact ?? '',
    reason_for_leaving: entry.reason_for_leaving ?? '',
    bond_returned: entry.bond_returned ?? '',
  };
}

/** The entry a draft makes; an entry being changed keeps its id, so the server keeps what other apps added to it. */
function entryOf(draft: Draft, id?: string): RentalHistoryInput {
  return {
    ...(id ? { id } : {}),
    address: draft.address.trim(),
    suburb: textOrNull(draft.suburb),
    state: textOrNull(draft.state),
    start_date: draft.start_date || null,
    end_date: draft.current ? null : draft.end_date || null,
    current: draft.current,
    weekly_rent: numberOrNull(draft.weekly_rent),
    landlord_name: textOrNull(draft.landlord_name),
    landlord_contact: textOrNull(draft.landlord_contact),
    reason_for_leaving: textOrNull(draft.reason_for_leaving),
    bond_returned: draft.bond_returned || null,
  };
}

const filled = (draft: Draft) => JSON.stringify(draft) !== JSON.stringify(EMPTY);

/** What the server would refuse in an entry (backend schemas/profiles.py, RentalHistoryEntry). */
function problemWith(draft: Draft): { problem: string; field: string } | null {
  const today = sydneyToday();
  if (!draft.address.trim()) return { problem: 'Enter the street address.', field: 'onboarding-history-address' };
  if (draft.start_date && !(draft.start_date >= '1950-01-01' && draft.start_date <= today)) {
    return { problem: 'A tenancy must start between 1950 and today.', field: 'onboarding-history-start' };
  }
  if (!draft.current && draft.end_date && !(draft.end_date >= '1950-01-01' && draft.end_date <= today)) {
    return {
      problem: 'A past tenancy must end between 1950 and today. Tick "This is my current address" if you still live there.',
      field: 'onboarding-history-end',
    };
  }
  if (!draft.current && draft.start_date && draft.end_date && draft.end_date < draft.start_date) {
    return { problem: 'A tenancy cannot end before it starts.', field: 'onboarding-history-end' };
  }
  const rent = numberOrNull(draft.weekly_rent);
  if (rent != null && !(rent >= 0 && rent <= 20_000)) {
    return { problem: 'Enter the weekly rent from $0 to $20,000.', field: 'onboarding-history-rent' };
  }
  return null;
}

function tenancyDates(entry: RentalHistoryInput): string {
  const month = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const start = entry.start_date ? month(entry.start_date) : null;
  const end = entry.current ? 'Current' : entry.end_date ? month(entry.end_date) : null;
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}`;
  return end === 'Current' ? 'Current address' : end ? `Until ${end}` : 'No dates added';
}

/**
 * The tenant's past homes (reference step 13). Addresses are added to the
 * list here and the whole list saves when the tenant moves on, with an
 * address still open in the form; only the tenant sees them.
 */
export default function HistoryStep({ profile, handle }: StepProps) {
  const tenant = profile.tenant as TenantDetails;
  const [entries, setEntries] = useState<RentalHistoryInput[]>(tenant.rental_history);
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const today = sydneyToday();

  /** The list with the open draft in it; a problem when the draft cannot be saved. */
  function withDraft(): RentalHistoryInput[] | { problem: string; field: string } {
    if (editing === null || !filled(draft)) return entries;
    const found = problemWith(draft);
    if (found) return found;
    if (editing === 'new') {
      if (entries.length >= MAX_ENTRIES) {
        return { problem: `You can keep up to ${MAX_ENTRIES} addresses. Remove one to add another.`, field: 'onboarding-history-address' };
      }
      return [...entries, entryOf(draft)];
    }
    return entries.map((entry, index) => (index === editing ? entryOf(draft, entry.id) : entry));
  }

  useStepAnswers(handle, () => {
    const list = withDraft();
    if (!Array.isArray(list)) return list;
    if (JSON.stringify(list) === JSON.stringify(tenant.rental_history)) return null;
    return { patch: { tenant: { rental_history: list } } };
  });

  /** Where focus goes once the form closes: the address it was about, else the add button. */
  function afterForm(index: number | null) {
    focusSoon(index === null ? 'onboarding-history-add' : `onboarding-history-edit-${index}`);
  }

  function open(target: Editing) {
    const was = editing;
    setEditing(target);
    setDraft(typeof target === 'number' ? draftOf(entries[target]) : EMPTY);
    setProblem(null);
    // Opening puts the member at the form's first field; closing returns them to the list.
    if (target !== null) focusSoon('onboarding-history-address');
    else afterForm(typeof was === 'number' ? was : null);
  }

  function keep() {
    const list = withDraft();
    if (!Array.isArray(list)) {
      setProblem(list.problem);
      document.getElementById(list.field)?.focus();
      return;
    }
    setEntries(list);
    setEditing(null);
    setDraft(EMPTY);
    setProblem(null);
    afterForm(editing === 'new' ? list.length - 1 : editing);
  }

  function remove(index: number) {
    const left = entries.filter((_, place) => place !== index);
    setEntries(left);
    // The pressed Remove is gone: the next address takes focus, else the add button.
    afterForm(left.length ? Math.min(index, left.length - 1) : null);
  }

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-5">
      {entries.length === 0 && editing === null ? (
        <p className="rounded-xl border border-warning bg-white px-4 py-3 text-sm text-warning">
          Adding your rental history builds trust with owners.
        </p>
      ) : null}
      {entries.length ? (
        <ul aria-label="Your addresses" className="space-y-3">
          {entries.map((entry, index) => (
            <li key={entry.id ?? `new-${index}`} className="rounded-xl border border-border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-text-dark">
                    {[entry.address, entry.suburb, entry.state].filter(Boolean).join(', ')}
                  </p>
                  <p className="mt-1 text-sm text-text-body">{tenancyDates(entry)}</p>
                  <p className="mt-1 break-words text-xs text-text-body">
                    {[
                      entry.weekly_rent != null ? `$${entry.weekly_rent}/wk` : null,
                      entry.bond_returned ? `Bond: ${BOND_ANSWERS.find((answer) => answer.value === entry.bond_returned)?.label.toLowerCase()}` : null,
                      entry.landlord_name ? `Owner or agent: ${entry.landlord_name}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    id={`onboarding-history-edit-${index}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => open(index)}
                    disabled={editing !== null}
                  >
                    Edit<span className="sr-only"> {entry.address}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() => remove(index)}
                    disabled={editing !== null}
                  >
                    Remove<span className="sr-only"> {entry.address}</span>
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {editing === null ? (
        <Button
          id="onboarding-history-add"
          variant="secondary"
          className="w-full border-dashed"
          onClick={() => open('new')}
          disabled={entries.length >= MAX_ENTRIES}
        >
          + Add address
        </Button>
      ) : (
        <section aria-labelledby="onboarding-history-form" className="rounded-xl border border-control-border p-4 sm:p-5">
          <h2 id="onboarding-history-form" className="font-heading text-base font-semibold text-text-dark">
            {editing === 'new' ? 'Add address' : 'Edit address'}
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                id="onboarding-history-address"
                label="Street address"
                required
                placeholder="12/55 Martin Place"
                maxLength={200}
                value={draft.address}
                onChange={(event) => change('address', event.target.value)}
              />
            </div>
            <Input id="onboarding-history-suburb" label="Suburb" maxLength={80} value={draft.suburb} onChange={(event) => change('suburb', event.target.value)} />
            <Input id="onboarding-history-state" label="State" maxLength={40} value={draft.state} onChange={(event) => change('state', event.target.value)} />
            <Input
              id="onboarding-history-start"
              label="Lease start"
              type="date"
              min="1950-01-01"
              max={today}
              value={draft.start_date}
              onChange={(event) => change('start_date', event.target.value)}
            />
            <Input
              id="onboarding-history-end"
              label="Lease end"
              type="date"
              min="1950-01-01"
              max={today}
              disabled={draft.current}
              value={draft.current ? '' : draft.end_date}
              onChange={(event) => change('end_date', event.target.value)}
            />
            <label className="flex min-h-11 items-center gap-3 text-sm text-text-dark sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.current}
                onChange={(event) => change('current', event.target.checked)}
                className="size-4 shrink-0 accent-primary-strong"
              />
              This is my current address
            </label>
            <Input
              id="onboarding-history-rent"
              label="Weekly rent ($)"
              type="number"
              min={0}
              max={20_000}
              inputMode="numeric"
              value={draft.weekly_rent}
              onChange={(event) => change('weekly_rent', event.target.value)}
            />
            <Input
              id="onboarding-history-reason"
              label="Reason for leaving"
              maxLength={200}
              value={draft.reason_for_leaving}
              onChange={(event) => change('reason_for_leaving', event.target.value)}
            />
            <Input
              id="onboarding-history-landlord"
              label="Owner or agent name"
              maxLength={120}
              value={draft.landlord_name}
              onChange={(event) => change('landlord_name', event.target.value)}
            />
            <Input
              id="onboarding-history-contact"
              label="Owner or agent phone or email"
              maxLength={200}
              value={draft.landlord_contact}
              onChange={(event) => change('landlord_contact', event.target.value)}
            />
            <SelectField<BondReturned | ''>
              id="onboarding-history-bond"
              label="Bond"
              options={BOND_CHOICES}
              value={draft.bond_returned}
              onChange={(answer) => change('bond_returned', answer)}
            />
          </div>
          {problem ? (
            <p role="alert" className="mt-4 rounded-lg border border-danger p-3 text-sm text-danger">
              {problem}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={keep}>
              {editing === 'new' ? 'Add address' : 'Update address'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => open(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}
      <p className={HINT}>Only you can see your addresses and contacts. They save to your account when you continue.</p>
    </div>
  );
}
