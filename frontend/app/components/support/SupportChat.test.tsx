import { cleanup, descendants, dispatch, FakeElement, fire, getByName, render, settle, textOf, typeInto } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { SupportAnswer } from '@/app/lib/support-chat';
import SupportChat from './SupportChat';

const mockAsk = vi.hoisted(() => vi.fn());
vi.mock('@/app/lib/support-chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/support-chat')>()),
  askSupport: mockAsk,
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const SOURCE = { title: 'How tenants get verified', href: '/tenant/id-verification', excerpt: 'A tenant account is verified once an admin approves one photo ID.' };
const USAGE = { used: 1, limit: 30, remaining: 29, resets_at: '2030-01-16T00:00:00Z' };
const LIMIT = { code: 'support_chat_limit', message: 'Used up.', limit: 30, resets_at: '2030-01-16T00:00:00+00:00' };

const aiAnswer = (over: Partial<SupportAnswer> = {}): SupportAnswer => ({
  answer: 'Upload a photo ID on [ID Verification](/tenant/id-verification).',
  sources: [SOURCE],
  source: 'ai',
  ai_status: 'applied',
  verification: null,
  usage: USAGE,
  ...over,
});
const helpAnswer = (over: Partial<SupportAnswer> = {}): SupportAnswer => aiAnswer({
  answer: 'AI answers are unavailable right now, so here are the help pages that best match your question.',
  source: 'help',
  ai_status: 'not_configured',
  ...over,
});

const box = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'TEXTAREA') as FakeElement;
const form = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'FORM') as FakeElement;
const live = (view: FakeElement) => descendants(view).find((element) => element.getAttribute('aria-live') === 'polite') as FakeElement;
const conversation = (view: FakeElement) => getByName(view, 'ol', 'Support conversation');
const links = (root: FakeElement) => descendants(root).filter((element) => element.tagName === 'A');

