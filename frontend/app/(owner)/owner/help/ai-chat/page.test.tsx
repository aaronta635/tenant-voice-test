import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import AiChatSupportPage from './page';

const mockApi = vi.hoisted(() => ({ ownerAssistant: { workspace: vi.fn(), ask: vi.fn(), confirm: vi.fn() } }));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const GATE = "Your account isn't active, so you can't use AI features. Contact support to restore it.";
const PENDING = 'Your account needs to be verified before you can use AI features. Upload the documents it asks for, or wait for the review to finish.';
const RULES = 'AI unavailable: answered by fixed rules from your records, not by an AI model.\n\nYou have 1 listing: 1 published.';
const REMINDER = {
  operation: 'create_record',
  payload: { listingId: 'listing-1', kind: 'reminder', title: 'Smoke alarm check', data: { dueAt: '2030-11-02T09:30:00+11:00', message: 'Test the alarms.' } },
  preview: {
    title: 'Create a reminder for Harbour flat',
    changes: [
      { label: 'Title', value: 'Smoke alarm check' },
      { label: 'For', value: 'you' },
      { label: 'Due', value: 'Sat 2 Nov 2030, 9:30 am (Sydney time)' },
      { label: 'Message', value: 'Test the alarms.' },
    ],
    notes: [],
    demo: 'in-app reminder only; no email or SMS is sent',
  },
};
const SAVED = {
  request_id: 'chat-1', action_request_id: 'action-1', operation: 'create_record', message: 'Reminder saved.',
  record: { id: 'record-1', kind: 'reminder', status: 'pending' },
  saved: [{ label: 'Kind', value: 'Reminder' }, { label: 'Status', value: 'Pending' }, { label: 'Record id', value: 'record-1' }],
  receipt: 'action-1', reply: 'Reminder saved. Receipt: action-1',
};

function answer(over: Record<string, unknown> = {}) {
  return {
    request_id: 'chat-1', question: 'Remind me to check the smoke alarms', reply: 'Here is a reminder to review.',
    source: 'ai', ai_status: 'applied', ai_labelled: true, cached: false, action: null, providers: [], verification: null,
    ...over,
  };
}

function question(view: FakeElement) {
  return descendants(view).find((element) => element.tagName === 'INPUT') as FakeElement;
}

async function ask(view: FakeElement, text: string) {
  await typeInto(question(view), text);
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
  await settle();
}

