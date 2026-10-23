import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { adminAlertsApi } from './admin-alerts-api';
import { complaintCategoriesApi } from './complaint-categories';
import { redFlagsApi, ruleSummary } from './red-flags-api';

afterEach(() => vi.restoreAllMocks());

describe('a rule in words', () => {
  it('says what it counts, in a window or in total', () => {
    expect(ruleSummary({ threshold_count: 3, trigger_mode: 'WINDOW', window_days: 30 })).toBe('3 complaints about one property within 30 days');
    expect(ruleSummary({ threshold_count: 1, trigger_mode: 'WINDOW', window_days: 1 })).toBe('1 complaint about one property within 1 day');
    expect(ruleSummary({ threshold_count: 10, trigger_mode: 'TOTAL', window_days: 30 })).toBe('10 complaints about one property in total');
  });
});

describe('the requests', () => {
  it('name the version and status the admin saw, and trim notes', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});

    await redFlagsApi.updateRule({ id: 'r 1', updated_at: '2026-10-20T00:00:00Z' }, { threshold_count: 4 });
    await redFlagsApi.setRuleActive('r-1', false, '  Too noisy ');
    await redFlagsApi.evaluate('r-1');
    await redFlagsApi.deleteRule('r-2');
    await redFlagsApi.events('OPEN', 2);
    await redFlagsApi.decide({ id: 'f/1', status: 'ACKNOWLEDGED' }, 'resolve', '  Fixed.  ');
    await redFlagsApi.decide({ id: 'f-2', status: 'OPEN' }, 'acknowledge');
    await adminAlertsApi.escalate('a 1', '  Gas leak  ');
    await complaintCategoriesApi.tenancies();

    expect(fetch.mock.calls).toEqual([
      ['/admin/red-flags/rules/r%201', { method: 'PATCH', body: { threshold_count: 4, expected_updated_at: '2026-10-20T00:00:00Z' } }],
      ['/admin/red-flags/rules/r-1/active', { method: 'POST', body: { is_active: false, reason: 'Too noisy' } }],
      ['/admin/red-flags/rules/r-1/evaluate', { method: 'POST' }],
      ['/admin/red-flags/rules/r-2', { method: 'DELETE' }],
      ['/admin/red-flags/events', { query: { status: 'OPEN', limit: 50, offset: 50 } }],
      ['/admin/red-flags/events/f%2F1/resolve', { method: 'POST', body: { note: 'Fixed.', expected_status: 'ACKNOWLEDGED' } }],
      ['/admin/red-flags/events/f-2/acknowledge', { method: 'POST', body: { note: null, expected_status: 'OPEN' } }],
      ['/admin/alerts/a%201/escalate', { method: 'POST', body: { note: 'Gas leak' } }],
      ['/complaints/tenancies'],
    ]);
  });
});
