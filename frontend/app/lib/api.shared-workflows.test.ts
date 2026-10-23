import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE, api } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockJsonResponse(body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('shared rental workflow API contracts', () => {
  it('sends property reviews using the listing id expected by the shared adapter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ id: 'review-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await api.reviews.create({ property_id: 'listing-1', rating: 4, comment: 'Good view.' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/reviews`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: 'listing-1', rating: 4, comment: 'Good view.' }),
      }),
    );
  });

  it('uses the owner assistant and maintenance endpoints with their mapped payloads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse({ ai_labelled: true }))
      .mockResolvedValueOnce(mockJsonResponse({ id: 'request-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await api.ownerAssistant.ask('What needs attention?');
    await api.maintenance.assign('request-1', 'provider-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${API_BASE}/me/owner-assistant/messages`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ question: 'What needs attention?' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${API_BASE}/maintenance/request-1/assign`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ provider_id: 'provider-1' }),
      }),
    );
  });
});
