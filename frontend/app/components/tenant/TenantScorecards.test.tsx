import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { SCORECARD_ITEMS, type ScorecardRecipient, type ScorecardRequest } from '@/app/lib/scorecards';
import { supportRadioGroups } from '@/app/test-utils/radio-groups';
import TenantScorecards from './TenantScorecards';

const api = vi.hoisted(() => ({ list: vi.fn(), recipients: vi.fn(), request: vi.fn(), cancel: vi.fn(), setVisible: vi.fn() }));
vi.mock('@/app/lib/scorecards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/scorecards')>()),
  scorecards: api,
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const pending: ScorecardRequest = {
  id: 's1', status: 'pending', tenant_id: 't1', tenant_name: 'Tanya Tenant', owner_id: 'o1', owner_name: 'Olivia Owner',
  property_id: 'p1', property_label: '1 Harbour Street', suburb: 'Wollongong', state: 'NSW',
  requested_at: '2026-10-01T00:00:00Z', decided_at: null, answers: [], average: null, comment: null, reason: null,
  visible_on_profile: false,
};
const completed: ScorecardRequest = {
  ...pending, id: 's2', status: 'completed', owner_id: 'o2', owner_name: 'Avery Agent', decided_at: '2026-10-05T00:00:00Z',
  answers: SCORECARD_ITEMS.map((item, index) => ({ key: item.key, label: item.label, rating: index === 0 ? 5 : 4 })),
  average: 4.14, comment: 'Always on time and easy to deal with.',
};
const declined: ScorecardRequest = {
  ...pending, id: 's3', status: 'declined', owner_id: 'o3', owner_name: 'Sam Stranger', decided_at: '2026-10-03T00:00:00Z',
  reason: 'I only managed the building.',
};
const cancelled: ScorecardRequest = {
  ...pending, id: 's4', status: 'cancelled', property_label: '7 Beach Road', suburb: 'Thirroul', decided_at: '2026-09-20T00:00:00Z',
};
const recipient = (over: Partial<ScorecardRecipient>): ScorecardRecipient => ({
  owner_id: 'o1', owner_name: 'Olivia Owner', owner_role_label: 'Landlord', property_id: 'p1', property_label: '1 Harbour Street',
  suburb: 'Wollongong', state: 'NSW', source: 'application', pending_request_id: null, ...over,
});
const harbour = recipient({ pending_request_id: 's1' });
const beach = recipient({ property_id: 'p2', property_label: '7 Beach Road', suburb: 'Thirroul', source: 'agreement' });

const focused = () => document.activeElement as unknown as FakeElement;
const formIn = (view: FakeElement) => descendants(view).find((node) => node.tagName === 'FORM') as FakeElement;
const item = (view: FakeElement, text: string) =>
  descendants(view).find((node) => node.tagName === 'LI' && textOf(node).includes(text)) as FakeElement;
/** The recipient radio whose description names the home. */
function choiceFor(view: FakeElement, home: string) {
  return descendants(view).find((node) => node.tagName === 'INPUT' && node.type === 'radio'
    && textOf(document.getElementById(node.getAttribute('aria-describedby') ?? '') as unknown as FakeElement).includes(home)) as FakeElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  supportRadioGroups();
  api.list.mockResolvedValue([pending, completed, declined, cancelled]);
  api.recipients.mockResolvedValue([harbour, beach]);
});
afterEach(cleanup);

describe('TenantScorecards states', () => {
  it('says it is loading, then lists every request with its state', async () => {
    let resolve!: (list: ScorecardRequest[]) => void;
    api.list.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = await render(<TenantScorecards />);

    expect(textOf(view)).toContain('Loading your scorecards…');
    await act(async () => resolve([pending, completed, declined, cancelled]));
    await settle();

    expect(textOf(item(view, 'Olivia Owner1 Harbour Street'))).toContain('Pending');
    expect(textOf(item(view, 'Olivia Owner1 Harbour Street'))).toContain('Waiting for Olivia Owner to complete it.');
    expect(textOf(item(view, 'Avery Agent'))).toContain('Completed');
    expect(textOf(item(view, 'Avery Agent'))).toContain('Average: 4.1 out of 5');
    expect(textOf(item(view, 'Sam Stranger'))).toContain('Sam Stranger declined: “I only managed the building.” You can ask again.');
    expect(textOf(item(view, '7 Beach Road'))).toContain('You cancelled this request.');
    expect(textOf(item(view, '7 Beach Road'))).toContain('Cancelled');
  });

  it('offers a retry when the scorecards cannot be loaded', async () => {
    api.list.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<TenantScorecards />);

    expect(textOf(view)).toContain('The service is temporarily unavailable.');
    await click(getByName(view, 'button', 'Try again'));

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(textOf(view)).toContain('Avery Agent');
  });

  it('says when there is no request yet, and how one becomes possible', async () => {
    api.list.mockResolvedValue([]);
    const view = await render(<TenantScorecards />);

    expect(textOf(view)).toContain('No scorecard requests yet.');
    expect(getByName(view, 'button', 'Request scorecard')).toBeTruthy();
  });

  it('keeps every state, the request form and an open scorecard at AA contrast', async () => {
    const view = await render(<TenantScorecards />);
    await click(getByName(view, 'button', 'View scorecard from Avery Agent'));
    await click(getByName(view, 'button', 'Request scorecard'));

    expect(lowContrastText(view)).toEqual([]);
  });
});

