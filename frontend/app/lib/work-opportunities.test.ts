import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./api', () => http);

import { areaList, MATCH_LABELS, workOpportunities } from './work-opportunities';

beforeEach(() => http.apiFetch.mockReset().mockResolvedValue({ items: [], areas: [], generated_at: '2026-10-23T00:00:00Z' }));

describe('workOpportunities', () => {
  it('asks for the signed-in provider\'s own opportunities, twelve by default', async () => {
    await workOpportunities();
    await workOpportunities(24);

    expect(http.apiFetch.mock.calls).toEqual([
      ['/me/recommendations/provider/opportunities', { query: { limit: 12 } }],
      ['/me/recommendations/provider/opportunities', { query: { limit: 24 } }],
    ]);
  });
});

describe('opportunity wording', () => {
  it('lists the areas as a sentence does', () => {
    expect(areaList([])).toBe('');
    expect(areaList(['Newtown'])).toBe('Newtown');
    expect(areaList(['Newtown', 'Glebe', 'VIC'])).toBe('Newtown, Glebe and VIC');
  });

  it('labels every match the server sends', () => {
    expect(Object.keys(MATCH_LABELS)).toEqual(['listing_in_area', 'based_in_area', 'state_in_area', 'same_state']);
  });
});
