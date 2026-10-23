'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Button from '@/app/components/ui/Button';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { ApiError } from '@/app/lib/api';
import { formatDate, formatDateTime, formatMoneyExact } from '@/app/lib/format';
import {
  EXPENSE_CATEGORY_LABELS,
  ledgerHref,
  parseLedgerFilters,
  PAYMENT_STATUS_LABELS,
  RECEIPT_METHOD_LABELS,
  receiptStatusLabel,
  rentLedgerApi,
  type ExpenseCategory,
  type LedgerReceipt,
  type RentLedger,
} from '@/app/lib/rent-ledger';
import { RECORDED_BY_OWNER, TOTALS, totalValue } from '../ledger-parts';

// The owner shell's sidebar and top bar stay off the paper; the statement has neither.
const PRINT_CSS = '@media print { aside, header { display: none !important; } }';

type Loaded = { key: string; ledger: RentLedger | null; error: string | null };

function receiptText(receipt: LedgerReceipt) {
  return [
    formatMoneyExact(receipt.amount),
    receipt.source_label,
    receipt.received_on ? `received ${formatDate(receipt.received_on)}` : `recorded ${formatDate(receipt.recorded_at)}`,
    receipt.method ? RECEIPT_METHOD_LABELS[receipt.method] : null,
    receipt.reference ? `ref. ${receipt.reference}` : null,
    receiptStatusLabel(receipt),
    receipt.correction_note ? `correction: ${receipt.correction_note}` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * The ledger for the filters in the URL, laid out to print or save as a PDF.
 * It is GET /me/rent/ledger, as the ledger page shows it, so its totals are
 * the page's and the CSV's.
 */
export default function RentStatement() {
  const id = useId();
  const params = useSearchParams();
  const filters = parseLedgerFilters(params);
  const { listing, tenant, from, to } = filters;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = JSON.stringify([listing, tenant, from, to, attempt]);
  const current = loaded?.key === key ? loaded : null;

  useEffect(() => {
    let active = true;
    rentLedgerApi.ledger({ listing, tenant, from, to }).then(
      (found) => {
        if (!active) return;
        setLoaded({ key, ledger: found, error: null });
        // Browsers offer the page title as the PDF's file name.
        document.title = `Rent statement ${found.today} · TenantVoice`;
      },
      (error) => { if (active) setLoaded({ key, ledger: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [key, listing, tenant, from, to]);

  const back = (
    <Link href={ledgerHref('/owner/rent', filters)} className="text-sm font-semibold text-primary-strong">
      ← Back to the ledger
    </Link>
  );
  if (!current) return <div className="flex flex-col gap-4">{back}<p role="status" className="text-sm text-text-body">Loading the statement…</p></div>;
  const ledger = current.ledger;
  if (!ledger) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <LoadErrorCard title="Couldn't load the statement" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
      </div>
    );
  }

  const listingName = ledger.listings.find((item) => item.id === listing)?.title;
  const tenantName = ledger.tenants.find((item) => item.id === tenant)?.name;
  const scope = [
    ['Listing', listing ? (listingName ?? 'Unknown listing') : 'All listings'],
    ['Tenant', tenant ? (tenantName ?? 'Tenant') : 'All tenants'],
    ['Due from', from ? formatDate(from) : 'Any date'],
    ['Due to', to ? formatDate(to) : 'Any date'],
  ];

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {back}
        <Button type="button" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>
      <p className="text-sm text-text-body print:hidden">
        Choose “Save as PDF” in the print dialog. If your browser adds the page address or the date, turn off headers and footers there.
      </p>

      <article aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-6 rounded-2xl border border-border bg-white p-5 sm:p-8 print:border-0 print:p-0">
        <div className="flex flex-col gap-2">
          <h1 id={`${id}-title`} className="font-heading text-h2 font-semibold text-text-dark">Rent statement</h1>
          <p className="text-sm text-text-body">Generated {formatDateTime(ledger.generated_at)}, Sydney time. Overdue means unpaid after its due date in Sydney.</p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {scope.map(([label, value]) => (
              <div key={label} className="flex min-w-0 gap-2">
                <dt className="text-text-body">{label}:</dt>
                <dd className="break-words font-semibold text-text-dark">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-text-dark">{RECORDED_BY_OWNER}</p>
        </div>

        <section aria-labelledby={`${id}-totals`}>
          <h2 id={`${id}-totals`} className="font-heading text-h4 font-semibold text-text-dark">Totals</h2>
          <dl className="mt-2 grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4 border-b border-border py-1.5">
              <dt className="text-text-body">Charges</dt>
              <dd className="font-semibold text-text-dark">{ledger.totals.charges}</dd>
            </div>
            {TOTALS.map((item) => (
              <div key={item.key} className="flex justify-between gap-4 border-b border-border py-1.5">
                <dt className="text-text-body">{item.label}</dt>
                <dd className="font-semibold text-text-dark">{totalValue(ledger.totals, item.key)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby={`${id}-charges`} className="min-w-0">
          <h2 id={`${id}-charges`} className="font-heading text-h4 font-semibold text-text-dark">Charges</h2>
          {ledger.charges.length === 0 ? (
            <p className="mt-2 text-sm text-text-body">No charges in this statement.</p>
          ) : (
            <>
              <table className="mt-2 hidden w-full table-fixed border-collapse text-left text-sm sm:table print:table">
                <thead>
                  <tr className="border-b border-text-dark text-xs text-text-body">
                    <th scope="col" className="w-[14%] py-1.5 pr-2 font-semibold">Due</th>
                    <th scope="col" className="w-[30%] py-1.5 pr-2 font-semibold">Listing and tenant</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Due amount</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Received</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Outstanding</th>
                    <th scope="col" className="py-1.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.charges.map((charge) => (
                    <ChargeRows key={charge.id} charge={charge} />
                  ))}
                </tbody>
              </table>
              <ol className="mt-2 flex flex-col gap-3 sm:hidden print:hidden">
                {ledger.charges.map((charge) => (
                  <li key={charge.id} className="border-b border-border pb-3 text-sm">
                    <p className="font-semibold text-text-dark">Due {formatDate(charge.due_date)} · {PAYMENT_STATUS_LABELS[charge.payment_status]}</p>
                    <p className="break-words text-text-body">{charge.listing_title} · {charge.tenant_name ?? 'Tenant'}</p>
                    <p className="text-text-dark">
                      {formatMoneyExact(charge.amount_due)} due · {formatMoneyExact(charge.amount_paid)} received · {formatMoneyExact(charge.amount_outstanding)} outstanding
                    </p>
                    {charge.receipts.map((receipt) => (
                      <p key={receipt.id} className="break-words text-xs text-text-body">{receiptText(receipt)}</p>
                    ))}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <section aria-labelledby={`${id}-expenses`} className="min-w-0">
          <h2 id={`${id}-expenses`} className="font-heading text-h4 font-semibold text-text-dark">Expenses</h2>
          {ledger.expenses.length === 0 ? (
            <p className="mt-2 text-sm text-text-body">No expenses in this statement.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {ledger.expenses.map((expense) => (
                <li key={expense.id} className="flex flex-col gap-0.5 border-b border-border py-1.5 text-sm sm:flex-row sm:justify-between sm:gap-4">
                  <span className="min-w-0 break-words text-text-dark">
                    {formatDate(expense.date)} · {expense.listing_title} · {expense.title}
                    {expense.category ? ` · ${EXPENSE_CATEGORY_LABELS[expense.category as ExpenseCategory] ?? expense.category}` : ''}
                    {expense.counted ? '' : ` · Cancelled (corrected)${expense.correction_note ? `: ${expense.correction_note}` : ''}`}
                  </span>
                  <span className={`shrink-0 font-semibold text-text-dark ${expense.counted ? '' : 'line-through'}`}>{formatMoneyExact(expense.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </article>
    </div>
  );
}

function ChargeRows({ charge }: { charge: RentLedger['charges'][number] }) {
  return (
    <>
      <tr className="border-b border-border align-top">
        <td className="py-1.5 pr-2">{formatDate(charge.due_date)}</td>
        <td className="break-words py-1.5 pr-2">{charge.listing_title} · {charge.tenant_name ?? 'Tenant'}</td>
        <td className="py-1.5 pr-2 text-right">{formatMoneyExact(charge.amount_due)}</td>
        <td className="py-1.5 pr-2 text-right">{formatMoneyExact(charge.amount_paid)}</td>
        <td className="py-1.5 pr-2 text-right">{formatMoneyExact(charge.amount_outstanding)}</td>
        <td className="py-1.5">{PAYMENT_STATUS_LABELS[charge.payment_status]}</td>
      </tr>
      {charge.receipts.length ? (
        <tr className="border-b border-border">
          <td />
          <td colSpan={5} className="pb-1.5 text-xs text-text-body">
            {charge.receipts.map((receipt) => <p key={receipt.id} className="break-words">{receiptText(receipt)}</p>)}
          </td>
        </tr>
      ) : null}
    </>
  );
}
