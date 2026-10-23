import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { recordListingView, resetListingViews, VISITOR_KEY, visitorId } from './listing-views';
import { stubBrowser } from './test-browser';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => resetListingViews());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the visitor id', () => {
  it('is one random id the browser keeps, which the server accepts', () => {
    const { storage } = stubBrowser();

    const first = visitorId();

    expect(first).toMatch(UUID);
    expect(storage.get(VISITOR_KEY)).toBe(first);
    expect(visitorId()).toBe(first);
  });

  it('replaces a stored value the server would refuse', () => {
    const { storage } = stubBrowser();
    storage.set(VISITOR_KEY, 'not ok; 1');

    expect(visitorId()).toMatch(UUID);
    expect(storage.get(VISITOR_KEY)).not.toBe('not ok; 1');
  });

  it('lasts the page load in a browser that keeps no storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
    });

    const first = visitorId();

    expect(first).toMatch(UUID);
    expect(visitorId()).toBe(first);
  });
});

describe('the beacon', () => {
  it('sends each listing once per page load, with the visitor id', async () => {
    stubBrowser();
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({ counted: true });

    await recordListingView('listing-1');
    await recordListingView('listing-1');
    await recordListingView('listing 2');
    await recordListingView('');

    expect(fetch.mock.calls).toEqual([
      ['/properties/listing-1/views', { method: 'POST', body: { visitor_id: visitorId() } }],
      ['/properties/listing%202/views', { method: 'POST', body: { visitor_id: visitorId() } }],
    ]);
  });

  it('never fails the page when the view is not counted', async () => {
    stubBrowser();
    vi.spyOn(api, 'apiFetch').mockRejectedValue(new api.ApiError(404, 'This item could not be found.'));

    await expect(recordListingView('listing-1')).resolves.toBeUndefined();
  });
});
