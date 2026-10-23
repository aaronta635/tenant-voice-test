import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { LedgerCharge, RentLedger } from '@/app/lib/rent-ledger';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import RentLedgerView from './RentLedgerView';
import RentStatement from './print/RentStatement';

const navigation = vi.hoisted(() => ({ page: null as FakeHistory | null }));
const mocks = vi.hoisted(() => ({
  ledger: vi.fn(), exportCsv: vi.fn(), createNextCharge: vi.fn(), recordReceipt: vi.fn(), correctReceipt: vi.fn(),
  addExpense: vi.fn(), correctExpense: vi.fn(), tenantRent: vi.fn(), saveCsv: vi.fn(),
}));

vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => {
      const search = useSyncExternalStore(
        (listener) => navigation.page?.subscribe(listener) ?? (() => {}),
        () => navigation.page?.search ?? '',
      );
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/rent-ledger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/rent-ledger')>();
  const { saveCsv, ...api } = mocks;
  return { ...actual, saveCsv, rentLedgerApi: api };
});

const LISTING = 'e7100000-0000-4000-8000-000000000002';
const TENANT = 'e7000000-0000-4000-8000-000000000003';

function charge(id: string, due: string, over: Partial<LedgerCharge> = {}): LedgerCharge {
  return {
    id, agreement_id: 'agreement-1', listing_id: LISTING, listing_title: 'Harbour flat', property_address: '1 Harbour Street',
    tenant_id: TENANT, tenant_name: 'Tanya Tenant', period_start: due, period_end: due, due_date: due, amount_due: 650,
    amount_paid: 0, amount_outstanding: 650, payment_status: 'UNPAID', receipts: [], ...over,
  };
}

const RECEIPT = {
  id: 'receipt-1', charge_id: 'charge-16', amount: 200, status: 'SUCCEEDED', counted: true, source: 'owner_recorded' as const,
  source_label: 'Recorded by owner', received_on: '2026-10-15', method: 'bank_transfer' as const, reference: 'TT-8812',
  note: null, recorded_at: '2026-10-15T01:00:00Z', correctable: true, corrected_at: null, correction_note: null,
};

const LEDGER: RentLedger = {
  today: '2026-10-23',
  generated_at: '2026-10-23T00:00:00Z',
  filters: { listing_id: null, tenant_id: null, from_date: null, to_date: null },
  listings: [{ id: LISTING, title: 'Harbour flat', property_address: '1 Harbour Street', rented: true, takes_expenses: true }],
  tenants: [{ id: TENANT, name: 'Tanya Tenant' }],
  agreements: [{
    id: 'agreement-1', listing_id: LISTING, listing_title: 'Harbour flat', property_address: '1 Harbour Street', tenant_id: TENANT,
    tenant_name: 'Tanya Tenant', rent_amount: 650, rent_frequency: 'WEEKLY', start_date: '2026-10-02', end_date: null,
    first_due_date: '2026-10-02',
  }],
  charges: [
    charge('charge-9', '2026-10-09', { amount_paid: 650, amount_outstanding: 0, payment_status: 'PAID' }),
    charge('charge-16', '2026-10-16', { amount_paid: 200, amount_outstanding: 450, payment_status: 'OVERDUE', receipts: [RECEIPT] }),
    charge('charge-23', '2026-10-23'),
  ],
  expenses: [{
    id: 'expense-1', listing_id: LISTING, listing_title: 'Harbour flat', title: 'Plumber', amount: 120.5, date: '2026-10-20',
    category: 'repairs', note: null, status: 'recorded', counted: true, created_at: '2026-10-20T01:00:00Z', corrected_at: null,
    correction_note: null,
  }],
  totals: { charges: 3, rent_due: 1950, received: 850, outstanding: 1100, overdue: 450, expenses: 120.5, net: 729.5 },
};

let leavePage = () => {};
async function open(ui: ReactNode, href = '/owner/rent') {
  const page = createFakeHistory(href);
  leavePage = page.install(window);
  navigation.page = page;
  return { page, view: await render(ui) };
}

