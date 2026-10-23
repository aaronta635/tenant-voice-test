'use client';

import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PaymentStatusBadge from '@/app/components/rent/PaymentStatusBadge';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import EmptyState from '@/app/components/ui/EmptyState';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import StatCard from '@/app/components/ui/StatCard';
import { ApiError } from '@/app/lib/api';
import { formatDate, formatMoneyExact } from '@/app/lib/format';
import { setSearchParams } from '@/app/lib/page-url';
import {
  csvFileName,
  EXPENSE_CATEGORY_LABELS,
  isFiltered,
  ledgerHref,
  parseLedgerFilters,
  rentLedgerApi,
  rentPeriod,
  saveCsv,
  type ExpenseCategory,
  type LedgerCharge,
  type LedgerExpense,
  type LedgerFilters,
  type LedgerReceipt,
  type RentLedger,
} from '@/app/lib/rent-ledger';
import { CorrectionDialog, ExpenseDialog, ReceiptDialog } from './ledger-dialogs';
import { LedgerSelect, ReceiptLine, RECORDED_BY_OWNER, TOTALS, totalValue } from './ledger-parts';

type Loaded = { key: string; ledger: RentLedger | null; error: string | null };
type Correcting = { kind: 'receipt'; receipt: LedgerReceipt } | { kind: 'expense'; expense: LedgerExpense };
type Dates = Pick<LedgerFilters, 'from' | 'to'>;

/**
 * The owner's rent ledger (GET /me/rent/ledger), its filters in the URL:
 * ?listing=&tenant=&from=&to=. Reading it writes nothing; a charge is created
 * only by "Create the next charge".
 */