async function ask(view: FakeElement, text: string) {
  await typeInto(box(view), text);
  await dispatch(form(view), 'submit');
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the support chat', () => {
  it('opens with what it does, example questions and an empty box with its counter', async () => {
    const view = await render(<SupportChat audience="tenant" />);

    expect(getByName(view, 'h2', 'Support chat')).toBeDefined();
    expect(textOf(view)).toContain("the chat can't see your account or change anything");
    expect(getByName(view, 'button', 'How do I get verified?')).toBeDefined();
    expect(box(view).getAttribute('maxLength')).toBe('1000');
    expect(textOf(view)).toContain('0/1000');
    expect(getByName(view, 'button', 'Send').hasAttribute('disabled')).toBe(true);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('counts the characters and says how many are left near the limit', async () => {
    const view = await render(<SupportChat />);

    await typeInto(box(view), 'x'.repeat(950));

    expect(textOf(view)).toContain('950/1000');
    const hint = descendants(view).find((element) => element.id === box(view).getAttribute('aria-describedby')) as FakeElement;
    expect(textOf(hint)).toContain('50 characters left.');
  });

  it('shows the question and an AI answer with its internal link and sources, and announces it', async () => {
    mockAsk.mockResolvedValue(aiAnswer());
    const view = await render(<SupportChat audience="tenant" />);

    await ask(view, '  How do I get verified?  ');

    expect(mockAsk).toHaveBeenCalledWith('How do I get verified?', []);
    const log = conversation(view);
    expect(textOf(log)).toContain('You asked: How do I get verified?');
    expect(textOf(log)).toContain('AI answer from the help pages');
    expect(links(log).map((link) => [textOf(link), link.getAttribute('href')])).toEqual([
      ['ID Verification', '/tenant/id-verification'],
      ['How tenants get verified', '/tenant/id-verification'],
    ]);
    expect(textOf(live(view))).toBe('Support answered: Upload a photo ID on ID Verification. From: How tenants get verified.');
    expect(box(view).value).toBe('');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('renders a link to anywhere but this site as plain words', async () => {
    mockAsk.mockResolvedValue(aiAnswer({
      answer: 'Go to [the bank](https://evil.example/login) or [here](//evil.example).',
      sources: [{ ...SOURCE, href: 'javascript:alert(1)' }],
    }));
    const view = await render(<SupportChat />);

    await ask(view, 'Where do I pay?');

    expect(links(conversation(view))).toEqual([]);
    expect(textOf(conversation(view))).toContain('Go to the bank or here.');
    expect(textOf(conversation(view))).toContain('How tenants get verified');
  });

  it('sends the conversation so far with the next question', async () => {
    mockAsk.mockResolvedValueOnce(aiAnswer()).mockResolvedValueOnce(helpAnswer());
    const view = await render(<SupportChat />);

    await ask(view, 'How do I get verified?');
    await ask(view, 'And then?');

    expect(mockAsk).toHaveBeenLastCalledWith('And then?', [
      { role: 'user', content: 'How do I get verified?' },
      { role: 'assistant', content: 'Upload a photo ID on ID Verification.' },
    ]);
  });

  it('sends with Enter, and adds a line with Shift+Enter', async () => {
    mockAsk.mockResolvedValue(aiAnswer());
    const view = await render(<SupportChat />);
    await typeInto(box(view), 'How do I get verified?');

    await act(async () => { fire(box(view), 'keydown', { key: 'Enter', shiftKey: true }); });
    expect(mockAsk).not.toHaveBeenCalled();
    await act(async () => { fire(box(view), 'keydown', { key: 'Enter' }); });
    await settle();

    expect(mockAsk).toHaveBeenCalledWith('How do I get verified?', []);
  });

  it('asks an example question when it is chosen', async () => {
    mockAsk.mockResolvedValue(aiAnswer());
    const view = await render(<SupportChat audience="landlord" />);

    await dispatch(getByName(view, 'button', 'How do I list a property?'), 'click');

    expect(mockAsk).toHaveBeenCalledWith('How do I list a property?', []);
  });

  it('shows the question and a waiting line while support answers, and sends nothing else meanwhile', async () => {
    let answer: (value: SupportAnswer) => void = () => {};
    mockAsk.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const view = await render(<SupportChat />);

    await ask(view, 'How do I get verified?');

    expect(conversation(view).getAttribute('aria-busy')).toBe('true');
    expect(textOf(conversation(view))).toContain('Looking through the help pages…');
    expect(textOf(live(view))).toBe('Looking through the help pages…');
    expect(getByName(view, 'button', 'Asking…').hasAttribute('disabled')).toBe(true);
    await ask(view, 'Another question');
    expect(mockAsk).toHaveBeenCalledTimes(1);

    await act(async () => { answer(aiAnswer()); });
    await settle();
    expect(conversation(view).getAttribute('aria-busy')).toBe('false');
    expect(textOf(conversation(view))).not.toContain('Looking through the help pages…');
  });

  it('keeps the waiting line in view, then shows a new answer from its question', async () => {
    // The test DOM has no layout: every conversation item says it starts 120px down.
    Object.defineProperty(FakeElement.prototype, 'offsetTop', { configurable: true, get(this: FakeElement) { return this.tagName === 'LI' ? 120 : 0; } });
    try {
      let answer: (value: SupportAnswer) => void = () => {};
      mockAsk.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
      const view = await render(<SupportChat />);
      const scroller = conversation(view).parentElement as FakeElement;
      scroller.scrollHeight = 900;

      await ask(view, 'How do I get verified?');
      expect(scroller.scrollTop).toBe(900);

      await act(async () => { answer(aiAnswer()); });
      await settle();
      expect(scroller.scrollTop).toBe(120);
    } finally {
      delete (FakeElement.prototype as { offsetTop?: number }).offsetTop;
    }
  });

  it('shows the help pages under the unavailable note when AI answers are off', async () => {
    mockAsk.mockResolvedValue(helpAnswer({ sources: [SOURCE, { title: 'Why you cannot apply yet', href: '/tenant/id-verification', excerpt: 'Applying needs a verified account.' }] }));
    const view = await render(<SupportChat />);

    await ask(view, 'How do I get verified?');

    const log = conversation(view);
    expect(textOf(log)).toContain('From the help pages');
    expect(textOf(log)).toContain('AI answers are unavailable right now, so here are the help pages that best match your question.');
    expect(textOf(log)).toContain('Matching help pages');
    expect(textOf(log)).toContain(SOURCE.excerpt);
    expect(textOf(log)).not.toContain('AI answer from the help pages');
    expect(textOf(live(view))).toBe(
      'AI answers are unavailable right now, so here are the help pages that best match your question. How tenants get verified; Why you cannot apply yet.',
    );
    expect(lowContrastText(view)).toEqual([]);
  });

  it('says why an unverified member gets no AI answer and links their documents', async () => {
    const message = 'Your account needs to be verified before you can use AI features. Upload the documents it asks for, or wait for the review to finish.';
    mockAsk.mockResolvedValue(helpAnswer({
      answer: 'AI answers are unavailable until your account is verified, so here are the help pages that best match your question.',
      ai_status: 'verification_required',
      verification: { code: 'verification_required', action: 'paid_ai', status: 'pending', message, documents_href: '/tenant/id-verification' },
    }));
    const view = await render(<SupportChat />);

    await ask(view, 'How do I get verified?');

    expect(textOf(conversation(view))).toContain(message);
    expect(getByName(view, 'a', 'Go to your documents').getAttribute('href')).toBe('/tenant/id-verification');
  });

  it('tells a member with no documents page nothing about uploading documents', async () => {
    // A staff account is pending until the DB owner approves it, and has no documents to upload.
    const message = 'Your account needs to be verified before you can use AI features. Upload the documents it asks for, or wait for the review to finish.';
    const note = 'AI answers are unavailable until your account is verified, so here are the help pages that best match your question.';
    mockAsk.mockResolvedValue(helpAnswer({
      answer: note,
      ai_status: 'verification_required',
      verification: { code: 'verification_required', action: 'paid_ai', status: 'pending', message, documents_href: null },
    }));
    const view = await render(<SupportChat />);

    await ask(view, 'How do I approve documents?');

    expect(textOf(conversation(view))).toContain(note);
    expect(textOf(conversation(view))).not.toContain('Upload the documents');
    expect(descendants(view).some((element) => element.tagName === 'A' && textOf(element) === 'Go to your documents')).toBe(false);
  });

  it("shows the gate's reason when the account itself is suspended", async () => {
    const message = "Your account is suspended, so you can't use AI features. Contact support to restore it.";
    mockAsk.mockResolvedValue(helpAnswer({
      answer: 'AI answers are unavailable for your account right now, so here are the help pages that best match your question.',
      ai_status: 'verification_required',
      verification: { code: 'verification_required', action: 'paid_ai', status: 'suspended', message, documents_href: null },
    }));
    const view = await render(<SupportChat />);

    await ask(view, 'How do I go live?');

    expect(textOf(conversation(view))).toContain(message);
  });

  it('wraps a long source title, such as an FAQ question holding a link, rather than widen the log', async () => {
    const title = 'Where-is-https://tenantvoice.example/a-very-long-unbroken-page-address-that-runs-on';
    mockAsk.mockResolvedValue(helpAnswer({ sources: [{ ...SOURCE, title }, { ...SOURCE, title, href: 'https://evil.example/' }] }));
    const view = await render(<SupportChat />);

    await ask(view, 'How do I get verified?');

    const titles = descendants(conversation(view)).filter((element) => textOf(element) === title && ['A', 'SPAN'].includes(element.tagName));
    expect(titles.map((element) => element.tagName)).toEqual(['A', 'SPAN']);
    for (const element of titles) {
      expect(element.className).toContain('[overflow-wrap:anywhere]');
      expect((element.parentElement as FakeElement).className.split(' ')).toContain('min-w-0');
    }
  });

  it('says when no help page fits, with the contact link', async () => {
    mockAsk.mockResolvedValue(helpAnswer({
      answer: "I couldn't find that in TenantVoice's help pages, so I can't answer it. Try asking in other words, or [contact the support team](/contact).",
      ai_status: 'no_match',
      sources: [],
    }));
    const view = await render(<SupportChat />);

    await ask(view, 'qwerty');

    expect(getByName(view, 'a', 'contact the support team').getAttribute('href')).toBe('/contact');
    expect(textOf(conversation(view))).not.toContain('Matching help pages');
  });

  it('keeps the question and offers to try again when support cannot be reached', async () => {
    mockAsk.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.')).mockResolvedValueOnce(aiAnswer());
    const view = await render(<SupportChat />);

    await ask(view, 'How do I get verified?');

    const [alert] = descendants(view).filter((element) => element.getAttribute('role') === 'alert');
    expect(textOf(alert)).toContain('The service is temporarily unavailable. Please try again.');
    expect(box(view).value).toBe('How do I get verified?');
    expect(textOf(conversation(view))).not.toContain('You asked');

    await dispatch(getByName(view, 'button', 'Try again'), 'click');

    expect(mockAsk).toHaveBeenCalledTimes(2);
    expect(descendants(view).filter((element) => element.getAttribute('role') === 'alert')).toEqual([]);
    expect(textOf(conversation(view))).toContain('Upload a photo ID on ID Verification.');
  });

  it('stops at the daily limit, says when it resets and keeps the question', async () => {
    mockAsk.mockRejectedValue(new ApiError(429, 'Used up.', LIMIT));
    const view = await render(<SupportChat />);

    await ask(view, 'How do I get verified?');

    expect(textOf(view)).toContain('Daily limit reached');
    expect(textOf(view)).toContain("You have used today's 30 support chat messages. You can ask again from Wednesday 11:00 am, Sydney time.");
    expect(box(view).hasAttribute('disabled')).toBe(true);
    expect(box(view).value).toBe('How do I get verified?');
    expect(getByName(view, 'button', 'Send').hasAttribute('disabled')).toBe(true);
    expect(getByName(view, 'a', 'FAQs').getAttribute('href')).toBe('/faqs');
    expect(getByName(view, 'a', 'Contact support').getAttribute('href')).toBe('/contact');
    expect(textOf(live(view))).toContain('You can ask again from Wednesday 11:00 am');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('stops after the last message of the day, and warns when few are left', async () => {
    mockAsk
      .mockResolvedValueOnce(aiAnswer({ usage: { ...USAGE, used: 28, remaining: 2 } }))
      .mockResolvedValueOnce(aiAnswer({ usage: { ...USAGE, used: 30, remaining: 0 } }));
    const view = await render(<SupportChat />);

    await ask(view, 'How do I get verified?');
    expect(textOf(view)).toContain('2 messages left today.');
    await ask(view, 'And then?');

    expect(textOf(view)).toContain('Daily limit reached');
    expect(textOf(view)).not.toContain('left today');
    expect(box(view).hasAttribute('disabled')).toBe(true);
  });

  it('starts over with an empty conversation', async () => {
    mockAsk.mockResolvedValue(aiAnswer());
    const view = await render(<SupportChat />);
    await ask(view, 'How do I get verified?');

    await dispatch(getByName(view, 'button', 'Start over'), 'click');

    expect(textOf(conversation(view))).toBe('');
    expect(getByName(view, 'button', 'How do I get verified?')).toBeDefined();
  });
});
