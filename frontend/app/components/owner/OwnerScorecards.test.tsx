import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OwnerScorecardPage from '@/app/(owner)/owner/scorecard/page';
import { ApiError } from '@/app/lib/api';
import { SCORECARD_ITEMS, type ScorecardRequest } from '@/app/lib/scorecards';
import { supportRadioGroups } from '@/app/test-utils/radio-groups';

const api = vi.hoisted(() => ({ list: vi.fn(), submit: vi.fn(), decline: vi.fn() }));
vi.mock('@/app/lib/scorecards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/scorecards')>()),
  scorecards: api,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const pending: ScorecardRequest = {
  id: 's1', status: 'pending', tenant_id: 't1', tenant_name: 'Tanya Tenant', owner_id: 'o1', owner_name: 'Olivia Owner',
  property_id: 'p1', property_label: '1 Harbour Street', suburb: 'Wollongong', state: 'NSW',
  requested_at: '2026-10-01T00:00:00Z', decided_at: null, answers: [], average: null, comment: null, reason: null,
  // The tenant's choice, which the owner's view does not hold.
  visible_on_profile: null,
};
const RATED = SCORECARD_ITEMS.map((item, index) => ({ key: item.key, label: item.label, rating: index % 2 ? 4 : 5 }));
const completed: ScorecardRequest = {
  ...pending, id: 's2', status: 'completed', tenant_id: 't2', tenant_name: 'Theo Tenant', decided_at: '2026-10-05T00:00:00Z',
  answers: RATED, average: 4.57, comment: 'Kept the garden tidy.',
};
const cancelled: ScorecardRequest = { ...pending, id: 's3', status: 'cancelled', tenant_name: 'Cara Cancelled', decided_at: '2026-10-02T00:00:00Z' };

const focused = () => document.activeElement as unknown as FakeElement;
const card = (view: FakeElement, name: string) =>
  getByName(view, 'h2', name).parentElement?.parentElement?.parentElement as unknown as FakeElement;
const formIn = (element: FakeElement) => descendants(element).find((node) => node.tagName === 'FORM') as FakeElement;
/** The radio for one rating of one item: its group is the fieldset whose legend names the item. */
function rating(view: FakeElement, label: string, value: number) {
  const group = descendants(view).find((node) => node.tagName === 'FIELDSET' && textOf(node).includes(label)) as FakeElement;
  return descendants(group).find((node) => node.tagName === 'INPUT' && node.value === String(value)) as FakeElement;
}
async function rateAll(view: FakeElement, except: string[] = []) {
  for (const [index, item] of SCORECARD_ITEMS.entries()) {
    if (!except.includes(item.label)) await click(rating(view, item.label, index % 2 ? 4 : 5));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  supportRadioGroups();
  api.list.mockResolvedValue([pending, completed, cancelled]);
});
afterEach(cleanup);

describe('the owner scorecard page', () => {
  it('says it is loading, then shows the requests waiting for an answer', async () => {
    let resolve!: (list: ScorecardRequest[]) => void;
    api.list.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = await render(<OwnerScorecardPage />);

    expect(textOf(view)).toContain('Loading your scorecard requests…');
    await act(async () => resolve([pending, completed, cancelled]));
    await settle();

    expect(textOf(view)).toContain('1 waiting for your answer.');
    expect(textOf(card(view, 'Tanya Tenant'))).toContain('1 Harbour Street, Wollongong NSW');
    expect(textOf(card(view, 'Tanya Tenant'))).toContain('Pending');
    expect(textOf(view)).not.toContain('Theo Tenant');
    expect(textOf(view)).not.toMatch(/readiness|Landlord readiness/i);
  });

  it('offers a retry when the requests cannot be loaded', async () => {
    api.list.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<OwnerScorecardPage />);

    expect(textOf(view)).toContain('Scorecard requests could not be loaded');
    await click(getByName(view, 'button', 'Try again'));

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(textOf(view)).toContain('Tanya Tenant');
  });

  it('says when no tenant has asked yet', async () => {
    api.list.mockResolvedValue([]);
    const view = await render(<OwnerScorecardPage />);

    expect(textOf(view)).toContain('No scorecard requests yet');
  });

  it('lists the answered and cancelled requests apart, a completed one with what was sent', async () => {
    const view = await render(<OwnerScorecardPage />);

    await click(getByName(view, 'button', 'Answered and cancelled (2)'));
    const toggle = getByName(view, 'button', 'View the scorecard you sent');
    await click(toggle);

    expect(textOf(view)).not.toContain('Tanya Tenant');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(textOf(card(view, 'Theo Tenant'))).toContain('Average: 4.6 out of 5');
    expect(textOf(card(view, 'Theo Tenant'))).toContain('Kept the garden tidy.');
    expect(textOf(card(view, 'Cara Cancelled'))).toContain('Cara Cancelled cancelled this request. There is nothing to complete.');
  });

  it('keeps the page, the form and a sent scorecard at AA contrast', async () => {
    const view = await render(<div className="bg-[#f8f9fa]"><OwnerScorecardPage /></div>);
    await click(getByName(view, 'button', 'Complete scorecard for Tanya Tenant'));

    expect(lowContrastText(view)).toEqual([]);
  });
});

