import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
  SUPPORT_HISTORY_TURNS,
  SUPPORT_TURN_LIMIT,
  aiUnavailable,
  answerParts,
  answerRefusal,
  askSupport,
  historyContent,
  plainAnswer,
  resetTime,
  safeInternalHref,
  supportHistory,
  supportLimit,
  type SupportAnswer,
} from './support-chat';

const answer = (over: Partial<SupportAnswer> = {}): SupportAnswer => ({
  answer: 'Upload a photo ID on [ID Verification](/tenant/id-verification).',
  sources: [{ title: 'How tenants get verified', href: '/tenant/id-verification', excerpt: 'A tenant account…' }],
  source: 'ai',
  ai_status: 'applied',
  verification: null,
  usage: { used: 1, limit: 30, remaining: 29, resets_at: '2030-01-16T00:00:00Z' },
  ...over,
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('safeInternalHref', () => {
  it.each(['/faqs', '/tenant/id-verification', '/dashboard/profile#verification-documents', '/'])('keeps the site path %s', (href) => {
    expect(safeInternalHref(href)).toBe(href);
  });

  it.each([
    'https://evil.example', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', 'tenant/settings',
    '/faqs?next=//evil', '/a b', ' /faqs', '/x"onmouseover="y', `/${'a'.repeat(300)}`, 42, null,
  ])('refuses %s', (href) => {
    expect(safeInternalHref(href)).toBeNull();
  });
});

describe('answerParts', () => {
  it('reads [label](path) as a link and keeps the text around it', () => {
    expect(answerParts('Open [ID Verification](/tenant/id-verification), then [contact us](/contact).')).toEqual([
      { kind: 'text', text: 'Open ' },
      { kind: 'link', text: 'ID Verification', href: '/tenant/id-verification' },
      { kind: 'text', text: ', then ' },
      { kind: 'link', text: 'contact us', href: '/contact' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps only the words of a link that does not open a page on this site', () => {
    expect(answerParts('See [this](https://evil.example/login) and [that](javascript:alert(1)).')).toEqual([
      { kind: 'text', text: 'See this and [that](javascript:alert(1)).' },
    ]);
    expect(answerParts('[a](//evil.example) or [b](/\\evil)')).toEqual([{ kind: 'text', text: 'a or b' }]);
  });

  it('leaves plain text and stray brackets as text', () => {
    expect(answerParts('No links [here] (really).')).toEqual([{ kind: 'text', text: 'No links [here] (really).' }]);
    expect(answerParts('')).toEqual([]);
  });

  it('reads an answer aloud as its words', () => {
    expect(plainAnswer('Open [ID Verification](/tenant/id-verification) now.')).toBe('Open ID Verification now.');
  });
});

describe('supportHistory', () => {
  it('sends the newest turns, each within the bound, and no empty ones', () => {
    const turns = Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `turn ${index}` }));
    turns.push({ role: 'user', content: '   ' }, { role: 'assistant', content: 'x'.repeat(2500) });

    const sent = supportHistory(turns);

    expect(sent).toHaveLength(SUPPORT_HISTORY_TURNS);
    expect(sent[0].content).toBe('turn 5');
    expect(sent.at(-1)?.content).toHaveLength(SUPPORT_TURN_LIMIT);
    expect(sent.some((turn) => !turn.content.trim())).toBe(false);
  });

  it('carries an AI answer as its words, and the help pages a fallback showed', () => {
    expect(historyContent(answer())).toBe('Upload a photo ID on ID Verification.');
    expect(historyContent(answer({ source: 'help', ai_status: 'not_configured', answer: 'AI answers are unavailable right now.' })))
      .toBe('AI answers are unavailable right now. Help pages: How tenants get verified.');
  });
});

describe('the states an answer or an error carries', () => {
  it('tells an answer the help pages give from one the AI wrote', () => {
    expect(aiUnavailable(answer())).toBe(false);
    expect(aiUnavailable(answer({ source: 'help', ai_status: 'no_match', sources: [] }))).toBe(false);
    for (const status of ['not_configured', 'unavailable', 'verification_required'] as const) {
      expect(aiUnavailable(answer({ source: 'help', ai_status: status }))).toBe(true);
    }
  });

  it('keeps a refusal only with a documents link on this site', () => {
    const verification = { code: 'verification_required' as const, action: 'paid_ai', status: 'pending', message: 'Verify first.', documents_href: 'https://evil.example' };

    expect(answerRefusal(answer({ verification }))).toEqual({ ...verification, documents_href: null });
    expect(answerRefusal(answer())).toBeNull();
  });

  it('recognises the daily limit and nothing else', () => {
    const detail = { code: 'support_chat_limit', message: 'Used up.', limit: 30, resets_at: '2030-01-16T00:00:00+00:00' };

    expect(supportLimit(new ApiError(429, 'Used up.', detail))).toEqual(detail);
    expect(supportLimit(new ApiError(429, 'Too many requests.'))).toBeNull();
    expect(supportLimit(new ApiError(403, 'No.', detail))).toBeNull();
    expect(supportLimit(new Error('offline'))).toBeNull();
  });

  it('says when the count starts again in Sydney time', () => {
    expect(resetTime('2030-01-16T00:00:00+00:00')).toBe('Wednesday 11:00 am');
    expect(resetTime('2030-07-16T00:00:00Z')).toBe('Tuesday 10:00 am');
    expect(resetTime('soon')).toBeNull();
  });
});

describe('askSupport', () => {
  it('posts the question and the conversation to the support chat', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(answer()), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await askSupport('How do I get verified?', [{ role: 'user', content: 'Hi' }]);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/support\/chat$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ message: 'How do I get verified?', history: [{ role: 'user', content: 'Hi' }] });
  });
});
