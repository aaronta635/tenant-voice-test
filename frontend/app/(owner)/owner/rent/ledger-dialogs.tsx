'use client';

import { useId, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import Modal from '@/app/components/ui/Modal';
import { ApiError } from '@/app/lib/api';
import { formatDate, formatMoneyExact } from '@/app/lib/format';
import {
  EXPENSE_CATEGORY_LABELS,
  newRequestId,
  RECEIPT_METHOD_LABELS,
  rentLedgerApi,
  type ExpenseCategory,
  type LedgerCharge,
  type LedgerExpense,
  type LedgerListing,
  type LedgerReceipt,
  type ReceiptMethod,
} from '@/app/lib/rent-ledger';
import { LedgerSelect, RECORDED_BY_OWNER } from './ledger-parts';

const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

/** Whole cents above zero, as the database takes them; null otherwise. */
function amountOf(text: string): number | null {
  const value = text.trim();
  if (!AMOUNT.test(value) || Number(value) <= 0) return null;
  return Number(value);
}

function NoteField({ label, value, onChange, required = false }: {
  label: string; value: string; onChange: (value: string) => void; required?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#565d6d]">{label}</label>
      <textarea
        id={id}
        value={value}
        required={required}
        minLength={required ? 3 : undefined}
        maxLength={500}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0 rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
      />
    </div>
  );
}

/**
 * Record a payment the owner received against one charge. The form keeps one
 * idempotency key while it is open, so sending it again after a failure never
 * records the receipt twice.
 */
export function ReceiptDialog({ charge, today, onClose, onSaved }: {
  charge: LedgerCharge;
  today: string;
  onClose: () => void;
  onSaved: (receipt: LedgerReceipt) => void;
}) {
  const [key] = useState(newRequestId);
  const [amount, setAmount] = useState(charge.amount_outstanding.toFixed(2));
  const [receivedOn, setReceivedOn] = useState(today);
  const [method, setMethod] = useState<ReceiptMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = amountOf(amount);
    if (value === null) return setError('Enter the amount in dollars and cents, above $0.');
    if (value > charge.amount_outstanding) return setError(`That is more than the ${formatMoneyExact(charge.amount_outstanding)} still owing.`);
    if (!receivedOn || receivedOn > today) return setError('Choose the day you received it, today or earlier.');
    setBusy(true);
    setError(null);
    try {
      onSaved(await rentLedgerApi.recordReceipt(charge.id, {
        amount: value, received_on: receivedOn, method, reference: reference.trim() || null, note: note.trim() || null,
        idempotency_key: key,
      }));
    } catch (failure) {
      setError(messageOf(failure, 'The receipt could not be recorded. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <Modal open title="Record a receipt" onClose={onClose} busy={busy}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <p className="text-sm text-text-body">
          {charge.listing_title} · {charge.tenant_name ?? 'Tenant'} · due {formatDate(charge.due_date)}.{' '}
          {formatMoneyExact(charge.amount_outstanding)} still owing.
        </p>
        <p className="text-sm text-text-body">{RECORDED_BY_OWNER}</p>
        <Input label="Amount received (AUD)" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        <Input label="Day received" type="date" max={today} value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} required />
        <LedgerSelect
          label="How it was paid"
          value={method}
          options={Object.entries(RECEIPT_METHOD_LABELS) as [string, string][]}
          onChange={(value) => setMethod(value as ReceiptMethod)}
        />
        <Input label="Reference (optional)" maxLength={80} value={reference} onChange={(event) => setReference(event.target.value)} />
        <NoteField label="Note (optional)" value={note} onChange={setNote} />
        <FormMessage error={error} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record receipt'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Correct a receipt or an expense: it stays in the ledger, cancelled, with the owner's note. */
export function CorrectionDialog({ subject, onClose, onSaved }: {
  subject: { kind: 'receipt'; receipt: LedgerReceipt } | { kind: 'expense'; expense: LedgerExpense };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [requestId] = useState(newRequestId);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const what = subject.kind === 'receipt'
    ? `the receipt of ${formatMoneyExact(subject.receipt.amount)}`
    : `the expense "${subject.expense.title}" of ${formatMoneyExact(subject.expense.amount)}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (note.trim().length < 3) return setError('Say why, in a few words.');
    setBusy(true);
    setError(null);
    try {
      if (subject.kind === 'receipt') await rentLedgerApi.correctReceipt(subject.receipt.id, note.trim());
      else await rentLedgerApi.correctExpense(subject.expense.id, note.trim(), requestId);
      onSaved();
    } catch (failure) {
      setError(messageOf(failure, 'The correction could not be saved. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <Modal open title={subject.kind === 'receipt' ? 'Correct a receipt' : 'Correct an expense'} onClose={onClose} busy={busy}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <p className="text-sm text-text-body">
          This cancels {what}. It stays in the ledger, marked cancelled with your note, and no longer counts.
        </p>
        <NoteField label="Why it is corrected" value={note} onChange={setNote} required />
        <FormMessage error={error} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Keep it</Button>
          <Button type="submit" variant="destructive" disabled={busy}>{busy ? 'Saving…' : 'Cancel it'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Record an expense on one of the owner's properties, as the mobile owner tools do. */
export function ExpenseDialog({ listings, initialListing, today, onClose, onSaved }: {
  listings: LedgerListing[];
  initialListing: string;
  today: string;
  onClose: () => void;
  onSaved: (expense: LedgerExpense) => void;
}) {
  const [requestId] = useState(newRequestId);
  const [listing, setListing] = useState(initialListing || listings[0]?.id || '');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState<ExpenseCategory>('repairs');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = amountOf(amount);
    if (!listing) return setError('Choose the property.');
    if (!title.trim()) return setError('Say what the expense was.');
    if (value === null) return setError('Enter the amount in dollars and cents, above $0.');
    if (!date || date > today) return setError('Choose the day it was paid, today or earlier.');
    setBusy(true);
    setError(null);
    try {
      onSaved(await rentLedgerApi.addExpense({
        listing_id: listing, title: title.trim(), amount: value, date, category, note: note.trim() || null,
        request_id: requestId,
      }));
    } catch (failure) {
      setError(messageOf(failure, 'The expense could not be saved. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <Modal open title="Add an expense" onClose={onClose} busy={busy}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <LedgerSelect
          label="Property"
          value={listing}
          options={listings.map((item) => [item.id, item.title] as [string, string])}
          onChange={setListing}
        />
        <Input label="What it was" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} required />
        <Input label="Amount paid (AUD)" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        <Input label="Day paid" type="date" max={today} value={date} onChange={(event) => setDate(event.target.value)} required />
        <LedgerSelect
          label="Category"
          value={category}
          options={Object.entries(EXPENSE_CATEGORY_LABELS) as [string, string][]}
          onChange={(value) => setCategory(value as ExpenseCategory)}
        />
        <NoteField label="Note (optional)" value={note} onChange={setNote} />
        <FormMessage error={error} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save expense'}</Button>
        </div>
      </form>
    </Modal>
  );
}
