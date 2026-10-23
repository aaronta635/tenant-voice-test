import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { adminModerationApi, listingFiltersHref, parseListingFilters, parseReviewFilters, reviewFiltersHref } from './admin-moderation-api';

afterEach(() => vi.restoreAllMocks());

describe('the moderation pages\' URLs', () => {
  it('read and write the review queue view, with reported reviews as the default', () => {
    expect(parseReviewFilters(new URLSearchParams('view=hidden&page=2'))).toEqual({ view: 'hidden', page: 2 });
    expect(reviewFiltersHref({ view: 'hidden', page: 2 })).toBe('/admin/reviews?view=hidden&page=2');
    expect(parseReviewFilters(new URLSearchParams('view=deleted'))).toEqual({ view: 'reported', page: 1 });
    expect(reviewFiltersHref({ view: 'reported', page: 1 })).toBe('/admin/reviews');
  });

  it('read and write the listings filters', () => {
    expect(parseListingFilters(new URLSearchParams('status=PAUSED&q=harbour&page=3'))).toEqual({ status: 'PAUSED', q: 'harbour', page: 3 });
    expect(listingFiltersHref({ status: 'PAUSED', q: ' harbour ', page: 1 })).toBe('/admin/listings?status=PAUSED&q=harbour');
    expect(parseListingFilters(new URLSearchParams('status=paused')).status).toBe('');
  });
});

describe('the requests', () => {
  it('name the status the admin saw', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});

    await adminModerationApi.moderateReview({ id: 'r 1', status: 'FLAGGED' }, 'hide', '  Spam  ');
    await adminModerationApi.moderateListing({ id: 'l-1', status: 'PUBLISHED' }, 'pause', 'Wrong photos');

    expect(fetch.mock.calls).toEqual([
      ['/admin/reviews/r%201/moderation', { method: 'POST', body: { action: 'hide', reason: 'Spam', expected_status: 'FLAGGED' } }],
      ['/admin/listings/l-1/moderation', { method: 'POST', body: { action: 'pause', reason: 'Wrong photos', expected_status: 'PUBLISHED' } }],
    ]);
  });
});
