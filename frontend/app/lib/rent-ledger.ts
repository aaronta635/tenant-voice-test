// The owner's rent ledger and the tenant's rent (backend /me/rent, tracker R27).
// Receipts are recorded by the owner: TenantVoice never collects rent or takes
// a payment online. The server checks on every request that the caller is the
// owner of the tenancy, or the tenant.

import { apiFetch } from './api';

export type PaymentStatus = 'PAID' | 'OVERDUE' | 'PARTIALLY_PAID' | 'UNPAID';
export type ReceiptMethod = 'bank_transfer' | 'cash' | 'cheque' | 'card' | 'other';
export type ReceiptSource = 'owner_recorded' | 'stripe' | 'other';
export type ExpenseCategory =
  | 'repairs' | 'cleaning' | 'insurance' | 'council_rates' | 'strata' | 'utilities' | 'agent_fees' | 'other';

export type LedgerReceipt = {
  id: string;
  charge_id: string;
  amount: number;
  /** rent_payments.status: SUCCEEDED, CANCELLED after a correction, or another app's. */
  status: string;
  /** Whether it counts toward the charge's balance. */
  counted: boolean;
  source: ReceiptSource;
  /** "Recorded by owner" for the owner's own receipts. */
  source_label: string;
  received_on: string | null;
  method: ReceiptMethod | null;
  reference: string | null;
  note: string | null;
  recorded_at: string;
  correctable: boolean;
  corrected_at: string | null;
  correction_note: string | null;
};

export type LedgerCharge = {
  id: string;
  agreement_id: string;
  listing_id: string;
  listing_title: string;
  property_address: string | null;
  tenant_id: string;
  tenant_name: string | null;
  period_start: string;
  period_end: string;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  amount_outstanding: number;
  payment_status: PaymentStatus;
  receipts: LedgerReceipt[];
};

export type LedgerExpense = {
  id: string;
  listing_id: string;
  listing_title: string;
  title: string;
  amount: number;
  date: string | null;
  category: string | null;
  note: string | null;
  status: string;
  counted: boolean;
  created_at: string;
  corrected_at: string | null;
  correction_note: string | null;
};

export type LedgerAgreement = {
  id: string;
  listing_id: string;
  listing_title: string;
  property_address: string | null;
  tenant_id: string;
  tenant_name: string | null;
  rent_amount: number;
  rent_frequency: string;
  start_date: string;
  end_date: string | null;
  first_due_date: string;
};

export type LedgerListing = {
  id: string;
  title: string;
  property_address: string | null;
  rented: boolean;
  takes_expenses: boolean;
};

export type LedgerTotals = {
  charges: number;
  rent_due: number;
  received: number;
  outstanding: number;
  overdue: number;
  expenses: number;
  net: number;
};

export type RentLedger = {
  /** Sydney's calendar day, which OVERDUE is measured against. */
  today: string;
  generated_at: string;
  filters: { listing_id: string | null; tenant_id: string | null; from_date: string | null; to_date: string | null };
  listings: LedgerListing[];
  tenants: { id: string; name: string | null }[];
  agreements: LedgerAgreement[];
  charges: LedgerCharge[];
  expenses: LedgerExpense[];
  totals: LedgerTotals;
};

export type ChargeRun = { created: number; message: string };

export type ReceiptDraft = {
  amount: number;
  received_on: string;
  method: ReceiptMethod;
  reference: string | null;
  note: string | null;
  /** Made once per receipt form: sending the form again never records it twice. */
  idempotency_key: string;
};

export type ExpenseDraft = {
  listing_id: string;
  title: string;
  amount: number;
  date: string;
  category: ExpenseCategory;
  note: string | null;
  /** Made once per expense form. */
  request_id: string;
};

export type TenantCharge = {
  id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  amount_outstanding: number;
  payment_status: PaymentStatus;
};

export type TenantAgreement = {
  id: string;
  listing_id: string;
  listing_title: string | null;
  locality: string | null;
  rent_amount: number;
  rent_frequency: string;
  start_date: string;
  first_due_date: string;
  charges: TenantCharge[];
};

export type TenantRent = {
  today: string;
  agreements: TenantAgreement[];
  totals: { rent_due: number; paid: number; outstanding: number; overdue: number };
};

/** The ledger's filters as the page URL holds them: ?listing=&tenant=&from=&to= (Sydney days). */
export type LedgerFilters = { listing: string; tenant: string; from: string; to: string };

export const NO_FILTERS: LedgerFilters = { listing: '', tenant: '', from: '', to: '' };

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  PARTIALLY_PAID: 'Part paid',
  UNPAID: 'Unpaid',
};

