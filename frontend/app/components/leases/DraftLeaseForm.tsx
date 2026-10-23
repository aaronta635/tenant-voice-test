'use client';

import { useId, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import { ApiError } from '@/app/lib/api';
import { addToDate, FREQUENCY_LABELS, leasesApi, type Lease, type LeaseCandidate, type RentFrequency } from '@/app/lib/leases';
import { sydneyToday } from '@/app/lib/my-profile';

const label = 'text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body';

/** The draft's starting terms: the tenant's offer, their move-in date, and the listing's lease term. */
function startTerms(candidate: LeaseCandidate) {
  const start = candidate.move_in_date ?? sydneyToday();
  return {
    rent: candidate.offer_weekly_rent !== null ? String(candidate.offer_weekly_rent) : '',
    frequency: 'WEEKLY' as RentFrequency,
    start,
    firstDue: start,
    end: candidate.lease_term_months ? addToDate(start, { months: candidate.lease_term_months, days: -1 }) : '',
  };
}

type Props = { candidate: LeaseCandidate; onCreated: (lease: Lease) => void };

/** The agreed terms of an approved application's lease, which the owner drafts it with. */
export default function DraftLeaseForm({ candidate, onCreated }: Props) {
  const id = useId();
  const [terms, setTerms] = useState(() => startTerms(candidate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof terms>(key: K, value: (typeof terms)[K]) {
    setTerms((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const rent = Number(terms.rent);
    if (!terms.rent.trim() || !Number.isFinite(rent) || rent <= 0 || Math.abs(Math.round(rent * 100) - rent * 100) > 1e-6) {
      setError('Enter the rent in dollars and cents.');
      return;
    }
    if (!terms.start || !terms.firstDue) {
      setError('Choose the start date and the first payment date.');
      return;
    }
    if (terms.end && terms.end < terms.start) {
      setError('The end date cannot be before the start date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await leasesApi.create({
        application_id: candidate.application_id,
        rent_amount: rent,
        rent_frequency: terms.frequency,
        start_date: terms.start,
        first_due_date: terms.firstDue,
        end_date: terms.end || null,
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The lease was not drafted. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Input label="Rent ($)" type="number" inputMode="decimal" min={0.01} step="0.01" value={terms.rent}
          onChange={(event) => set('rent', event.target.value)} />
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={`${id}-frequency`} className={label}>Paid</label>
          <select id={`${id}-frequency`} value={terms.frequency} onChange={(event) => set('frequency', event.target.value as RentFrequency)}
            className="min-h-11 w-full rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong">
            {(Object.keys(FREQUENCY_LABELS) as RentFrequency[]).map((frequency) => (
              <option key={frequency} value={frequency}>{FREQUENCY_LABELS[frequency]}</option>
            ))}
          </select>
        </div>
        <Input label="Starts" type="date" value={terms.start} onChange={(event) => set('start', event.target.value)} />
        <Input label="First payment due" type="date" value={terms.firstDue} onChange={(event) => set('firstDue', event.target.value)} />
        <Input label="Ends (optional)" type="date" value={terms.end} min={terms.start} onChange={(event) => set('end', event.target.value)} />
      </div>
      <p className="text-xs text-text-body">
        These are the terms you agreed with {candidate.tenant.name}. Next you send the lease PDF; they confirm the terms
        and sign it before it becomes active.
      </p>
      <FormMessage error={error} />
      <Button type="submit" className="self-start" disabled={busy}>{busy ? 'Drafting…' : 'Draft the lease'}</Button>
    </form>
  );
}
