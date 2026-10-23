'use client';

import { useId, type ReactNode } from 'react';
import { formatDate, formatMoneyExact } from '@/app/lib/format';
import {
  RECEIPT_METHOD_LABELS,
  receiptStatusLabel,
  type LedgerReceipt,
  type LedgerTotals,
} from '@/app/lib/rent-ledger';

/** What every ledger surface says about receipts: they are the owner's own records. */
export const RECORDED_BY_OWNER =
  'Receipts are recorded by the owner from what they received. TenantVoice does not collect rent or take payments online.';

/** The six figures the screen, the CSV and the printout all show, in one order. */
export const TOTALS: { key: keyof LedgerTotals; label: string; hint: string }[] = [
  { key: 'rent_due', label: 'Rent due', hint: 'Charges shown' },
  { key: 'received', label: 'Received', hint: 'Receipts recorded by you' },
  { key: 'outstanding', label: 'Outstanding', hint: 'Still owing' },
  { key: 'overdue', label: 'Overdue', hint: 'Owing past the due date' },
  { key: 'expenses', label: 'Expenses', hint: 'Recorded expenses' },
  { key: 'net', label: 'Net', hint: 'Received less expenses' },
];

export function totalValue(totals: LedgerTotals, key: keyof LedgerTotals): string {
  return key === 'charges' ? String(totals.charges) : formatMoneyExact(totals[key]);
}

/** One receipt: the amount, when and how it arrived, who recorded it, and any correction. */
export function ReceiptLine({ receipt, action }: { receipt: LedgerReceipt; action?: ReactNode }) {
  const cancelled = receipt.status === 'CANCELLED';
  const details = [
    receipt.received_on ? `Received ${formatDate(receipt.received_on)}` : `Recorded ${formatDate(receipt.recorded_at)}`,
    receipt.method ? RECEIPT_METHOD_LABELS[receipt.method] : null,
    receipt.reference ? `Ref. ${receipt.reference}` : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-1 border-t border-border py-2 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className={`font-semibold text-text-dark ${cancelled ? 'line-through' : ''}`}>{formatMoneyExact(receipt.amount)}</span>
          <span className="text-text-body">{receipt.source_label}</span>
          <span className="text-xs font-semibold text-text-body">· {receiptStatusLabel(receipt)}</span>
        </p>
        <p className="break-words text-xs text-text-body">{details.join(' · ')}</p>
        {receipt.note ? <p className="break-words text-xs text-text-body">Note: {receipt.note}</p> : null}
        {cancelled && receipt.correction_note ? (
          <p className="break-words text-xs text-danger">
            Correction{receipt.corrected_at ? ` on ${formatDate(receipt.corrected_at)}` : ''}: {receipt.correction_note}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

/** A labelled select whose first option clears the choice. */
export function LedgerSelect({ label, value, options, onChange, allLabel }: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
      >
        {allLabel !== undefined ? <option value="">{allLabel}</option> : null}
        {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      </select>
    </div>
  );
}
