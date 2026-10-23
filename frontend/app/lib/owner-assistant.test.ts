import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, api } from './api';
import { historyTurns, newRequestId, replyKind } from './owner-assistant';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('the owner assistant API', () => {
  it('sends the request id with a question and confirms by the answer\'s id', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);

    await api.ownerAssistant.ask('Any repairs?', 'chat-1');
    await api.ownerAssistant.confirm('chat-1');

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/me/owner-assistant/messages`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ question: 'Any repairs?', request_id: 'chat-1' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/me/owner-assistant/messages/chat-1/confirm`,
      expect.objectContaining({ method: 'POST' }));
  });
});

describe('replyKind', () => {
  it('tells the rules\' replies and the old saved-data replies from the model\'s', () => {
    expect(replyKind('AI unavailable: answered by fixed rules from your records, not by an AI model.\n\nYou have 1 listing.')).toBe('rules');
    expect(replyKind('AI-labelled, read-only until you confirm a separate action.\n\n{}')).toBe('saved-data');
    expect(replyKind('One repair is open.', 'ai')).toBe('ai');
    expect(replyKind('One repair is open.')).toBe('unknown');
  });
});

describe('historyTurns', () => {
  it('keeps the turns with a question and a reply, in order', () => {
    expect(historyTurns([{ question: 'Q1', reply: 'A1' }, { question: '', reply: 'A2' }, null, { question: 'Q3', reply: 3 }, { question: 'Q4', reply: 'A4' }]))
      .toEqual([{ question: 'Q1', reply: 'A1' }, { question: 'Q4', reply: 'A4' }]);
    expect(historyTurns({ not: 'a list' })).toEqual([]);
  });
});

describe('newRequestId', () => {
  it('makes a fresh version 4 uuid, also without crypto.randomUUID', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(newRequestId()).toMatch(uuid);
    expect(newRequestId()).not.toBe(newRequestId());

    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab) });
    expect(newRequestId()).toBe('abababab-abab-4bab-abab-abababababab');
  });
});