const buttons = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'BUTTON').map(textOf);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockApi.ownerAssistant.workspace.mockResolvedValue({ history: [], ai_status: 'ready', verification: null });
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the owner assistant', () => {
  it('labels the model\'s answer as AI and the rules\' answer as AI unavailable', async () => {
    mockApi.ownerAssistant.ask
      .mockResolvedValueOnce(answer({ reply: 'One repair is open.' }))
      .mockResolvedValueOnce(answer({ request_id: 'chat-2', reply: RULES, source: 'rules', ai_status: 'unavailable' }));
    const view = await render(<AiChatSupportPage />);

    await ask(view, 'Any repairs?');
    await ask(view, 'How many listings?');

    const [first, second] = mockApi.ownerAssistant.ask.mock.calls;
    expect(first[0]).toBe('Any repairs?');
    expect(first[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second[1]).not.toBe(first[1]);
    expect(textOf(view)).toContain('Owner assistantAI answerOne repair is open.');
    expect(textOf(view)).toContain('Owner assistantAI unavailableAI unavailable: answered by fixed rules');
    expect(textOf(view)).toContain('it can be wrong');
    expect(question(view).value).toBe('');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('says so when no model is connected', async () => {
    mockApi.ownerAssistant.workspace.mockResolvedValue({ history: [], ai_status: 'not_configured', verification: null });
    const view = await render(<AiChatSupportPage />);

    const [note] = descendants(view).filter((element) => element.getAttribute('role') === 'note');
    expect(textOf(note)).toBe('AI unavailableNo AI model is connected, so answers are worked out by fixed rules from your records.');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('links an unverified owner to their documents while the rules answer', async () => {
    mockApi.ownerAssistant.workspace.mockResolvedValue({
      history: [], ai_status: 'verification_required',
      verification: { code: 'verification_required', action: 'paid_ai', status: 'pending', message: PENDING, documents_href: '/owner/profile/verification' },
    });
    const view = await render(<AiChatSupportPage />);

    expect(textOf(view)).toContain('Until your account is verified, answers are worked out by fixed rules from your records.');
    expect(getByName(view, 'a', 'Go to your documents').getAttribute('href')).toBe('/owner/profile/verification');
  });

  it('previews every change a suggested action makes, and Cancel sends nothing', async () => {
    mockApi.ownerAssistant.ask.mockResolvedValue(answer({ action: REMINDER }));
    const view = await render(<AiChatSupportPage />);

    await ask(view, 'Remind me to check the smoke alarms');
    const preview = descendants(view).find((element) => element.tagName === 'SECTION') as FakeElement;
    expect(textOf(preview)).toContain('Suggested action, not done yet');
    expect(textOf(preview)).toContain('Create a reminder for Harbour flat');
    expect(textOf(preview)).toContain('DueSat 2 Nov 2030, 9:30 am (Sydney time)');
    expect(textOf(preview)).toContain('Demo: in-app reminder only; no email or SMS is sent');
    expect(lowContrastText(view)).toEqual([]);

    await click(getByName(view, 'button', 'Cancel'));
    await settle();

    expect(mockApi.ownerAssistant.confirm).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Cancelled. Nothing was changed.');
    expect(buttons(view)).toEqual(['Ask']);
    // The Cancel button went with the preview: focus is on what replaced it.
    expect(textOf(view.ownerDocument!.activeElement!)).toBe('Cancelled. Nothing was changed.');
  });

  it('confirms the suggested action and shows the record it saved and its receipt', async () => {
    mockApi.ownerAssistant.ask.mockResolvedValue(answer({ action: REMINDER }));
    mockApi.ownerAssistant.confirm.mockResolvedValue(SAVED);
    const view = await render(<AiChatSupportPage />);

    await ask(view, 'Remind me to check the smoke alarms');
    await click(getByName(view, 'button', 'Confirm'));
    await settle();

    expect(mockApi.ownerAssistant.confirm).toHaveBeenCalledWith('chat-1');
    const saved = descendants(view).find((element) => element.getAttribute('aria-label') === 'Saved') as FakeElement;
    expect(view.ownerDocument?.activeElement).toBe(saved);
    expect(textOf(saved)).toBe('Saved: Reminder saved.KindReminderStatusPendingRecord idrecord-1Receipt: action-1');
    expect(textOf(view)).toContain('Owner assistantAI answerHere is a reminder to review.');
    expect(buttons(view)).toEqual(['Ask']);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('says nothing was changed when a confirm fails, and offers it again', async () => {
    mockApi.ownerAssistant.ask.mockResolvedValue(answer({ action: REMINDER }));
    mockApi.ownerAssistant.confirm.mockRejectedValue(new ApiError(409, 'This suggestion is out of date: the repair is resolved.'));
    const view = await render(<AiChatSupportPage />);

    await ask(view, 'Remind me to check the smoke alarms');
    await click(getByName(view, 'button', 'Confirm'));

    const [alert] = descendants(view).filter((element) => element.getAttribute('role') === 'alert');
    expect(textOf(alert)).toBe('Nothing was changed. This suggestion is out of date: the repair is resolved.');
    expect(buttons(view)).toEqual(['Confirm', 'Cancel', 'Ask']);
  });

  it('shows the verification notice when the gate refuses a confirm', async () => {
    mockApi.ownerAssistant.ask.mockResolvedValue(answer({ action: REMINDER }));
    mockApi.ownerAssistant.confirm.mockRejectedValue(new ApiError(403, PENDING, {
      code: 'verification_required', action: 'paid_ai', status: 'pending', message: PENDING, documents_href: '/owner/profile/verification',
    }));
    const view = await render(<AiChatSupportPage />);

    await ask(view, 'Remind me to check the smoke alarms');
    await click(getByName(view, 'button', 'Confirm'));

    expect(getByName(view, 'a', 'Go to your documents').getAttribute('href')).toBe('/owner/profile/verification');
    expect(textOf(view)).not.toContain('Saved:');
  });

  it('lists the suggested providers with the facts behind them', async () => {
    mockApi.ownerAssistant.ask.mockResolvedValue(answer({
      reply: RULES, source: 'rules', ai_status: 'not_configured',
      providers: [{ id: 'p1', name: 'Harbour Plumbing', categories: ['PLUMBING'], location: 'Newtown', pricing: null, rating: 4.5, hourly_rate: 95,
        reasons: ['Rated 4.5 from published reviews', 'Works in Newtown', '$95 an hour'] }],
    }));
    const view = await render(<AiChatSupportPage />);

    await ask(view, 'Find a plumber');

    const list = descendants(view).find((element) => element.getAttribute('aria-label') === 'Suggested providers') as FakeElement;
    expect(textOf(list)).toContain('Harbour PlumbingRated 4.5 from published reviews · Works in Newtown · $95 an hour');
  });

  it('labels the history: the rules\' replies and the saved data this page used to send', async () => {
    mockApi.ownerAssistant.workspace.mockResolvedValue({ ai_status: 'ready', history: [
      { question: 'How many listings?', reply: RULES },
      { question: 'Old question', reply: 'AI-labelled, read-only until you confirm a separate action.\n\nShared owner-assistant context: {}' },
      { question: 'From the phone', reply: 'Two tenants paid late this year.' },
    ] });
    const view = await render(<AiChatSupportPage />);

    const labels = descendants(view).filter((element) => element.hasAttribute('data-demo-label'));
    expect(labels.map(textOf)).toEqual(['Demo: saved owner-assistant data, not an AI answer']);
    expect(textOf(view)).toContain('Owner assistantAI unavailableAI unavailable:');
    expect(textOf(view)).toContain('Owner assistantTwo tenants paid late this year.');
  });

  it('keeps the question and says why when asking fails', async () => {
    mockApi.ownerAssistant.ask
      .mockRejectedValueOnce(new ApiError(403, GATE, { code: 'verification_required', action: 'paid_ai', status: 'inactive', message: GATE, documents_href: null }))
      .mockRejectedValueOnce(new ApiError(429, 'AI request limit reached. Please wait before asking again.'));
    const view = await render(<AiChatSupportPage />);

    await ask(view, 'Any repairs?');
    const [alert] = descendants(view).filter((element) => element.getAttribute('role') === 'alert');
    expect(textOf(alert)).toBe(`Account not active${GATE}`);
    expect(question(view).value).toBe('Any repairs?');

    await ask(view, 'Any repairs?');
    expect(textOf(view)).not.toContain('Account not active');
    expect(textOf(view)).toContain('AI request limit reached. Please wait before asking again.');
    expect(question(view).value).toBe('Any repairs?');
  });

  it('still lets the owner ask when the history cannot be loaded', async () => {
    mockApi.ownerAssistant.workspace.mockRejectedValue(new ApiError(503, 'The assistant is unavailable right now. Please try again.'));
    mockApi.ownerAssistant.ask.mockResolvedValue(answer({ reply: 'One repair is open.' }));
    const view = await render(<AiChatSupportPage />);

    expect(textOf(view)).toContain('Your earlier questions could not be loaded. You can still ask.');
    await ask(view, 'Any repairs?');
    expect(textOf(view)).toContain('One repair is open.');
  });
});
