import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminAlert } from '@/app/lib/admin-alerts-api';
import { ApiError } from '@/app/lib/api';
import AdminAlerts from './AdminAlerts';

const mocks = vi.hoisted(() => ({ list: vi.fn(), escalate: vi.fn() }));
vi.mock('@/app/lib/admin-alerts-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-alerts-api')>()),
  adminAlertsApi: mocks,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

function alertOf(id: string, over: Partial<AdminAlert> = {}): AdminAlert {
  return {
    id, complaint_id: `c-${id}`, category_id: 'k1', category_name: 'Property condition', routing_team: 'Housing Resolution Team',
    severity: 'HIGH', status: 'OPEN', title: 'Hot water out', reason: 'The complaint exceeded its configured 24-hour response SLA.',
    address: '12 Harbour St, Wollongong, NSW, 2500', area: 'Wollongong', days_open: 3, property_open_complaints: 1,
    owner_open_complaints: 1, photo_count: 0, documents_verified: false, created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-21T00:00:00Z', escalated_at: null, escalation_note: null, ...over,
  };
}

const gas = alertOf('a1', { severity: 'CRITICAL', title: 'Gas smell in the kitchen', reason: 'Multiple unresolved complaints were detected for the same property.', property_open_complaints: 2 });
const water = alertOf('a2');

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};
const openDialog = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open'))!;
const formIn = (element: FakeElement) => descendants(element).find((item) => item.tagName === 'FORM')!;
const cardOf = (view: FakeElement, title: string) =>
  descendants(view).find((element) => element.tagName === 'LI' && textOf(element).startsWith(title))!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([gas, water]);
});
afterEach(cleanup);

describe('the admin alerts', () => {
  it('list each alert with why it was raised, and offer a referral for a critical one only', async () => {
    const view = await render(<AdminAlerts />);

    expect(textOf(view)).toContain('2 alerts, 1 critical');
    const critical = cardOf(view, 'Gas smell in the kitchen');
    expect(textOf(critical)).toContain('Critical');
    expect(textOf(critical)).toContain('Multiple unresolved complaints were detected for the same property.');
    expect(textOf(critical)).toContain('2 open complaints at the property');
    expect(textOf(critical)).toContain('Policy: Property condition');
    expect(getByName(critical, 'button', 'Refer to the Housing Portal: Gas smell in the kitchen')).toBeTruthy();
    const high = cardOf(view, 'Hot water out');
    expect(textOf(high)).toContain('High');
    expect(textOf(high)).toContain('Open 3 days');
    expect(descendants(high).some((element) => element.tagName === 'BUTTON')).toBe(false);
  });

  it('names the tenant verified only when the repair\'s tenant is, and says nothing otherwise', async () => {
    // documents_verified comes from the work order's tenant, so it is false for every general complaint.
    mocks.list.mockResolvedValue([water, alertOf('a3', { title: 'Burst pipe', documents_verified: true })]);
    const view = await render(<AdminAlerts />);

    expect(textOf(cardOf(view, 'Burst pipe'))).toContain('Repair tenant verified');
    expect(textOf(cardOf(view, 'Hot water out'))).not.toContain('verified');
  });

  it('refers a critical alert with a reason, and names its case', async () => {
    mocks.escalate.mockResolvedValue({
      id: 'a1', status: 'ESCALATED', escalated_at: '2026-10-21T03:00:00Z', escalation_note: 'Gas leak not fixed.',
      housing_portal_status: 'REFERRED', case_reference: 'TV-A1B2C3D4E5',
    });
    const view = await render(<AdminAlerts />);

    await click(getByName(view, 'button', 'Refer to the Housing Portal: Gas smell in the kitchen'));
    const dialog = openDialog(view);
    await dispatch(formIn(dialog), 'submit');
    expect(mocks.escalate).not.toHaveBeenCalled();
    await typeInto(field(dialog, 'Reason') as FakeElement, 'Gas leak not fixed.');
    mocks.list.mockResolvedValue([{ ...gas, status: 'ESCALATED', escalated_at: '2026-10-21T03:00:00Z', escalation_note: 'Gas leak not fixed.' }, water]);
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.escalate).toHaveBeenCalledWith('a1', 'Gas leak not fixed.');
    expect(textOf(view)).toContain('Gas smell in the kitchen was referred to the Housing Portal as TV-A1B2C3D4E5.');
    const referred = cardOf(view, 'Gas smell in the kitchen');
    expect(textOf(referred)).toContain('Referred');
    expect(textOf(referred)).toContain('Referred Wed, 21 Oct, 2:00 pm: Gas leak not fixed.');
    expect(getByName(referred, 'button', 'Update the referral: Gas smell in the kitchen')).toBeTruthy();
  });

  it('shows the database\'s refusal in the dialog', async () => {
    mocks.escalate.mockRejectedValue(new ApiError(422, 'Only critical alerts can be referred to the Housing Portal for NCAT preparation.'));
    const view = await render(<AdminAlerts />);

    await click(getByName(view, 'button', 'Refer to the Housing Portal: Gas smell in the kitchen'));
    const dialog = openDialog(view);
    await typeInto(field(dialog, 'Reason') as FakeElement, 'Escalating.');
    await dispatch(formIn(dialog), 'submit');

    expect(textOf(dialog)).toContain('Only critical alerts can be referred to the Housing Portal for NCAT preparation.');
  });

  it('offers a retry when the alerts cannot load, and says when there are none', async () => {
    mocks.list.mockRejectedValueOnce(new ApiError(403, 'You need admin privileges to access this page.')).mockResolvedValueOnce([]);
    const view = await render(<AdminAlerts />);

    expect(textOf(view)).toContain("Couldn't load the alerts");
    expect(textOf(view)).toContain('You need admin privileges to access this page.');
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('No alerts. Every complaint an active policy covers is within its limits.');
  });

  it('keeps the page and the dialog at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminAlerts />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
    await click(getByName(view, 'button', 'Refer to the Housing Portal: Gas smell in the kitchen'));
    expect(lowContrastText(openDialog(view))).toEqual([]);
  });
});
