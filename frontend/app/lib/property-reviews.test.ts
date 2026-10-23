import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import {
  REVIEW_CATEGORIES,
  categoryAverages,
  issueLine,
  overallAverage,
  photoProblem,
  propertyReviewsApi,
  type PropertyReviewInput,
} from './property-reviews';

afterEach(() => vi.restoreAllMocks());

const INPUT: PropertyReviewInput = {
  ratings: Object.fromEntries(REVIEW_CATEGORIES.map(({ key }) => [key, 4])) as PropertyReviewInput['ratings'],
  title: 'Bright flat',
  body: 'Quiet street.',
  details: {
    pros: null, cons: null, advice_to_owner: null, would_recommend: true, issues_disclosed: null,
    maintenance_or_eviction_issue: false, reported_issues: [],
  },
};

describe('the review requests', () => {
  it('send the review and its photos in one multipart request', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});
    const photo = new File([new Uint8Array([0x89, 0x50])], 'front.png', { type: 'image/png' });

    await propertyReviewsApi.submit('listing 1', INPUT, [photo]);

    const [path, options] = fetch.mock.calls[0] as [string, { method: string; formData: FormData }];
    expect((path as string)).toBe('/properties/listing%201/reviews');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.formData.get('review') as string)).toEqual(INPUT);
    expect(options.formData.getAll('photos')).toHaveLength(1);
  });

  it('report a review with its reason, and details only when given', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});

    await propertyReviewsApi.report('r1', 'misleading', '  Never had a gate. ');
    await propertyReviewsApi.report('r1', 'spam', '   ');
    await propertyReviewsApi.homes();

    expect(fetch.mock.calls).toEqual([
      ['/reviews/r1/reports', { method: 'POST', body: { reason: 'misleading', details: 'Never had a gate.' } }],
      ['/reviews/r1/reports', { method: 'POST', body: { reason: 'spam', details: null } }],
      ['/me/reviewable-homes'],
    ]);
  });
});

describe('the review figures', () => {
  it('average each category over the reviews that scored it', () => {
    const averages = categoryAverages([
      { ratings: { conditionAtMoveIn: 4, costValue: 2 } },
      { ratings: { conditionAtMoveIn: 5 } },
      { ratings: {} },
    ]);

    expect(averages.find((item) => item.key === 'conditionAtMoveIn')).toMatchObject({ average: 4.5, count: 2 });
    expect(averages.find((item) => item.key === 'costValue')).toMatchObject({ average: 2, count: 1 });
    expect(averages.find((item) => item.key === 'neighbourhood')).toMatchObject({ average: null, count: 0 });
    expect(averages.map((item) => item.label)).not.toContain('Owner responsiveness');
  });

  it('average the overall scores to one decimal', () => {
    expect(overallAverage([{ rating: 4 }, { rating: 5 }, { rating: 5 }])).toBe(4.7);
    expect(overallAverage([])).toBeNull();
  });

  it('keep an issue and how fast it was fixed to 80 characters', () => {
    expect(issueLine('Plumbing', 'days')).toBe('Plumbing: fixed in 1–3 days');
    expect(issueLine('Noise', null)).toBe('Noise');
    expect(issueLine('x'.repeat(90), 'never')).toHaveLength(80);
  });

  it('say why a photo cannot be sent', () => {
    expect(photoProblem({ name: 'a.png', type: 'image/png', size: 10 })).toBeNull();
    expect(photoProblem({ name: 'a.gif', type: 'image/gif', size: 10 })).toBe('a.gif is not a JPEG, PNG or WebP image.');
    expect(photoProblem({ name: 'big.jpg', type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toBe('big.jpg is over 5 MB.');
    expect(photoProblem({ name: 'none.webp', type: 'image/webp', size: 0 })).toBe('none.webp is empty.');
  });
});