function field(view: FakeElement, text: RegExp): FakeElement {
  const label = descendants(view).find((element) => element.tagName === 'LABEL' && text.test(textOf(element)));
  if (!label) throw new Error(`No label reads ${text}`);
  return descendants(view).find((element) => element.id === label.getAttribute('for')) as FakeElement;
}

const submit = (view: FakeElement, name: string) => dispatch(formOf(getByName(view, 'button', name)), 'submit');

function formOf(element: FakeElement): FakeElement {
  let current: FakeElement | null = element;
  while (current && current.tagName !== 'FORM') current = current.parentElement;
  if (!current) throw new Error('No form');
  return current;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mocks.ledger.mockResolvedValue(LEDGER);
});
afterEach(async () => {
  await cleanup();
  leavePage();
  navigation.page = null;
  vi.unstubAllGlobals();
});

describe('the owner\'s rent ledger', () => {
  it('shows each charge with its balance, the totals, and receipts recorded by the owner', async () => {
    const { view } = await open(<RentLedgerView />);
    const text = textOf(view);

    const badges = descendants(view).filter((element) => element.tagName === 'SPAN' && element.className.includes('rounded-full'));
    expect(badges.map(textOf)).toEqual(['Unpaid', 'Overdue', 'Paid']);
    expect(text).toContain('$1,950.00');
    expect(text).toContain('$729.50');
    expect(text).toContain('Recorded by owner');
    expect(text).toContain('TenantVoice does not collect rent');
    expect(text).not.toMatch(/collected|paid online/i);
    const dueDates = descendants(view).filter((element) => element.tagName === 'SPAN' && /^Due \d/.test(textOf(element))).map(textOf);
    expect(dueDates).toEqual(['Due 23 Oct 2026', 'Due 16 Oct 2026', 'Due 9 Oct 2026']);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('creates a charge only when the owner asks, then reloads', async () => {
    mocks.createNextCharge.mockResolvedValue({ created: 1, message: 'The next rent charge is in the ledger.' });
    const { view } = await open(<RentLedgerView />);

    expect(mocks.createNextCharge).not.toHaveBeenCalled();
    expect(mocks.ledger).toHaveBeenCalledTimes(1);
    await click(getByName(view, 'button', 'Create the next charge'));

    expect(mocks.createNextCharge).toHaveBeenCalledWith('agreement-1');
    expect(mocks.ledger).toHaveBeenCalledTimes(2);
    expect(textOf(view)).toContain('The next rent charge is in the ledger.');
  });

  it('sends a receipt form again with the same key, so a retry never records it twice', async () => {
    mocks.recordReceipt
      .mockRejectedValueOnce(new ApiError(503, 'The ledger could not save the details. Please send it again.'))
      .mockResolvedValueOnce({ ...RECEIPT, id: 'receipt-2', amount: 450 });
    const { view } = await open(<RentLedgerView />);
    const buttons = descendants(view).filter((element) => element.tagName === 'BUTTON' && textOf(element) === 'Record a receipt');
    // Newest first: the charge due on the 16th is the second.
    await click(buttons[1]);
    expect(field(view, /^Amount received/).value).toBe('450.00');
    await submit(view, 'Record receipt');
    expect(textOf(view)).toContain('Please send it again.');
    await submit(view, 'Record receipt');

    const [[firstCharge, first], [, second]] = mocks.recordReceipt.mock.calls;
    expect(firstCharge).toBe('charge-16');
    expect(first).toEqual({ amount: 450, received_on: '2026-10-23', method: 'bank_transfer', reference: null, note: null,
      idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(second.idempotency_key).toBe(first.idempotency_key);
    expect(textOf(view)).toContain('Receipt of $450.00 recorded.');
    expect(mocks.ledger).toHaveBeenCalledTimes(2);
  });

  it('refuses more than is owing, or a day in the future, before sending', async () => {
    const { view } = await open(<RentLedgerView />);
    await click(descendants(view).filter((element) => element.tagName === 'BUTTON' && textOf(element) === 'Record a receipt')[1]);

    await typeInto(field(view, /^Amount received/), '451');
    await submit(view, 'Record receipt');
    expect(textOf(view)).toContain('That is more than the $450.00 still owing.');
    await typeInto(field(view, /^Amount received/), '100');
    await typeInto(field(view, /^Day received/), '2026-10-24');
    await submit(view, 'Record receipt');
    expect(textOf(view)).toContain('Choose the day you received it, today or earlier.');
    expect(mocks.recordReceipt).not.toHaveBeenCalled();
  });

  it('corrects a receipt with a note', async () => {
    mocks.correctReceipt.mockResolvedValue({ ...RECEIPT, status: 'CANCELLED', counted: false });
    const { view } = await open(<RentLedgerView />);
    const receipts = descendants(view).find((element) => element.getAttribute('aria-label') === 'Receipts for the charge due 16 Oct 2026')!;
    await click(getByName(receipts, 'button', 'Correct'));
    await typeInto(field(view, /^Why it is corrected/), 'Entered twice');
    await submit(view, 'Cancel it');

    expect(mocks.correctReceipt).toHaveBeenCalledWith('receipt-1', 'Entered twice');
    expect(textOf(view)).toContain('Receipt corrected.');
  });

  it('exports the ledger shown, with its filters', async () => {
    mocks.exportCsv.mockResolvedValue('Rent ledger,TenantVoice\r\n');
    const { view } = await open(<RentLedgerView />, `/owner/rent?listing=${LISTING}&from=2026-10-01`);

    expect(mocks.ledger).toHaveBeenCalledWith({ listing: LISTING, tenant: '', from: '2026-10-01', to: '' });
    await click(getByName(view, 'button', 'Export CSV'));

    expect(mocks.exportCsv).toHaveBeenCalledWith({ listing: LISTING, tenant: '', from: '2026-10-01', to: '' });
    expect(mocks.saveCsv).toHaveBeenCalledWith('Rent ledger,TenantVoice\r\n', 'rent-ledger-2026-10-23.csv');
    expect(getByName(view, 'a', 'Print or save as PDF').getAttribute('href')).toBe(`/owner/rent/print?listing=${LISTING}&from=2026-10-01`);
  });

  it('keeps the filters in the URL and loads the ledger for them', async () => {
    const { view, page } = await open(<RentLedgerView />);
    const select = field(view, /^Tenant/);
    select.value = TENANT;
    await dispatch(select, 'change');
    await act(async () => page.land());
    await settle();

    expect(page.location.search).toBe(`?tenant=${TENANT}`);
    expect(mocks.ledger).toHaveBeenLastCalledWith({ listing: '', tenant: TENANT, from: '', to: '' });
    expect(getByName(view, 'button', 'Clear filters')).toBeTruthy();
  });

  it('offers a retry when the ledger cannot load, and says when there is nothing yet', async () => {
    mocks.ledger.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    mocks.ledger.mockResolvedValueOnce({ ...LEDGER, agreements: [], charges: [], expenses: [],
      totals: { charges: 0, rent_due: 0, received: 0, outstanding: 0, overdue: 0, expenses: 0, net: 0 } });
    const { view } = await open(<RentLedgerView />);

    expect(textOf(view)).toContain("Couldn't load the rent ledger");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('No active tenancies yet');
    expect(textOf(view)).toContain('No rent charge has been created yet.');
  });
});

describe('the printable statement', () => {
  it('shows the ledger\'s own totals and prints on request', async () => {
    const print = vi.fn();
    Object.assign(window, { print });
    const { view } = await open(<RentStatement />, `/owner/rent/print?listing=${LISTING}`);
    const text = textOf(view);

    expect(mocks.ledger).toHaveBeenCalledWith({ listing: LISTING, tenant: '', from: '', to: '' });
    for (const value of ['$1,950.00', '$850.00', '$1,100.00', '$450.00', '$120.50', '$729.50']) expect(text).toContain(value);
    expect(text).toMatch(/Listing:\s*Harbour flat/);
    expect(text).toContain('Recorded by owner');
    expect(text).not.toMatch(/collected|paid online/i);
    await click(getByName(view, 'button', 'Print / Save PDF'));
    expect(print).toHaveBeenCalled();
    expect(getByName(view, 'a', '← Back to the ledger').getAttribute('href')).toBe(`/owner/rent?listing=${LISTING}`);
  });
});
