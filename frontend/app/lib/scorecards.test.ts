import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./api', () => http);

import {
  formatScorecardAverage,
  SCORECARD_ITEMS,
  scorecardDates,
  scorecardHome,
  scorecards,
  unratedItems,
  type ScorecardAnswers,
} from './scorecards';

const doc = readFileSync(new URL('../../../docs/shared-db.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
const ANSWERS = Object.fromEntries(SCORECARD_ITEMS.map((item) => [item.key, 4])) as ScorecardAnswers;

beforeEach(() => http.apiFetch.mockReset().mockResolvedValue({}));

describe('the scorecards API', () => {
  it('lists, asks, answers, cancels and shows requests at the backend routes', async () => {
    await scorecards.list();
    await scorecards.recipients();
    await scorecards.request('owner-1', 'home-1');
    await scorecards.submit('s1', ANSWERS, 'Lovely tenant.');
    await scorecards.decline('s1', null);
    await scorecards.cancel('s1');
    await scorecards.setVisible('s1', true);

    expect(http.apiFetch.mock.calls).toEqual([
      ['/me/scorecard-requests'],
      ['/me/scorecard-requests/recipients'],
      ['/me/scorecard-requests', { method: 'POST', body: { owner_user_id: 'owner-1', property_id: 'home-1' } }],
      ['/scorecard-requests/s1/submit', { method: 'POST', body: { answers: ANSWERS, comment: 'Lovely tenant.' } }],
      ['/scorecard-requests/s1/decline', { method: 'POST', body: { reason: null } }],
      ['/scorecard-requests/s1/cancel', { method: 'POST' }],
      ['/scorecard-requests/s1', { method: 'PATCH', body: { visible_on_profile: true } }],
    ]);
  });
});

describe('the Owner/Agent Tenant Scorecard', () => {
  it('asks the seven items docs/shared-db.md lists, in their order, as the backend does', () => {
    const [, listed] = /The seven items, in their order, are (.+?) \(/.exec(doc) ?? [];

    expect([...(listed ?? '').matchAll(/`(\w+)`/g)].map(([, key]) => key)).toEqual(SCORECARD_ITEMS.map((item) => item.key));
    expect(SCORECARD_ITEMS.map((item) => item.label)).toEqual([
      'Paid rent on time', 'Looked after the property', 'Communicated respectfully', 'Followed lease conditions',
      'Cooperated with inspections', 'Left property in good condition', 'Would you rent to this tenant again?',
    ]);
  });

  it('names the items still to rate, in order, counting only ratings from 1 to 5', () => {
    expect(unratedItems({})).toHaveLength(7);
    expect(unratedItems(ANSWERS)).toEqual([]);
    expect(unratedItems({ ...ANSWERS, looked_after_property: 0, would_rent_again: 6 })).toEqual(['looked_after_property', 'would_rent_again']);
  });
});

describe('scorecard labels', () => {
  it('gives the average to one decimal, out of 5', () => {
    expect(formatScorecardAverage(4.57)).toBe('4.6 out of 5');
    expect(formatScorecardAverage(5)).toBe('5.0 out of 5');
    expect(formatScorecardAverage(null)).toBe('No rating');
  });

  it('says when a request was asked, and answered or cancelled', () => {
    expect(scorecardDates({ status: 'pending', requested_at: '2026-10-01T00:00:00Z', decided_at: null })).toBe('Asked 1 Oct 2026');
    expect(scorecardDates({ status: 'completed', requested_at: '2026-10-01T00:00:00Z', decided_at: '2026-10-05T00:00:00Z' }))
      .toBe('Asked 1 Oct 2026 · Completed 5 Oct 2026');
    expect(scorecardDates({ status: 'cancelled', requested_at: '2026-10-01T00:00:00Z', decided_at: '2026-10-02T00:00:00Z' }))
      .toBe('Asked 1 Oct 2026 · Cancelled 2 Oct 2026');
  });

  it('names the home with its suburb and state when it has them', () => {
    expect(scorecardHome({ property_label: '1 Harbour Street', suburb: 'Wollongong', state: 'NSW' })).toBe('1 Harbour Street, Wollongong NSW');
    expect(scorecardHome({ property_label: 'A home', suburb: null, state: null })).toBe('A home');
  });
});
