import { cleanup, click, descendants, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { TenantRent as Rent } from '@/app/lib/rent-ledger';
import TenantRent from './TenantRent';

const mocks = vi.hoisted(() => ({ tenantRent: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/lib/rent-ledger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/rent-ledger')>()),
  rentLedgerApi: { tenantRent: mocks.tenantRent },
}));

const RENT: Rent = {
  today: '2026-10-23',
  agreements: [{
    id: 'agreement-1', listing_id: 'listing-1', listing_title: 'Harbour flat', locality: 'Wollongong, NSW 2500',
    rent_amount: 650, rent_frequency: 'WEEKLY', start_date: '2026-10-02', first_due_date: '2026-10-02',
    charges: [
      { id: 'c9', period_start: '2026-10-09', period_end: '2026-10-15', due_date: '2026-10-09', amount_due: 650, amount_paid: 650,
        amount_outstanding: 0, payment_status: 'PAID' },
      { id: 'c16', period_start: '2026-10-16', period_end: '2026-10-22', due_date: '2026-10-16', amount_due: 650, amount_paid: 200,
        amount_outstanding: 450, payment_status: 'OVERDUE' },
      { id: 'c23', period_start: '2026-10-23', period_end: '2026-10-29', due_date: '2026-10-23', amount_due: 650, amount_paid: 0,
        amount_outstanding: 650, payment_status: 'UNPAID' },
    ],
  }],
  totals: { rent_due: 1950, paid: 850, outstanding: 1100, overdue: 450 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenantRent.mockResolvedValue(RENT);
});
afterEach(cleanup);

describe('the tenant\'s rent', () => {
  it('shows each charge, what is paid and what to pay next', async () => {
    const view = await render(<TenantRent />);
    const text = textOf(view);

    expect(text).toContain('Harbour flat');
    expect(text).toContain('$650.00 per week, first due 2 Oct 2026');
    expect(text).toContain('Next to pay: $450.00 due 16 Oct 2026 (Overdue)');
    expect(text).toContain('$200.00 paid of $650.00 · $450.00 owing');
    for (const value of ['$1,950.00', '$850.00', '$1,100.00', '$450.00']) expect(text).toContain(value);
    expect(text).toContain('TenantVoice does not collect rent');
    const charges = descendants(view).find((element) => element.getAttribute('aria-label') === 'Charges for Harbour flat')!;
    const dueDates = descendants(charges).filter((element) => element.tagName === 'SPAN' && /^Due /.test(textOf(element))).map(textOf);
    // Newest first.
    expect(dueDates).toEqual(['Due 23 Oct 2026', 'Due 16 Oct 2026', 'Due 9 Oct 2026']);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('says when there is no active tenancy, and offers a retry when the rent cannot load', async () => {
    mocks.tenantRent.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    mocks.tenantRent.mockResolvedValueOnce({ ...RENT, agreements: [], totals: { rent_due: 0, paid: 0, outstanding: 0, overdue: 0 } });
    const view = await render(<TenantRent />);

    expect(textOf(view)).toContain("Couldn't load your rent");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('When your owner activates your lease, its rent charges show here.');
  });
});
