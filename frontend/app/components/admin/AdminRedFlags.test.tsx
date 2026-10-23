import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { RedFlagEvent, RedFlagEventPage, RedFlagRule } from '@/app/lib/red-flags-api';
import AdminRedFlags from './AdminRedFlags';

const mocks = vi.hoisted(() => ({
  rules: vi.fn(), createRule: vi.fn(), updateRule: vi.fn(), setRuleActive: vi.fn(), deleteRule: vi.fn(), evaluate: vi.fn(),
  events: vi.fn(), decide: vi.fn(),
}));
vi.mock('@/app/lib/red-flags-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/red-flags-api')>()),
  redFlagsApi: mocks,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

function ruleOf(id: string, name: string, over: Partial<RedFlagRule> = {}): RedFlagRule {
  return {
    id, rule_key: name.toLowerCase().replace(/\W+/g, '_'), name, description: '', threshold_count: 3, trigger_mode: 'WINDOW',
    window_days: 30, severity: 'HIGH', is_active: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    active_flags: 0, total_flags: 0, ...over,
  };
}

function flagOf(id: string, over: Partial<RedFlagEvent> = {}): RedFlagEvent {
  return {
    id, rule_id: 'r1', rule_name: 'Repeat complaints', summary: 'Repeat complaints: complaint threshold reached', status: 'OPEN',
    triggered_at: '2026-10-20T01:00:00Z', resolved_at: null, property_id: 'p1', address: '12 Harbour St, Wollongong, NSW, 2500',
    listing_id: 'l1', property_title: 'Harbour flat',
    complaint: { id: 'c1', category_label: 'Property condition', status: 'OPEN', lodged_at: '2026-10-20T01:00:00Z' },
    evidence: { details: '3 complaints were recorded for this property within 30 days.', complaintCount: 3, thresholdCount: 3,
      triggerMode: 'WINDOW', windowDays: 30, windowStart: '2026-09-20T01:00:00Z' },
    decisions: [], actions: ['acknowledge', 'resolve', 'dismiss'], ...over,
  };
}

const page = (items: RedFlagEvent[]): RedFlagEventPage => ({ items, total: items.length, limit: 50, offset: 0 });
const repeat = ruleOf('r1', 'Repeat complaints', { active_flags: 1, total_flags: 1 });
const unused = ruleOf('r2', 'Lifetime total', { trigger_mode: 'TOTAL', threshold_count: 10, is_active: false });

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};
const openDialog = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open'))!;
const formIn = (element: FakeElement) => descendants(element).find((item) => item.tagName === 'FORM')!;
const cardOf = (view: FakeElement, text: string) =>
  descendants(view).find((element) => element.tagName === 'LI' && textOf(element).startsWith(text))!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.mockResolvedValue(page([flagOf('f1')]));
  mocks.rules.mockResolvedValue([repeat, unused]);
});
afterEach(cleanup);