describe('requesting a scorecard', () => {
  it('lists whom the tenant may ask, sends the request and says who will answer', async () => {
    const created = { ...pending, id: 's9', property_id: 'p2', property_label: '7 Beach Road', suburb: 'Thirroul' };
    api.request.mockResolvedValue(created);
    const view = await render(<TenantScorecards />);

    const opener = getByName(view, 'button', 'Request scorecard');
    await click(opener);
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    expect(formIn(view).id).toBe(opener.getAttribute('aria-controls'));
    expect(textOf(formIn(view))).toContain('Owner / Agent Tenant Scorecard');
    expect(textOf(formIn(view))).toContain('Would you rent to this tenant again?');
    // Olivia was asked about Harbour Street already: that one waits for her answer.
    expect(choiceFor(view, '1 Harbour Street').hasAttribute('disabled')).toBe(true);
    expect(textOf(formIn(view))).toContain('Already asked: waiting for their answer');

    await click(choiceFor(view, '7 Beach Road'));
    await dispatch(formIn(view), 'submit');

    expect(api.request).toHaveBeenCalledWith('o1', 'p2');
    expect(formIn(view)).toBeUndefined();
    expect(textOf(focused())).toBe('Request sent to Olivia Owner. You will be told when they answer.');
    const [first] = descendants(view).filter((node) => node.tagName === 'LI');
    expect(textOf(first)).toContain('7 Beach Road');
  });

  it('offers no one who completed the scorecard for that home, or who declined or was cancelled too recently', async () => {
    api.recipients.mockResolvedValue([
      recipient({ completed_request_id: 's2' }),
      recipient({ property_id: 'p2', property_label: '7 Beach Road', suburb: 'Thirroul', ask_again_from: '2026-11-22T01:00:00Z' }),
      recipient({ owner_id: 'o3', owner_name: 'Avery Agent', owner_role_label: 'Agent' }),
    ]);
    const view = await render(<TenantScorecards />);
    await click(getByName(view, 'button', 'Request scorecard'));

    const [done, waiting, open] = descendants(formIn(view)).filter((node) => node.tagName === 'INPUT' && node.type === 'radio');
    expect([done, waiting, open].map((radio) => radio.hasAttribute('disabled'))).toEqual([true, true, false]);
    expect(textOf(formIn(view))).toContain('Already completed your scorecard for this home');
    expect(textOf(formIn(view))).toContain('You can ask them again from 22 Nov 2026');
    expect(lowContrastText(formIn(view))).toEqual([]);
  });

  it('asks the tenant to choose someone before sending', async () => {
    const view = await render(<TenantScorecards />);
    await click(getByName(view, 'button', 'Request scorecard'));

    await dispatch(formIn(view), 'submit');

    expect(api.request).not.toHaveBeenCalled();
    expect(textOf(formIn(view))).toContain('Choose the owner or agent who should complete your scorecard.');
    expect(focused()).toBe(choiceFor(view, '7 Beach Road'));
  });

  it("shows the server's reason when it refuses the request, and keeps the form", async () => {
    api.request.mockRejectedValue(new ApiError(409, 'You already asked them for a scorecard for this home. It is waiting for their answer.'));
    const view = await render(<TenantScorecards />);
    await click(getByName(view, 'button', 'Request scorecard'));
    await click(choiceFor(view, '7 Beach Road'));

    await dispatch(formIn(view), 'submit');

    expect(textOf(focused())).toBe('You already asked them for a scorecard for this home. It is waiting for their answer.');
    expect(formIn(view)).toBeDefined();
  });

  it('explains when nobody can be asked yet', async () => {
    api.recipients.mockResolvedValue([]);
    const view = await render(<TenantScorecards />);

    await click(getByName(view, 'button', 'Request scorecard'));

    expect(textOf(formIn(view))).toContain('There is nobody to ask yet.');
    expect(descendants(formIn(view)).some((node) => node.tagName === 'BUTTON' && textOf(node) === 'Send request')).toBe(false);
  });

  it('offers a retry when whom to ask cannot be loaded', async () => {
    api.recipients.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<TenantScorecards />);
    await click(getByName(view, 'button', 'Request scorecard'));

    expect(textOf(formIn(view))).toContain('The service is temporarily unavailable.');
    await click(getByName(formIn(view), 'button', 'Try again'));

    expect(api.recipients).toHaveBeenCalledTimes(2);
    expect(choiceFor(view, '7 Beach Road')).toBeDefined();
  });

  it('closes the form and gives focus back to its button', async () => {
    const view = await render(<TenantScorecards />);
    await click(getByName(view, 'button', 'Request scorecard'));

    await click(getByName(formIn(view), 'button', 'Cancel'));

    expect(formIn(view)).toBeUndefined();
    expect(focused()).toBe(getByName(view, 'button', 'Request scorecard'));
  });
});

