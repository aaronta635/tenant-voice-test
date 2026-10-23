import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { activityFiltersHref, adminActivityApi, analyticsHref, parseActivityFilters, parseAnalyticsRange } from './admin-activity-api';

afterEach(() => vi.restoreAllMocks());

describe('the oversight pages\' URLs', () => {
  it('read and write the activity filters, keeping only calendar days', () => {
    const filters = parseActivityFilters(new URLSearchParams('log=web&actor=ada&action=status&entity=review&from=2026-10-01&to=yesterday&page=2'));
    expect(filters).toEqual({ log: 'web', actor: 'ada', action: 'status', entity: 'review', from: '2026-10-01', to: '', page: 2 });
    expect(activityFiltersHref(filters)).toBe('/admin/activity?log=web&actor=ada&action=status&entity=review&from=2026-10-01&page=2');
    expect(parseActivityFilters(new URLSearchParams('log=mobile&entity=Review;drop')).log).toBe('admin');
    expect(parseActivityFilters(new URLSearchParams('entity=Review;drop')).entity).toBe('');
  });

  it('read and write the analytics range', () => {
    expect([parseAnalyticsRange(new URLSearchParams('days=90')), parseAnalyticsRange(new URLSearchParams('days=7'))]).toEqual([90, 30]);
    expect([analyticsHref(30), analyticsHref(365)]).toEqual(['/admin/analytics', '/admin/analytics?days=365']);
  });
});

describe('the requests', () => {
  it('send the activity filters the server knows', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});

    await adminActivityApi.activity({ log: 'admin', actor: ' ada ', action: '', entity: 'review', from: '2026-10-01', to: '', page: 2 });
    await adminActivityApi.analytics(90);

    expect(fetch.mock.calls).toEqual([
      ['/admin/activity', {
        query: { log: 'admin', actor: 'ada', action: '', entity_type: 'review', from: '2026-10-01', to: '', limit: 25, offset: 25 },
      }],
      ['/admin/analytics', { query: { days: 90 } }],
    ]);
  });
});