describe('the red flags page', () => {
  it('lists the open flags with their evidence, and the rules with what they count', async () => {
    const view = await render(<AdminRedFlags />);

    expect(mocks.events).toHaveBeenCalledWith('OPEN', 1);
    const flag = cardOf(view, 'Repeat complaints: complaint threshold reached');
    expect(textOf(flag)).toContain('Open');
    expect(textOf(flag)).toContain('Harbour flat · 12 Harbour St, Wollongong, NSW, 2500');
    expect(textOf(flag)).toContain('3 complaints were recorded for this property within 30 days.');
    // Sydney time.
    expect(textOf(flag)).toContain('Raised Tue, 20 Oct, 12:00 pm');
    expect(textOf(flag)).toContain('Latest complaint: Property condition, lodged 20 Oct 2026');
    const rule = cardOf(view, 'Repeat complaints');
    expect(textOf(cardOf(view, 'Repeat complaintsActive'))).toContain('A flag at 3 complaints about one property within 30 days');
    expect(textOf(cardOf(view, 'Lifetime total'))).toContain('A flag at 10 complaints about one property in total');
    expect(textOf(cardOf(view, 'Lifetime total'))).toContain('Inactive');
    expect(rule).toBeTruthy();
    // A rule that raised a flag is never deleted.
    expect(descendants(cardOf(view, 'Repeat complaintsActive')).some((element) => textOf(element) === 'Delete Repeat complaints')).toBe(false);
    expect(getByName(cardOf(view, 'Lifetime total'), 'button', 'Delete Lifetime total')).toBeTruthy();
  });

  it('loads the flags of the status chosen', async () => {
    const view = await render(<AdminRedFlags />);
    mocks.events.mockResolvedValue(page([]));

    await click(getByName(view, 'button', 'Resolved'));

    expect(mocks.events).toHaveBeenLastCalledWith('RESOLVED', 1);
    expect(textOf(view)).toContain('No resolved flags.');
  });

  it('pages through more flags than one page holds, and decides a flag on a later page', async () => {
    const first = Array.from({ length: 50 }, (_, index) => flagOf(`f${index + 1}`, { summary: `Flag ${index + 1}` }));
    mocks.events.mockImplementation(async (_status: string, pageNumber: number) => (pageNumber === 1
      ? { items: first, total: 51, limit: 50, offset: 0 }
      : { items: [flagOf('f51', { summary: 'Flag 51' })], total: 51, limit: 50, offset: 50 }));
    mocks.decide.mockResolvedValue(flagOf('f51', { summary: 'Flag 51', status: 'ACKNOWLEDGED', actions: ['resolve', 'dismiss'] }));
    const view = await render(<AdminRedFlags />);

    expect(textOf(view)).toContain('51 flags');
    expect(textOf(view)).toContain('Page 1 of 2');
    expect(textOf(view)).not.toContain('Flag 51');
    await click(getByName(view, 'button', 'Next page of flags ›'));

    expect(mocks.events).toHaveBeenLastCalledWith('OPEN', 2);
    expect(textOf(view)).toContain('Page 2 of 2');
    await click(getByName(view, 'button', 'Acknowledge Flag 51'));
    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ id: 'f51' }), 'acknowledge');

    // Another filter starts at its first page.
    await click(getByName(view, 'button', 'All'));
    expect(mocks.events).toHaveBeenLastCalledWith('', 1);
  });

  it('acknowledges a flag at once, and shows who decided', async () => {
    mocks.decide.mockResolvedValue(flagOf('f1', {
      status: 'ACKNOWLEDGED', actions: ['resolve', 'dismiss'],
      decisions: [{ action: 'acknowledged', from_status: 'OPEN', to_status: 'ACKNOWLEDGED', actor_id: 'a1', actor_name: 'Ada Admin',
        note: null, at: '2026-10-21T02:30:00Z' }],
    }));
    const view = await render(<AdminRedFlags />);

    await click(getByName(view, 'button', 'Acknowledge Repeat complaints: complaint threshold reached'));

    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', status: 'OPEN' }), 'acknowledge');
    const flag = cardOf(view, 'Repeat complaints: complaint threshold reached');
    expect(textOf(flag)).toContain('Acknowledged by Ada Admin · Wed, 21 Oct, 1:30 pm');
    expect(textOf(view)).toContain('Repeat complaints: complaint threshold reached was acknowledged.');
  });

  it('needs a note to resolve a flag, and keeps it with the decision', async () => {
    mocks.decide.mockResolvedValue(flagOf('f1', { status: 'RESOLVED', actions: [] }));
    const view = await render(<AdminRedFlags />);

    await click(getByName(view, 'button', 'Resolve Repeat complaints: complaint threshold reached'));
    const dialog = openDialog(view);
    await dispatch(formIn(dialog), 'submit');
    expect(mocks.decide).not.toHaveBeenCalled();
    await typeInto(field(dialog, 'Reason') as FakeElement, 'The hot water system was replaced.');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), 'resolve', 'The hot water system was replaced.');
    expect(textOf(view)).toContain('Repeat complaints: complaint threshold reached was resolved.');
  });

  it('reloads the flags when another admin decided one first', async () => {
    mocks.decide.mockRejectedValue(new ApiError(409, 'This flag changed while you were looking at it. Reload it and try again.'));
    const view = await render(<AdminRedFlags />);

    await click(getByName(view, 'button', 'Dismiss Repeat complaints: complaint threshold reached'));
    const dialog = openDialog(view);
    await typeInto(field(dialog, 'Reason') as FakeElement, 'Duplicate tenant.');
    await dispatch(formIn(dialog), 'submit');

    expect(textOf(dialog)).toContain('This flag changed while you were looking at it.');
    expect(mocks.events).toHaveBeenCalledTimes(2);
  });

  it('re-evaluates a rule now and says what it opened', async () => {
    mocks.evaluate.mockResolvedValue({ rule_id: 'r1', created: 2, evaluated_at: '2026-10-21T00:00:00Z' });
    const view = await render(<AdminRedFlags />);

    await click(getByName(view, 'button', 'Re-evaluate now Repeat complaints'));

    expect(mocks.evaluate).toHaveBeenCalledWith('r1');
    expect(textOf(view)).toContain('Repeat complaints opened 2 new flags.');
    expect(mocks.events).toHaveBeenCalledTimes(2);
  });

  it('adds a rule within the table\'s limits', async () => {
    mocks.createRule.mockResolvedValue(ruleOf('r3', 'Lifetime complaints', { trigger_mode: 'TOTAL' }));
    const view = await render(<AdminRedFlags />);

    await click(getByName(view, 'button', 'New rule'));
    const dialog = openDialog(view);
    await typeInto(field(dialog, 'Name') as FakeElement, 'Lifetime complaints');
    const threshold = field(dialog, 'Complaints about one property') as FakeElement;
    await typeInto(threshold, '0');
    await dispatch(formIn(dialog), 'submit');
    expect(textOf(dialog)).toContain('Give the number of complaints as a whole number from 1 to 10000.');
    await typeInto(threshold, '12');
    const counted = field(dialog, 'Counted') as FakeElement;
    counted.value = 'TOTAL';
    await dispatch(counted, 'change');
    expect(descendants(dialog).some((element) => element.tagName === 'LABEL' && textOf(element).startsWith('Window'))).toBe(false);
    expect(textOf(dialog)).toContain('A flag is raised at 12 complaints about one property in total, whatever their categories.');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.createRule).toHaveBeenCalledWith({
      name: 'Lifetime complaints', description: '', threshold_count: 12, trigger_mode: 'TOTAL', window_days: 30, severity: 'HIGH',
    });
    expect(textOf(view)).toContain('Lifetime complaints was added and counts new complaints.');
  });

  it('edits only what changed, on the version it opened', async () => {
    mocks.updateRule.mockResolvedValue({ ...repeat, window_days: 14 });
    const view = await render(<AdminRedFlags />);

    await click(getByName(view, 'button', 'Edit Repeat complaints'));
    const dialog = openDialog(view);
    expect(textOf(dialog)).toContain('Key repeat_complaints, which never changes.');
    await typeInto(field(dialog, 'Window') as FakeElement, '14');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.updateRule).toHaveBeenCalledWith(repeat, { window_days: 14 });
  });

  it('needs a reason to switch a rule off, and deletes one that never raised a flag', async () => {
    mocks.setRuleActive.mockResolvedValue({ ...repeat, is_active: false });
    mocks.deleteRule.mockResolvedValue(undefined);
    const view = await render(<AdminRedFlags />);

    await click(getByName(view, 'button', 'Deactivate Repeat complaints'));
    let dialog = openDialog(view);
    expect(textOf(dialog)).toContain('The flags it raised stay, with their evidence');
    await typeInto(field(dialog, 'Reason') as FakeElement, 'Too noisy');
    await dispatch(formIn(dialog), 'submit');
    expect(mocks.setRuleActive).toHaveBeenCalledWith('r1', false, 'Too noisy');
    expect(textOf(view)).toContain('Repeat complaints no longer counts new complaints.');

    await click(getByName(view, 'button', 'Delete Lifetime total'));
    dialog = openDialog(view);
    await click(getByName(dialog, 'button', 'Delete'));
    expect(mocks.deleteRule).toHaveBeenCalledWith('r2');
    expect(textOf(view)).toContain('Lifetime total was deleted.');
  });

  it('retries the flags and the rules on their own when they cannot load, and says when there are none', async () => {
    mocks.events.mockRejectedValueOnce(new ApiError(503, 'Unavailable')).mockResolvedValueOnce(page([]));
    mocks.rules.mockRejectedValueOnce(new ApiError(503, 'Unavailable')).mockResolvedValueOnce([]);
    const view = await render(<AdminRedFlags />);

    expect(textOf(view)).toContain("Couldn't load the flags");
    expect(textOf(view)).toContain("Couldn't load the rules");
    const retries = descendants(view).filter((element) => element.tagName === 'BUTTON' && textOf(element) === 'Try again');
    await click(retries[0]);
    await click(retries[1]);
    expect(textOf(view)).toContain('No open flags.');
    expect(textOf(view)).toContain('No rules yet, so no complaint raises a flag.');
  });

  it('keeps the page and its dialogs at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminRedFlags />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
    await click(getByName(view, 'button', 'New rule'));
    expect(lowContrastText(openDialog(view))).toEqual([]);
  });
});
