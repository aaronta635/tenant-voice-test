import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import {
  csvFileName,
  isFiltered,
  ledgerHref,
  newRequestId,
  nextCharge,
  NO_FILTERS,
  parseLedgerFilters,
  receiptStatusLabel,
  rentLedgerApi,
  rentPeriod,
  sydneyToday,
  type TenantCharge,
} from './rent-ledger';

const LISTING = 'e7100000-0000-4000-8000-000000000002';
const TENANT = 'e7000000-0000-4000-8000-000000000003';

afterEach(() => vi.restoreAllMocks());

describe('the ledger URL', () => {
  it('keeps only ids and calendar days the server accepts', () => {
    const filters = parseLedgerFilters(new URLSearchParams(`listing=${LISTING}&tenant=${TENANT}&from=2026-10-01&to=tomorrow`));

    expect(filters).toEqual({ listing: LISTING, tenant: TENANT, from: '2026-10-01', to: '' });
    expect(parseLedgerFilters(new URLSearchParams('listing=flat;drop&from=1/10/2026'))).toEqual(NO_FILTERS);
    expect(isFiltered(filters)).toBe(true);
    expect(isFiltered(NO_FILTERS)).toBe(false);
  });

  it('writes the same filters for the ledger and its printable statement', () => {
    const filters = { ...NO_FILTERS, listing: LISTING, from: '2026-10-01' };

    expect(ledgerHref('/owner/rent', filters)).toBe(`/owner/rent?listing=${LISTING}&from=2026-10-01`);
    expect(ledgerHref('/owner/rent/print', filters)).toBe(`/owner/rent/print?listing=${LISTING}&from=2026-10-01`);
    expect(ledgerHref('/owner/rent', NO_FILTERS)).toBe('/owner/rent');
  });
});

describe('the requests', () => {
  it('send the filters by the names the server reads, and write only on the owner\'s actions', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});
    const filters = { listing: LISTING, tenant: '', from: '2026-10-01', to: '2026-10-31' };
    const query = { listing_id: LISTING, tenant_id: '', from: '2026-10-01', to: '2026-10-31' };
    const receipt = {
      amount: 200, received_on: '2026-10-22', method: 'cash' as const, reference: null, note: null,
      idempotency_key: 'e7400000-0000-4000-8000-000000000001',
    };

    await rentLedgerApi.ledger(filters);
    await rentLedgerApi.exportCsv(filters);
    await rentLedgerApi.createNextCharge('agreement 1');
    await rentLedgerApi.recordReceipt('charge-1', receipt);
    await rentLedgerApi.correctReceipt('receipt-1', 'Wrong week');
    await rentLedgerApi.correctExpense('expense-1', 'Duplicate', 'request-1');
    await rentLedgerApi.tenantRent();

    expect(fetch.mock.calls).toEqual([
      ['/me/rent/ledger', { query }],
      ['/me/rent/ledger.csv', { query }],
      ['/me/rent/agreements/agreement%201/charges', { method: 'POST' }],
      ['/me/rent/charges/charge-1/receipts', { method: 'POST', body: receipt }],
      ['/me/rent/receipts/receipt-1/correction', { method: 'POST', body: { note: 'Wrong week' } }],
      ['/me/rent/expenses/expense-1/correction', { method: 'POST', body: { note: 'Duplicate', request_id: 'request-1' } }],
      ['/me/rent', undefined],
    ].map(([path, options]) => (options === undefined ? [path] : [path, options])));
  });
});

describe('the wording and the days', () => {
  it('names each receipt by what it does to the balance', () => {
    expect(receiptStatusLabel({ status: 'SUCCEEDED', counted: true })).toBe('Counted');
    expect(receiptStatusLabel({ status: 'CANCELLED', counted: false })).toBe('Cancelled (corrected)');
    expect(receiptStatusLabel({ status: 'PENDING', counted: false })).toBe('Pending');
    expect([rentPeriod('WEEKLY'), rentPeriod('MONTHLY')]).toEqual(['per week', 'per month']);
  });

  it('dates a form by Sydney\'s calendar, which is ahead of UTC', () => {
    expect(sydneyToday(new Date('2026-10-23T12:59:00Z'))).toBe('2026-10-23');
    expect(sydneyToday(new Date('2026-10-23T13:00:00Z'))).toBe('2026-10-24');
    expect(csvFileName({ today: '2026-10-24' })).toBe('rent-ledger-2026-10-24.csv');
  });

  it('makes a new request id for each form', () => {
    const [first, second] = [newRequestId(), newRequestId()];

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).not.toBe(second);
  });

  it('finds the tenant\'s next charge to pay', () => {
    const charge = (id: string, due: string, status: TenantCharge['payment_status']): TenantCharge => ({
      id, period_start: due, period_end: due, due_date: due, amount_due: 650, amount_paid: 0, amount_outstanding: 650,
      payment_status: status,
    });

    expect(nextCharge([charge('c', '2026-10-23', 'UNPAID'), charge('a', '2026-10-09', 'PAID'), charge('b', '2026-10-16', 'OVERDUE')])?.id).toBe('b');
    expect(nextCharge([charge('a', '2026-10-09', 'PAID')])).toBeNull();
  });
});