describe('completing a scorecard', () => {
  it('sends a rating for each of the seven items and the comment, and says the tenant was told', async () => {
    api.submit.mockResolvedValue({ ...pending, status: 'completed', answers: RATED, average: 4.57, decided_at: '2026-10-06T00:00:00Z', comment: 'Lovely tenant.' });
    const view = await render(<OwnerScorecardPage />);

    await click(getByName(view, 'button', 'Complete scorecard for Tanya Tenant'));
    expect(textOf(formIn(card(view, 'Tanya Tenant')))).toContain('Would you rent to this tenant again?');
    await rateAll(view);
    await typeInto(descendants(formIn(view)).find((node) => node.tagName === 'TEXTAREA') as FakeElement, '  Lovely tenant. ');
    await dispatch(formIn(view), 'submit');

    expect(api.submit).toHaveBeenCalledWith('s1', Object.fromEntries(RATED.map((answer) => [answer.key, answer.rating])), 'Lovely tenant.');
    expect(textOf(focused())).toBe('Scorecard sent: 4.6 out of 5. Tanya Tenant has been told.');
    expect(formIn(view)).toBeUndefined();
    // It stays in view, completed, until the filter changes.
    expect(textOf(card(view, 'Tanya Tenant'))).toContain('Completed');
    expect(textOf(view)).toContain('Answered and cancelled (3)');
  });

  it('sends nothing until every item is rated, and points at the first one missing', async () => {
    const view = await render(<OwnerScorecardPage />);
    await click(getByName(view, 'button', 'Complete scorecard for Tanya Tenant'));
    await rateAll(view, ['Looked after the property', 'Would you rent to this tenant again?']);

    await dispatch(formIn(view), 'submit');

    expect(api.submit).not.toHaveBeenCalled();
    expect(textOf(formIn(view))).toContain('Rate every item from 1 to 5: 2 still need a rating.');
    expect(focused()).toBe(rating(view, 'Looked after the property', 1));
    const missing = descendants(formIn(view)).filter((node) => node.tagName === 'LEGEND' && textOf(node).includes('Needs a rating'));
    expect(missing.map(textOf)).toEqual(['2. Looked after the propertyNeeds a rating', '7. Would you rent to this tenant again?Needs a rating']);

    await click(rating(view, 'Looked after the property', 3));
    expect(textOf(formIn(view))).toContain('Rate every item from 1 to 5: 1 still needs a rating.');
  });

  it("keeps the form and focuses the server's reason when it refuses the scorecard", async () => {
    api.submit.mockRejectedValue(new ApiError(409, 'This request was cancelled.'));
    const view = await render(<OwnerScorecardPage />);
    await click(getByName(view, 'button', 'Complete scorecard for Tanya Tenant'));
    await rateAll(view);

    await dispatch(formIn(view), 'submit');

    expect(textOf(focused())).toBe('This request was cancelled.');
    expect(formIn(view)).toBeDefined();
  });

  it('takes focus when it opens, and gives it back to its button when closed without sending', async () => {
    const view = await render(<OwnerScorecardPage />);
    await click(getByName(view, 'button', 'Complete scorecard for Tanya Tenant'));
    expect(focused()).toBe(formIn(view));
    expect(focused().getAttribute('aria-label')).toBe('Scorecard for Tanya Tenant');

    await click(getByName(formIn(view), 'button', 'Cancel'));

    expect(api.submit).not.toHaveBeenCalled();
    expect(focused()).toBe(getByName(view, 'button', 'Complete scorecard for Tanya Tenant'));
  });
});

describe('declining a request', () => {
  it('sends the reason, if the owner gives one, and says the tenant was told', async () => {
    api.decline.mockResolvedValue({ ...pending, status: 'declined', reason: 'I only managed the building.', decided_at: '2026-10-06T00:00:00Z' });
    const view = await render(<OwnerScorecardPage />);

    await click(getByName(view, 'button', 'Decline the request from Tanya Tenant'));
    await typeInto(descendants(formIn(view)).find((node) => node.tagName === 'TEXTAREA') as FakeElement, ' I only managed the building. ');
    await dispatch(formIn(view), 'submit');

    expect(api.decline).toHaveBeenCalledWith('s1', 'I only managed the building.');
    expect(textOf(focused())).toBe('Request declined. Tanya Tenant has been told.');
    expect(textOf(card(view, 'Tanya Tenant'))).toContain('You declined this request: “I only managed the building.”');
  });

  it('declines without a reason too', async () => {
    api.decline.mockResolvedValue({ ...pending, status: 'declined', decided_at: '2026-10-06T00:00:00Z' });
    const view = await render(<OwnerScorecardPage />);

    await click(getByName(view, 'button', 'Decline the request from Tanya Tenant'));
    await dispatch(formIn(view), 'submit');

    expect(api.decline).toHaveBeenCalledWith('s1', null);
    expect(textOf(card(view, 'Tanya Tenant'))).toContain('You declined this request.');
  });

  it('keeps the request when the owner changes their mind', async () => {
    const view = await render(<OwnerScorecardPage />);
    await click(getByName(view, 'button', 'Decline the request from Tanya Tenant'));

    await click(getByName(view, 'button', 'Keep it'));

    expect(api.decline).not.toHaveBeenCalled();
    expect(focused()).toBe(getByName(view, 'button', 'Decline the request from Tanya Tenant'));
  });
});