describe('a request the tenant sent', () => {
  it('is cancelled only once the tenant confirms, and the owner is told', async () => {
    api.cancel.mockResolvedValue({ ...pending, status: 'cancelled', decided_at: '2026-10-06T00:00:00Z' });
    const view = await render(<TenantScorecards />);

    await click(getByName(view, 'button', 'Cancel request to Olivia Owner'));
    expect(api.cancel).not.toHaveBeenCalled();
    expect(textOf(focused())).toBe('Keep it');
    await click(getByName(view, 'button', 'Yes, cancel it'));

    expect(api.cancel).toHaveBeenCalledWith('s1');
    expect(textOf(focused())).toBe('Request cancelled. Olivia Owner has been told.');
    expect(textOf(item(view, 'Olivia Owner1 Harbour Street'))).toContain('You cancelled this request.');
  });

  it('stays pending when the tenant keeps it', async () => {
    const view = await render(<TenantScorecards />);

    await click(getByName(view, 'button', 'Cancel request to Olivia Owner'));
    await click(getByName(view, 'button', 'Keep it'));

    expect(api.cancel).not.toHaveBeenCalled();
    expect(focused()).toBe(getByName(view, 'button', 'Cancel request to Olivia Owner'));
  });

  it('opens a completed scorecard to every rating and the comment', async () => {
    const view = await render(<TenantScorecards />);
    const toggle = getByName(view, 'button', 'View scorecard from Avery Agent');

    await click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const result = document.getElementById(toggle.getAttribute('aria-controls') as string) as unknown as FakeElement;
    expect(textOf(result)).toContain('Paid rent on time★★★★★5 out of 5');
    expect(textOf(result)).toContain('Would you rent to this tenant again?★★★★☆4 out of 5');
    expect(textOf(result)).toContain('Always on time and easy to deal with.');
    // The average and the date are the card's, said once.
    expect(textOf(item(view, 'Avery Agent')).match(/Average: 4\.1 out of 5/g)).toHaveLength(1);
    expect(textOf(item(view, 'Avery Agent')).match(/Completed 5 Oct 2026/g)).toHaveLength(1);
  });

  it('shows a completed scorecard on the public profile when the tenant ticks it', async () => {
    api.setVisible.mockResolvedValue({ ...completed, visible_on_profile: true });
    const view = await render(<TenantScorecards />);
    const box = descendants(item(view, 'Avery Agent')).find((node) => node.type === 'checkbox') as FakeElement;

    box.checked = true;
    await click(box);

    expect(api.setVisible).toHaveBeenCalledWith('s2', true);
    expect(textOf(item(view, 'Avery Agent'))).toContain('This scorecard now counts on your public profile.');
    expect(box.checked).toBe(true);
  });

  it('says the profile shows no scorecard while it is hidden or the score is not shared, with the way to the settings', async () => {
    const view = await render(<TenantScorecards />);
    const switchHint = textOf(item(view, 'Avery Agent'));

    expect(switchHint).toContain('never who wrote them or what they said.');
    expect(switchHint).toContain('It shows none while your profile is hidden or sharing your score is off in your settings.');
    expect(getByName(item(view, 'Avery Agent'), 'a', 'your settings').getAttribute('href')).toBe('/tenant/settings');
  });

  it('says why the profile switch did not save', async () => {
    api.setVisible.mockRejectedValue(new ApiError(409, 'Only a completed scorecard can show on your public profile.'));
    const view = await render(<TenantScorecards />);
    const box = descendants(item(view, 'Avery Agent')).find((node) => node.type === 'checkbox') as FakeElement;

    box.checked = true;
    await click(box);

    expect(textOf(item(view, 'Avery Agent'))).toContain('Only a completed scorecard can show on your public profile.');
  });
});
