import { cleanup, click, descendants, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { Referral } from '@/app/lib/housing-api';
import HousingReferrals from './HousingReferrals';

const mocks = vi.hoisted(() => ({ referrals: vi.fn(), act: vi.fn(), download: vi.fn() }));
vi.mock('@/app/lib/housing-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/housing-api')>()),
  housingApi: { referrals: mocks.referrals, actOnReferral: mocks.act },
}));
vi.mock('@/app/lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/csv')>()),
  downloadCsv: mocks.download,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const CASE: Referral = {
  id: 'ref-1', alert_id: 'alert-1', complaint_id: 'complaint-1', case_reference: 'TV-E5000000', severity: 'critical',
  status: 'New', package_status: 'REFERRED', title: 'Mould and no hot water', reason: 'Open 21 days with 3 complaints at the same home.',
  category: 'Maintenance', area: 'Glebe', address: '12 Harbour St, Glebe, NSW, 2037', assigned_team: 'Housing Resolution Team',
  admin_note: 'Owner has not answered in three weeks.', regulator_note: null,
  referred_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T01:00:00Z',
  complaint: { description: 'Mould in every room.', category: 'MAINTENANCE', severity: 'CRITICAL', status: 'ESCALATED', lodged_at: '2026-10-01T00:00:00Z' },
  parties: { tenant_name: 'Tess Tenant', owner_name: 'Owen Owner' },
  evidence: {
    trigger_reason: 'Open 21 days', days_open: 21, property_open_complaints: 3, owner_open_complaints: 4, photo_count: 2,
    documents_verified: true, work_order_status: 'OPEN', events: [{ type: 'LODGED', note: 'Lodged by the tenant.', created_at: '2026-10-01T00:00:00Z' }],
  },
};

const note = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'TEXTAREA') as FakeElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.referrals.mockResolvedValue([CASE]);
  mocks.act.mockResolvedValue({ id: 'ref-1', status: 'Under review', package_status: 'UNDER_REVIEW', regulator_note: 'Asked the owner.', updated_at: '2026-10-21T00:00:00Z' });
});
afterEach(cleanup);

describe('the referrals page', () => {
  it('shows each referred case with its package, in Sydney time', async () => {
    const view = await render(<HousingReferrals />);

    expect(textOf(view)).toContain('TV-E5000000');
    expect(textOf(view)).toContain('Mould and no hot water');
    expect(textOf(view)).toContain('Critical');
    expect(textOf(view)).toContain('New');
    expect(textOf(view)).toContain('Admin note: Owner has not answered in three weeks.');
    // 1 am UTC is noon in Sydney (daylight saving).
    expect(textOf(view)).toContain('12:00');
    expect(textOf(view)).toContain('Tess Tenant');
    expect(textOf(view)).toContain('Mould in every room.');
    expect(textOf(view)).toContain('Lodged by the tenant.');
    expect(descendants(view).filter((element) => element.tagName === 'BUTTON').map(textOf)).toEqual(
      expect.arrayContaining(['Start review', 'Close']),
    );
  });

  it('starts the review with the note and shows the new status', async () => {
    const view = await render(<HousingReferrals />);
    await typeInto(note(view), '  Asked the owner.  ');

    await click(getByName(view, 'button', 'Start review'));

    expect(mocks.act).toHaveBeenCalledWith('ref-1', 'START_REVIEW', 'Asked the owner.');
    expect(textOf(view)).toContain('Saved: the case is now under review.');
    expect(textOf(view)).toContain('Officer note: Asked the owner.');
    // The actions follow the new status.
    expect(getByName(view, 'button', 'Mark package ready')).toBeTruthy();
  });

  it('sends one action however often it is clicked while saving', async () => {
    let finish!: (value: unknown) => void;
    mocks.act.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = await render(<HousingReferrals />);

    await click(getByName(view, 'button', 'Start review'));
    await click(getByName(view, 'button', 'Saving…'));
    await click(getByName(view, 'button', 'Close'));
    finish({ id: 'ref-1', status: 'Under review', package_status: 'UNDER_REVIEW', regulator_note: null, updated_at: null });
    await settle();

    expect(mocks.act).toHaveBeenCalledTimes(1);
  });

  it('keeps the case and says why when the server refuses', async () => {
    mocks.act.mockRejectedValue(new ApiError(404, 'Referral package not found.'));
    const view = await render(<HousingReferrals />);

    await click(getByName(view, 'button', 'Close'));

    expect(textOf(view)).toContain('Referral package not found.');
    expect(textOf(view)).toContain('New');
  });

  it('downloads the cases shown as CSV', async () => {
    const view = await render(<HousingReferrals />);

    await click(getByName(view, 'button', 'Download CSV of referrals'));

    const [filename, csv] = mocks.download.mock.calls[0];
    expect(filename).toMatch(/^housing-referrals-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.split('\r\n')[0]).toBe('Case,Title,Category,Severity,Area,Status,Assigned team,Referred,Updated,Officer note');
    expect(csv.split('\r\n')[1]).toBe(
      'TV-E5000000,Mould and no hot water,Maintenance,critical,Glebe,New,Housing Resolution Team,2026-10-20 12:00,2026-10-20 12:00,',
    );
  });

  it('says when nothing has been referred, and when the list cannot load', async () => {
    mocks.referrals.mockResolvedValueOnce([]);
    const empty = await render(<HousingReferrals />);
    expect(textOf(empty)).toContain('No referrals yet');
    expect(getByName(empty, 'a', 'red-flag alerts').getAttribute('href')).toBe('/housing/red-flags');
    await cleanup();

    mocks.referrals.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const failed = await render(<HousingReferrals />);
    expect(textOf(failed)).toContain("Couldn't load the referrals");
    await click(getByName(failed, 'button', 'Try again'));
    expect(textOf(failed)).toContain('TV-E5000000');
  });

  it('keeps its text at AA contrast, also under the pointer', async () => {
    const view = await render(<HousingReferrals />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
