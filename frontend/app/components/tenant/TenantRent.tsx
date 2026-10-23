'use client';

import { useEffect, useId, useState } from 'react';
import PaymentStatusBadge from '@/app/components/rent/PaymentStatusBadge';
import Card from '@/app/components/ui/Card';
import EmptyState from '@/app/components/ui/EmptyState';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import StatCard from '@/app/components/ui/StatCard';
import { ApiError } from '@/app/lib/api';
import { formatDate, formatMoneyExact } from '@/app/lib/format';
import { nextCharge, PAYMENT_STATUS_LABELS, rentLedgerApi, rentPeriod, type TenantRent as Rent } from '@/app/lib/rent-ledger';

type Loaded = { attempt: number; rent: Rent | null; error: string | null };

/** What the paid amounts are: whatever is recorded against a charge. TenantVoice takes no rent. */
export const PAID_MEANS =
  'Amounts paid are the payments recorded against each charge, such as the receipts your owner recorded. TenantVoice does not collect rent or take payments.';

/**
 * The tenant's rent (GET /me/rent): each active tenancy's charges and what is
 * paid, from the shared rent summary as the tenant reads it.
 */
export default function TenantRent() {
  const id = useId();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = loaded?.attempt === attempt ? loaded : null;

  useEffect(() => {
    let active = true;
    rentLedgerApi.tenantRent().then(
      (rent) => { if (active) setLoaded({ attempt, rent, error: null }); },
      (error) => { if (active) setLoaded({ attempt, rent: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [attempt]);

  const rent = current?.rent;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="My rent" description="The rent charges of your active tenancies and what has been paid. Days are Sydney's." />
      <p role="note" className="rounded-xl border border-primary/20 bg-surface px-4 py-3 text-sm text-navy">{PAID_MEANS}</p>

      {!current ? (
        <p role="status" className="text-sm text-text-body">Loading your rent…</p>
      ) : !rent ? (
        <LoadErrorCard title="Couldn't load your rent" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
      ) : rent.agreements.length === 0 ? (
        <EmptyState title="No active tenancy" description="When your owner activates your lease, its rent charges show here." />
      ) : (
        <>
          <section aria-labelledby={`${id}-totals`}>
            <h2 id={`${id}-totals`} className="sr-only">Totals</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Rent charged" value={formatMoneyExact(rent.totals.rent_due)} />
              <StatCard label="Paid" value={formatMoneyExact(rent.totals.paid)} />
              <StatCard label="Outstanding" value={formatMoneyExact(rent.totals.outstanding)} />
              <StatCard label="Overdue" value={formatMoneyExact(rent.totals.overdue)} hint="Owing past the due date" />
            </div>
          </section>

          {rent.agreements.map((agreement) => {
            const upcoming = nextCharge(agreement.charges);
            return (
              <section key={agreement.id} aria-labelledby={`${id}-${agreement.id}`} className="flex min-w-0 flex-col gap-3">
                <Card className="flex flex-col gap-2 p-5">
                  <h2 id={`${id}-${agreement.id}`} className="break-words font-heading text-h4 font-semibold text-text-dark">
                    {agreement.listing_title ?? 'Your home'}
                  </h2>
                  {agreement.locality ? <p className="text-sm text-text-body">{agreement.locality}</p> : null}
                  <p className="text-sm text-text-dark">
                    {formatMoneyExact(agreement.rent_amount)} {rentPeriod(agreement.rent_frequency)}, first due {formatDate(agreement.first_due_date)}
                  </p>
                  <p className="text-sm font-semibold text-text-dark">
                    {upcoming
                      ? `Next to pay: ${formatMoneyExact(upcoming.amount_outstanding)} due ${formatDate(upcoming.due_date)} (${PAYMENT_STATUS_LABELS[upcoming.payment_status]})`
                      : agreement.charges.length ? 'Every charge so far is paid.' : 'No rent charge yet.'}
                  </p>
                </Card>
                {agreement.charges.length ? (
                  <ol aria-label={`Charges for ${agreement.listing_title ?? 'your home'}`} className="divide-y divide-border rounded-2xl border border-border bg-white">
                    {[...agreement.charges].reverse().map((charge) => (
                      <li key={charge.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-text-dark">Due {formatDate(charge.due_date)}</span>
                            <PaymentStatusBadge status={charge.payment_status} />
                          </p>
                          <p className="text-xs text-text-body">For {formatDate(charge.period_start)} to {formatDate(charge.period_end)}</p>
                        </div>
                        <p className="text-sm text-text-dark">
                          {formatMoneyExact(charge.amount_paid)} paid of {formatMoneyExact(charge.amount_due)}
                          {charge.amount_outstanding > 0 ? ` · ${formatMoneyExact(charge.amount_outstanding)} owing` : ''}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
