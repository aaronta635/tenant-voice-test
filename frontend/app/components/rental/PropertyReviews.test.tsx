import { cleanup, click, descendants, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { PropertyReview } from '@/app/lib/property-reviews';
import PropertyReviews from './PropertyReviews';

const mocks = vi.hoisted(() => ({ forProperty: vi.fn(), report: vi.fn() }));
vi.mock('@/app/lib/property-reviews', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/property-reviews')>()),
  propertyReviewsApi: { forProperty: mocks.forProperty, report: mocks.report },
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

function review(id: string, over: Partial<PropertyReview> = {}): PropertyReview {
  return {
    id, provider_id: 'olivia', property_id: 'prop-1', rating: 4, landlord_rating: 5, title: 'Bright flat',
    comment: 'Quiet street and quick repairs.', provider_reply: null, replied_at: null, created_at: '2026-10-20T01:00:00Z',
    client_name: 'Verified tenant', ratings: { conditionAtMoveIn: 4, costValue: 3 }, pros: 'Light.', cons: null,
    advice_to_owner: 'Fix the gate.', would_recommend: true, issues_disclosed: false, reported_issues: ['Plumbing: fixed in 1–3 days'],
    maintenance_or_eviction_issue: null, photo_count: 2, photos: [], verified: true, status: 'PUBLISHED', mine: false,
    reported_by_me: false, ...over,
  };
}

const PHOTO = 'https://abcd.supabase.co/storage/v1/object/sign/review-photos/t/1.png?token=t1';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.forProperty.mockResolvedValue([
    review('r1'),
    review('r2', { rating: 5, ratings: { conditionAtMoveIn: 5 }, title: null, comment: 'Lovely.', photo_count: 0, would_recommend: null, issues_disclosed: null, reported_issues: [] }),
  ]);
  mocks.report.mockResolvedValue({ review_id: 'r1', reason: 'spam', reported_by_me: true });
});
afterEach(cleanup);

const show = (viewerRole: string | null = null) =>
  render(<PropertyReviews propertyId="list-1" viewerRole={viewerRole} signInHref="/login?role=tenant&next=%2Fproperties%2Flist-1" />);
const item = (view: FakeElement, index: number) =>
  descendants(view).filter((element) => element.tagName === 'LI' && element.getAttribute('aria-labelledby'))[index];

describe("a listing's reviews", () => {
  it('shows the averages per category and the review history', async () => {
    const view = await show();

    expect(mocks.forProperty).toHaveBeenCalledWith('list-1');
    const text = textOf(view);
    expect(text).toContain('4.5 out of 5 from 2 reviews');
    expect(text).toContain('Condition at move-in4.5');
    expect(text).toContain('Cost & value3.0');
    expect(text).not.toContain('Neighbourhood');  // nobody scored it
    expect(textOf(item(view, 0))).toContain('Would recommend');
    expect(textOf(item(view, 0))).toContain('Problems not disclosed before the lease');
    expect(textOf(item(view, 0))).toContain('Plumbing: fixed in 1–3 days');
    expect(textOf(item(view, 0))).toContain('Advice to the landlordFix the gate.');
    expect(textOf(view)).not.toMatch(/\bowners?\b/i);
  });

  it('asks a visitor to sign in for the photos, and offers no report', async () => {
    const view = await show();

    expect(textOf(item(view, 0))).toContain('2 photos with this review. Sign in to see them.');
    expect(getByName(item(view, 0), 'a', 'Sign in').getAttribute('href')).toBe('/login?role=tenant&next=%2Fproperties%2Flist-1');
    expect(descendants(view).some((element) => element.tagName === 'BUTTON' && /Report/.test(textOf(element)))).toBe(false);
    expect(descendants(view).some((element) => element.tagName === 'IMG')).toBe(false);
  });

  it("shows a member the photos, and an author their answer about leaving only on their own review", async () => {
    mocks.forProperty.mockResolvedValue([
      review('r1', { photos: [{ url: PHOTO, expires_in: 600 }], photo_count: 1 }),
      review('r2', { mine: true, maintenance_or_eviction_issue: true, title: null }),
    ]);
    const view = await show('tenant');

    const [image] = descendants(item(view, 0)).filter((element) => element.tagName === 'IMG');
    expect(image.getAttribute('src')).toBe(PHOTO);
    expect(textOf(item(view, 0))).not.toContain('Your answer');
    expect(textOf(item(view, 1))).toContain('Your answer: you left because you were asked to after asking for repairs.');
    // mobile_review_json gives the answer and the reviewer's name to every signed-in member of the app.
    expect(textOf(item(view, 1))).toContain(
      'On this website only you and the moderators see it; in the TenantVoice app, signed-in members can see it with your name.',
    );
    expect(textOf(item(view, 1))).toContain('Your review');
    expect(descendants(item(view, 1)).some((element) => element.tagName === 'BUTTON' && /Report/.test(textOf(element)))).toBe(false);
    expect(getByName(view, 'a', 'Write a review').getAttribute('href')).toBe('/tenant/write-review?property=list-1');
  });

  it('reports a review with a reason, once', async () => {
    const view = await show('landlord');
    expect(descendants(view).some((element) => element.tagName === 'A' && textOf(element) === 'Write a review')).toBe(false);

    await click(getByName(item(view, 0), 'button', 'Report this review'));
    const dialog = descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open')) as FakeElement;
    await click(getByName(dialog, 'button', 'Send report'));
    expect(textOf(dialog)).toContain('Choose why you are reporting this review.');
    expect(mocks.report).not.toHaveBeenCalled();

    await click(getByName(dialog, 'button', 'Misleading information'));
    const details = descendants(dialog).find((element) => element.tagName === 'TEXTAREA') as FakeElement;
    await typeInto(details, 'No back gate.');
    await click(getByName(dialog, 'button', 'Send report'));

    expect(mocks.report).toHaveBeenCalledWith('r1', 'misleading', 'No back gate.');
    expect(textOf(view)).toContain('Thanks: the review was reported.');
    expect(textOf(item(view, 0))).toContain('You reported this review.');
  });

  it("shows the server's reason when a report is refused", async () => {
    mocks.report.mockRejectedValue(new ApiError(409, 'You have already reported this review.'));
    const view = await show('tenant');

    await click(getByName(item(view, 0), 'button', 'Report this review'));
    const dialog = descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open')) as FakeElement;
    await click(getByName(dialog, 'button', 'Spam'));
    await click(getByName(dialog, 'button', 'Send report'));

    expect(textOf(dialog)).toContain('You have already reported this review.');
  });

  it('says when there are no reviews, and offers a retry when they cannot load', async () => {
    mocks.forProperty.mockResolvedValueOnce([]);
    expect(textOf(await show())).toContain('No reviews yet for this listing.');
    await cleanup();

    mocks.forProperty.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await show();
    expect(textOf(view)).toContain("Couldn't load the reviews.");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('4.5 out of 5 from 2 reviews');
  });

  it('keeps the reviews at AA contrast, also under the pointer', async () => {
    mocks.forProperty.mockResolvedValue([review('r1', { mine: true, maintenance_or_eviction_issue: false, provider_reply: 'Thanks!' })]);
    const view = await show('tenant');

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