export const RECEIPT_METHOD_LABELS: Record<ReceiptMethod, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  cheque: 'Cheque',
  card: 'Card',
  other: 'Other',
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  repairs: 'Repairs and maintenance',
  cleaning: 'Cleaning',
  insurance: 'Insurance',
  council_rates: 'Council rates',
  strata: 'Strata',
  utilities: 'Utilities',
  agent_fees: 'Agent fees',
  other: 'Other',
};

const PER: Record<string, string> = { WEEKLY: 'week', FORTNIGHTLY: 'fortnight', MONTHLY: 'month' };

/** "per week", from rent_agreements.rent_frequency. */
export function rentPeriod(frequency: string): string {
  return `per ${PER[frequency] ?? frequency.toLowerCase()}`;
}

/** What a receipt's status means for the balance. */
export function receiptStatusLabel(receipt: Pick<LedgerReceipt, 'status' | 'counted'>): string {
  if (receipt.status === 'CANCELLED') return 'Cancelled (corrected)';
  if (receipt.counted) return 'Counted';
  return receipt.status.charAt(0) + receipt.status.slice(1).toLowerCase();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filters in a URL, keeping only ids and calendar days the server accepts. */
export function parseLedgerFilters(params: Pick<URLSearchParams, 'get'>): LedgerFilters {
  const pick = (name: string, pattern: RegExp) => {
    const value = params.get(name) ?? '';
    return pattern.test(value) ? value : '';
  };
  return { listing: pick('listing', UUID), tenant: pick('tenant', UUID), from: pick('from', DAY), to: pick('to', DAY) };
}

/** The page URL of the ledger, or of its printable statement, with these filters. */
export function ledgerHref(path: '/owner/rent' | '/owner/rent/print', filters: LedgerFilters): string {
  const params = new URLSearchParams();
  for (const key of ['listing', 'tenant', 'from', 'to'] as const) if (filters[key]) params.set(key, filters[key]);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Whether any filter narrows the ledger. */
export function isFiltered(filters: LedgerFilters): boolean {
  return Boolean(filters.listing || filters.tenant || filters.from || filters.to);
}

function ledgerQuery(filters: LedgerFilters) {
  return { listing_id: filters.listing, tenant_id: filters.tenant, from: filters.from, to: filters.to };
}

/** A new id for one receipt or expense form, kept while that form is open. */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Today in Sydney as YYYY-MM-DD, the latest day a receipt or an expense may carry. */
export function sydneyToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(now);
}

/** The file name the export saves as, as the server names it. */
export function csvFileName(ledger: Pick<RentLedger, 'today'>): string {
  return `rent-ledger-${ledger.today}.csv`;
}

/** Saves CSV text as a file; the byte order mark lets spreadsheet apps read names as UTF-8. */
export function saveCsv(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([`﻿${text.replace(/^﻿/, '')}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The tenant's next charge to pay: the earliest one not yet paid. */
export function nextCharge(charges: TenantCharge[]): TenantCharge | null {
  return [...charges].sort((a, b) => a.due_date.localeCompare(b.due_date)).find((charge) => charge.payment_status !== 'PAID') ?? null;
}

export const rentLedgerApi = {
  ledger: (filters: LedgerFilters) => apiFetch<RentLedger>('/me/rent/ledger', { query: ledgerQuery(filters) }),
  /** The same ledger as CSV text, totals included. */
  exportCsv: (filters: LedgerFilters) => apiFetch<string>('/me/rent/ledger.csv', { query: ledgerQuery(filters) }),
  /** The owner's explicit action: the tenancy's next charge, if one is due within 7 days. */
  createNextCharge: (agreementId: string) =>
    apiFetch<ChargeRun>(`/me/rent/agreements/${encodeURIComponent(agreementId)}/charges`, { method: 'POST' }),
  recordReceipt: (chargeId: string, draft: ReceiptDraft) =>
    apiFetch<LedgerReceipt>(`/me/rent/charges/${encodeURIComponent(chargeId)}/receipts`, { method: 'POST', body: draft }),
  correctReceipt: (receiptId: string, note: string) =>
    apiFetch<LedgerReceipt>(`/me/rent/receipts/${encodeURIComponent(receiptId)}/correction`, { method: 'POST', body: { note } }),
  addExpense: (draft: ExpenseDraft) => apiFetch<LedgerExpense>('/me/rent/expenses', { method: 'POST', body: draft }),
  correctExpense: (expenseId: string, note: string, requestId: string) =>
    apiFetch<LedgerExpense>(`/me/rent/expenses/${encodeURIComponent(expenseId)}/correction`, {
      method: 'POST', body: { note, request_id: requestId },
    }),
  /** The tenant's own tenancies and charges. */
  tenantRent: () => apiFetch<TenantRent>('/me/rent'),
};