export default function RentLedgerView() {
  const id = useId();
  const params = useSearchParams();
  const filters = parseLedgerFilters(params);
  const { listing, tenant, from, to } = filters;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = JSON.stringify([listing, tenant, from, to, attempt]);
  const current = loaded?.key === key ? loaded : null;
  const ledger = current?.ledger ?? null;
  // The last ledger shown stays while the next one loads, so the page does not jump.
  const [shown, setShown] = useState<RentLedger | null>(null);
  const [dates, setDates] = useState({ values: { from, to } as Dates, seen: `${from}|${to}` });
  const [receiptFor, setReceiptFor] = useState<LedgerCharge | null>(null);
  const [correcting, setCorrecting] = useState<Correcting | null>(null);
  const [addingExpense, setAddingExpense] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ error: string | null; success: string | null }>({ error: null, success: null });

  // The typed dates follow the URL when Back or a link changes them.
  let dateValues = dates.values;
  if (dates.seen !== `${from}|${to}`) {
    dateValues = { from, to };
    setDates({ values: dateValues, seen: `${from}|${to}` });
  }

  useEffect(() => {
    let active = true;
    rentLedgerApi.ledger({ listing, tenant, from, to }).then(
      (found) => {
        if (!active) return;
        setLoaded({ key, ledger: found, error: null });
        setShown(found);
      },
      (error) => { if (active) setLoaded({ key, ledger: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [key, listing, tenant, from, to]);

  const view = ledger ?? (current ? null : shown);
  const reload = () => setAttempt((value) => value + 1);
  const done = (success: string) => {
    setMessage({ error: null, success });
    reload();
  };

  async function createNextCharge(agreementId: string) {
    setCreating(agreementId);
    setMessage({ error: null, success: null });
    try {
      const run = await rentLedgerApi.createNextCharge(agreementId);
      done(run.message);
    } catch (error) {
      setMessage({ error: error instanceof ApiError ? error.message : 'The charge could not be created.', success: null });
    } finally {
      setCreating(null);
    }
  }

  async function exportCsv() {
    if (!view) return;
    setExporting(true);
    setMessage({ error: null, success: null });
    try {
      saveCsv(await rentLedgerApi.exportCsv(filters), csvFileName(view));
      setMessage({ error: null, success: 'The CSV file of this ledger is downloading.' });
    } catch (error) {
      setMessage({ error: error instanceof ApiError ? error.message : 'The export failed. Please try again.', success: null });
    } finally {
      setExporting(false);
    }
  }

  const expenseListings = view?.listings.filter((item) => item.takes_expenses) ?? [];
  const filtered = isFiltered(filters);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Rent ledger"
        description="The rent charges of your active tenancies, the receipts you record and your expenses. Days are Sydney's."
        actions={(
          <>
            <Button type="button" variant="secondary" onClick={exportCsv} disabled={!view || exporting}>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
            <ButtonLink href={ledgerHref('/owner/rent/print', filters)} variant="secondary">Print or save as PDF</ButtonLink>
          </>
        )}
      />

      <p role="note" className="rounded-xl border border-primary/20 bg-surface px-4 py-3 text-sm text-navy">{RECORDED_BY_OWNER}</p>

      <form
        role="search"
        aria-label="Ledger filters"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (dateValues.from && dateValues.to && dateValues.from > dateValues.to) {
            setMessage({ error: 'The start date must be on or before the end date.', success: null });
            return;
          }
          setSearchParams({ from: dateValues.from || null, to: dateValues.to || null }, 'push');
        }}
      >
        <LedgerSelect
          label="Listing"
          value={listing}
          allLabel="All listings"
          options={(view?.listings ?? []).map((item) => [item.id, item.title] as [string, string])}
          onChange={(value) => setSearchParams({ listing: value || null }, 'push')}
        />
        <LedgerSelect
          label="Tenant"
          value={tenant}
          allLabel="All tenants"
          options={(view?.tenants ?? []).map((item) => [item.id, item.name ?? 'Tenant'] as [string, string])}
          onChange={(value) => setSearchParams({ tenant: value || null }, 'push')}
        />
        <Input label="Due from" type="date" value={dateValues.from}
          onChange={(event) => setDates({ values: { ...dateValues, from: event.target.value }, seen: dates.seen })} />
        <Input label="Due to" type="date" value={dateValues.to}
          onChange={(event) => setDates({ values: { ...dateValues, to: event.target.value }, seen: dates.seen })} />
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit">Apply dates</Button>
          {filtered ? (
            <Button type="button" variant="ghost" onClick={() => setSearchParams({ listing: null, tenant: null, from: null, to: null }, 'push')}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </form>
      <p className="-mt-3 text-xs text-text-body">
        Dates choose rent by its due date and expenses by the day they were paid. With a tenant chosen, the expenses are those of the homes they rent.
      </p>

      <FormMessage error={message.error} success={message.success} />

      {!view && !current ? (
        <p role="status" className="text-sm text-text-body">Loading the ledger…</p>
      ) : !view ? (
        <LoadErrorCard title="Couldn't load the rent ledger" message={current?.error ?? undefined} onRetry={reload} />
      ) : (
        <div className="flex min-w-0 flex-col gap-8" aria-busy={!current}>
          <section aria-labelledby={`${id}-totals`}>
            <h2 id={`${id}-totals`} className="sr-only">Totals</h2>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {TOTALS.map((item) => (
                <StatCard key={item.key} label={item.label} value={totalValue(view.totals, item.key)} hint={item.hint} />
              ))}
            </div>
          </section>

          <section aria-labelledby={`${id}-tenancies`} className="flex min-w-0 flex-col gap-3">
            <h2 id={`${id}-tenancies`} className="font-heading text-h4 font-semibold text-text-dark">Tenancies</h2>
            <p className="text-sm text-text-body">
              Charges are created only when you ask. The next one is created once it is due within 7 days, and only once.
            </p>
            {view.agreements.length === 0 ? (
              <EmptyState
                title={filtered ? 'No active tenancy matches' : 'No active tenancies yet'}
                description={filtered ? 'Try another listing or tenant.' : 'Once a lease is active, its rent charges appear here.'}
              />
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {view.agreements.map((agreement) => (
                  <li key={agreement.id}>
                    <Card className="flex h-full flex-col gap-3 p-4">
                      <div className="min-w-0">
                        <p className="break-words font-semibold text-text-dark">{agreement.listing_title}</p>
                        <p className="break-words text-sm text-text-body">
                          {agreement.tenant_name ?? 'Tenant'} · {formatMoneyExact(agreement.rent_amount)} {rentPeriod(agreement.rent_frequency)}
                          {' '}from {formatDate(agreement.first_due_date)}
                          {agreement.end_date ? ` to ${formatDate(agreement.end_date)}` : ''}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="self-start"
                        disabled={creating !== null}
                        onClick={() => createNextCharge(agreement.id)}
                      >
                        {creating === agreement.id ? 'Creating…' : 'Create the next charge'}
                      </Button>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby={`${id}-charges`} className="flex min-w-0 flex-col gap-3">
            <h2 id={`${id}-charges`} className="font-heading text-h4 font-semibold text-text-dark">
              Charges <span className="text-sm font-normal text-text-body">({view.totals.charges})</span>
            </h2>
            {view.charges.length === 0 ? (
              <EmptyState title="No charges" description={filtered ? 'No charge matches these filters.' : 'No rent charge has been created yet.'} />
            ) : (
              <ol className="flex flex-col gap-3">
                {[...view.charges].reverse().map((charge) => (
                  <li key={charge.id}>
                    <ChargeCard
                      charge={charge}
                      onRecord={() => { setMessage({ error: null, success: null }); setReceiptFor(charge); }}
                      onCorrect={(receipt) => { setMessage({ error: null, success: null }); setCorrecting({ kind: 'receipt', receipt }); }}
                    />
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby={`${id}-expenses`} className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id={`${id}-expenses`} className="font-heading text-h4 font-semibold text-text-dark">Expenses</h2>
              {expenseListings.length ? (
                <Button type="button" variant="secondary" onClick={() => { setMessage({ error: null, success: null }); setAddingExpense(true); }}>
                  Add an expense
                </Button>
              ) : null}
            </div>
            {view.expenses.length === 0 ? (
              <EmptyState
                title="No expenses"
                description={expenseListings.length
                  ? (filtered ? 'No expense matches these filters.' : 'Repairs, rates, insurance and the like you record show here.')
                  : 'Expenses are recorded against a property you own.'}
              />
            ) : (
              <ul className="divide-y divide-border rounded-2xl border border-border bg-white">
                {view.expenses.map((expense) => (
                  <li key={expense.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className={`font-semibold text-text-dark ${expense.counted ? '' : 'line-through'}`}>{formatMoneyExact(expense.amount)}</span>
                        <span className="break-words text-sm text-text-dark">{expense.title}</span>
                        {expense.counted ? null : <span className="text-xs font-semibold text-text-body">· Cancelled (corrected)</span>}
                      </p>
                      <p className="break-words text-xs text-text-body">
                        {[expense.listing_title, formatDate(expense.date),
                          expense.category ? (EXPENSE_CATEGORY_LABELS[expense.category as ExpenseCategory] ?? expense.category) : null]
                          .filter(Boolean).join(' · ')}
                      </p>
                      {expense.note ? <p className="break-words text-xs text-text-body">Note: {expense.note}</p> : null}
                      {expense.correction_note ? (
                        <p className="break-words text-xs text-danger">Correction: {expense.correction_note}</p>
                      ) : null}
                    </div>
                    {expense.counted ? (
                      <Button type="button" variant="ghost" size="sm" className="self-start"
                        onClick={() => { setMessage({ error: null, success: null }); setCorrecting({ kind: 'expense', expense }); }}>
                        Correct
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {receiptFor && view ? (
        <ReceiptDialog
          key={receiptFor.id}
          charge={receiptFor}
          today={view.today}
          onClose={() => setReceiptFor(null)}
          onSaved={(receipt) => { setReceiptFor(null); done(`Receipt of ${formatMoneyExact(receipt.amount)} recorded.`); }}
        />
      ) : null}
      {correcting ? (
        <CorrectionDialog
          subject={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={() => { setCorrecting(null); done(correcting.kind === 'receipt' ? 'Receipt corrected.' : 'Expense corrected.'); }}
        />
      ) : null}
      {addingExpense && view ? (
        <ExpenseDialog
          listings={expenseListings}
          initialListing={expenseListings.some((item) => item.id === listing) ? listing : ''}
          today={view.today}
          onClose={() => setAddingExpense(false)}
          onSaved={(expense) => { setAddingExpense(false); done(`Expense of ${formatMoneyExact(expense.amount)} saved.`); }}
        />
      ) : null}
    </div>
  );
}

function ChargeCard({ charge, onRecord, onCorrect }: {
  charge: LedgerCharge;
  onRecord: () => void;
  onCorrect: (receipt: LedgerReceipt) => void;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-text-dark">Due {formatDate(charge.due_date)}</span>
            <PaymentStatusBadge status={charge.payment_status} />
          </p>
          <p className="break-words text-sm text-text-body">
            {charge.listing_title} · {charge.tenant_name ?? 'Tenant'} · {formatDate(charge.period_start)} to {formatDate(charge.period_end)}
          </p>
        </div>
        {charge.amount_outstanding > 0 ? (
          <Button type="button" size="sm" onClick={onRecord}>Record a receipt</Button>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div className="min-w-0"><dt className="text-xs text-text-body">Due</dt><dd className="font-semibold text-text-dark [overflow-wrap:anywhere]">{formatMoneyExact(charge.amount_due)}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-text-body">Received</dt><dd className="font-semibold text-text-dark [overflow-wrap:anywhere]">{formatMoneyExact(charge.amount_paid)}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-text-body">Outstanding</dt><dd className="font-semibold text-text-dark [overflow-wrap:anywhere]">{formatMoneyExact(charge.amount_outstanding)}</dd></div>
      </dl>
      {charge.receipts.length ? (
        <ul aria-label={`Receipts for the charge due ${formatDate(charge.due_date)}`} className="rounded-xl bg-background px-3">
          {charge.receipts.map((receipt) => (
            <ReceiptLine
              key={receipt.id}
              receipt={receipt}
              action={receipt.correctable ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onCorrect(receipt)}>Correct</Button>
              ) : null}
            />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
