import { cleanup, click, descendants, dispatch, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { RedFlags } from '@/app/lib/housing-api';
import HousingRedFlags from './HousingRedFlags';

const mocks = vi.hoisted(() => ({ redFlags: vi.fn(), setStatus: vi.fn(), download: vi.fn() }));
vi.mock('@/app/lib/housing-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/housing-api')>()),
  housingApi: { redFlags: mocks.redFlags, setFlagStatus: mocks.setStatus },
}));
vi.mock('@/app/lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/csv')>()),
  downloadCsv: mocks.download,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const FLAGS: RedFlags = {
  events: [{
    id: 'ev-1', rule: 'Repeated complaints', severity: 'HIGH', summary: 'Repeated complaints: complaint threshold reached', status: 'OPEN',
    area: 'Glebe NSW', complaint_count: 3, threshold: 3, window_days: 30, details: '3 complaints were recorded for this property within 30 days.',
    triggered_at: '2026-10-20T01:00:00Z', resolved_at: null,
  }],
  alerts: [{ id: 'RF-1001', severity: 'high', title: 'Bond complaints rising', area: 'Parramatta', category: 'Bonds', reports: 12, threshold: 10, status: 'New', raised_at: '2026-10-19T00:00:00Z' }],
};

const statusSelect = (view: FakeElement) => descendants(view).find((element) => element.getAttribute('aria-label') === 'Status of Bond complaints rising') as FakeElement;

const saveButton = (view: FakeElement) => getByName(view, 'button', 'Save the status of Bond complaints rising');

async function choose(select: FakeElement, value: string) {
  select.value = value;
  await dispatch(select, 'change');
}

/** Chooses a status, then saves it. */
async function move(view: FakeElement, value: string) {
  await choose(statusSelect(view), value);
  await click(saveButton(view));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redFlags.mockResolvedValue(structuredClone(FLAGS));
  mocks.setStatus.mockImplementation(async (id: string, status: string) => ({ ...FLAGS.alerts[0], id, status }));
});
afterEach(cleanup);

describe('the red-flag alerts page', () => {
  it('shows the events as recorded, by suburb, with no way to change them', async () => {
    const view = await render(<HousingRedFlags />);

    expect(textOf(view)).toContain('Repeated complaints');
    expect(textOf(view)).toContain('Glebe NSW');
    expect(textOf(view)).toContain('3 complaints were recorded for this property within 30 days.');
    // Only the regulatory alert has a status control.
    expect(descendants(view).filter((element) => element.tagName === 'SELECT')).toHaveLength(1);
    expect(getByName(view, 'a', 'Referrals').getAttribute('href')).toBe('/housing/referrals');
  });

  it('moves a regulatory alert from the status the officer saw', async () => {
    const view = await render(<HousingRedFlags />);

    await move(view, 'Escalated');
    expect(mocks.setStatus).toHaveBeenCalledWith('RF-1001', 'Escalated', 'New');

    // The page now holds the new status: the next change starts from it.
    await move(view, 'Closed');
    expect(mocks.setStatus).toHaveBeenLastCalledWith('RF-1001', 'Closed', 'Escalated');
  });

  it('sends nothing until Save, so stepping through the statuses saves only the one chosen', async () => {
    const view = await render(<HousingRedFlags />);

    // Arrow keys on a closed select fire a change for each status they pass.
    await choose(statusSelect(view), 'Under review');
    await choose(statusSelect(view), 'Escalated');
    expect(mocks.setStatus).not.toHaveBeenCalled();

    await click(saveButton(view));
    expect(mocks.setStatus.mock.calls).toEqual([['RF-1001', 'Escalated', 'New']]);
  });

  it('keeps the controls focusable while saving and sends one save at a time', async () => {
    let finish: (flag: unknown) => void = () => {};
    mocks.setStatus.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = await render(<HousingRedFlags />);

    await choose(statusSelect(view), 'Escalated');
    saveButton(view).focus();
    await click(saveButton(view));
    await click(saveButton(view));

    expect(mocks.setStatus).toHaveBeenCalledTimes(1);
    expect(statusSelect(view).getAttribute('disabled')).toBeNull();
    expect(saveButton(view).getAttribute('disabled')).toBeNull();
    expect(saveButton(view).getAttribute('aria-disabled')).toBe('true');
    expect(view.ownerDocument?.activeElement).toBe(saveButton(view));
    await act(async () => { finish({ ...FLAGS.alerts[0], status: 'Escalated' }); });
    expect(textOf(saveButton(view))).toBe('Save');
  });

  it('says why when the alert moved meanwhile, and keeps what it showed', async () => {
    mocks.setStatus.mockRejectedValue(new ApiError(409, 'This alert is now Under review. Reload the alerts and try again.'));
    const view = await render(<HousingRedFlags />);

    await move(view, 'Closed');

    expect(textOf(view)).toContain('This alert is now Under review. Reload the alerts and try again.');
    // It still holds the status it showed.
    await move(view, 'Escalated');
    expect(mocks.setStatus).toHaveBeenLastCalledWith('RF-1001', 'Escalated', 'New');
  });

  it('downloads each table as CSV', async () => {
    const view = await render(<HousingRedFlags />);

    await click(getByName(view, 'button', 'Download CSV of regulatory alerts'));
    await click(getByName(view, 'button', 'Download CSV of red-flag events'));

    const [[alertsFile, alerts], [eventsFile, events]] = mocks.download.mock.calls;
    expect(alertsFile).toMatch(/^housing-regulatory-alerts-/);
    expect(alerts.split('\r\n')[1]).toBe('Bond complaints rising,Parramatta,Bonds,High,12,10,2026-10-19 11:00,New');
    expect(eventsFile).toMatch(/^housing-red-flag-events-/);
    expect(events.split('\r\n')[0]).toBe('Rule,Area,Status,Complaints,Threshold,Window (days),Triggered,Resolved,Details');
    expect(events).toContain('Repeated complaints,Glebe NSW,Open,3,3,30,2026-10-20 12:00,,3 complaints');
  });

  it('says when there is nothing to show', async () => {
    mocks.redFlags.mockResolvedValue({ events: [], alerts: [] });
    const view = await render(<HousingRedFlags />);

    expect(textOf(view)).toContain('There are no regulatory alerts.');
    expect(textOf(view)).toContain('No home has reached a red-flag threshold.');
    expect(descendants(view).some((element) => textOf(element).startsWith('Download CSV'))).toBe(false);
    expect(lowContrastText(view)).toEqual([]);
  });
});
