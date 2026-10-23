import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { PropertyReview, ReviewableHome } from '@/app/lib/property-reviews';
import { createFakeHistory } from '@/app/test-utils/fake-history';
import ReviewWizard from './ReviewWizard';

const mocks = vi.hoisted(() => ({ homes: vi.fn(), submit: vi.fn() }));
vi.mock('@/app/lib/property-reviews', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/property-reviews')>()),
  propertyReviewsApi: { homes: mocks.homes, submit: mocks.submit },
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const HARBOUR: ReviewableHome = {
  property_id: 'prop-1', listing_id: 'list-1', name: 'Harbour flat', address: 'Wollongong, NSW', property_type: 'Apartment',
  image_url: null, rating: 0, review_count: 0,
};
const HILL: ReviewableHome = { ...HARBOUR, property_id: 'prop-2', listing_id: 'list-2', name: 'Hill house' };
const SAVED = {
  id: 'rev-1', status: 'PUBLISHED', rating: 4, landlord_rating: 5, title: 'Bright flat', comment: 'Quiet street.',
  photo_count: 1, photos: [], ratings: {}, mine: true,
} as unknown as PropertyReview;

let leave = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  leave = createFakeHistory('/tenant/write-review').install(window);
  mocks.homes.mockResolvedValue([HARBOUR]);
  mocks.submit.mockResolvedValue(SAVED);
});
afterEach(async () => {
  await cleanup();
  leave();
});

const inputs = (view: FakeElement, type: string) =>
  descendants(view).filter((element) => element.tagName === 'INPUT' && (element.type || element.getAttribute('type')) === type);
const alertText = (view: FakeElement) =>
  descendants(view).filter((element) => element.getAttribute('role') === 'alert').map(textOf).join(' ');
const pressed = (button: FakeElement) => button.getAttribute('aria-pressed') === 'true';

async function tick(input: FakeElement) {
  input.checked = !input.checked;
  await click(input);
}

/** Scores each of the 8 categories: 4 for all but the last, which gets 5. */
async function rateAll(view: FakeElement) {
  const scores = descendants(view).filter((element) => element.tagName === 'BUTTON' && / of 5, /.test(element.getAttribute('aria-label') ?? ''));
  expect(scores).toHaveLength(40);
  for (let category = 0; category < 8; category += 1) await click(scores[category * 5 + (category === 7 ? 4 : 3)]);
}

const home = (view: FakeElement, name: string) => getByName(view, 'button', new RegExp(`^${name}`));
const groupOf = (view: FakeElement, heading: string) =>
  descendants(view).find((element) => element.getAttribute('role') === 'group' && textOf(element).startsWith(heading)) as FakeElement;
const answer = (view: FakeElement, question: string, text: string) => getByName(groupOf(view, question), 'button', text);
const fieldOf = (view: FakeElement, text: string) => {
  const found = descendants(view).find((element) => element.tagName === 'LABEL' && textOf(element).startsWith(text)) as FakeElement;
  return descendants(view).find((element) => element.id === found.getAttribute('for')) as FakeElement;
};

async function addFiles(view: FakeElement, files: File[]) {
  const input = getByName(view, 'input', 'Add photos');
  input.files = files;
  await dispatch(input, 'change');
}

describe('the review wizard', () => {
  it('asks for all eight ratings before the next step', async () => {
    const view = await render(<ReviewWizard />);

    // The only home is chosen for the tenant.
    expect(pressed(home(view, 'Harbour flat'))).toBe(true);
    await click(getByName(view, 'button', 'Next'));
    expect(alertText(view)).toContain('Rate every category: 8 of 8 still need a score.');
    expect(textOf(view)).toContain('Step 1 of 3');

    await rateAll(view);
    await click(getByName(view, 'button', 'Next'));
    expect(textOf(view)).toContain('Step 2 of 3');
    expect(textOf(view)).toContain('Details & disclosure');
  });

  it('sends every answer and the photos, and shows the review it saved', async () => {
    const view = await render(<ReviewWizard />);
    await rateAll(view);
    await click(getByName(view, 'button', 'Next'));

    await click(getByName(view, 'button', 'Plumbing'));
    await click(getByName(view, 'button', 'Noise'));
    await click(getByName(view, 'button', 'None'));  // None clears the others
    expect(pressed(getByName(view, 'button', 'Plumbing'))).toBe(false);
    await click(getByName(view, 'button', 'Plumbing'));
    expect(pressed(getByName(view, 'button', 'None'))).toBe(false);
    await click(answer(view, 'Were known problems disclosed', 'No'));
    await click(answer(view, 'Would you recommend', 'Yes, I would'));
    await click(answer(view, 'Did you leave because', 'Yes'));
    expect(textOf(view)).toContain('On this website, only you and the TenantVoice moderators see it');
    await click(getByName(view, 'button', 'Next'));

    await click(getByName(view, 'button', 'Plumbing: 1–3 days'));
    await typeInto(fieldOf(view, 'Title'), ' Bright flat ');
    await typeInto(fieldOf(view, 'Your review'), ' Quiet street. ');
    await typeInto(fieldOf(view, 'Advice to the landlord'), 'Fix the gate.');
    const photo = new File([new Uint8Array([1, 2, 3])], 'front.png', { type: 'image/png' });
    await addFiles(view, [photo, new File(['x'], 'plan.gif', { type: 'image/gif' })]);
    expect(textOf(view)).toContain('plan.gif is not a JPEG, PNG or WebP image.');
    expect(getByName(view, 'button', 'Remove photo 1')).toBeTruthy();

    await click(getByName(view, 'button', 'Publish review'));
    expect(alertText(view)).toContain('Tick both confirmations to publish your review.');
    expect(mocks.submit).not.toHaveBeenCalled();
    for (const box of inputs(view, 'checkbox')) await tick(box);
    await click(getByName(view, 'button', 'Publish review'));

    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const [propertyId, review, photos] = mocks.submit.mock.calls[0];
    expect(propertyId).toBe('prop-1');
    expect(Object.values(review.ratings)).toEqual([4, 4, 4, 4, 4, 4, 4, 5]);
    expect(review).toMatchObject({ title: 'Bright flat', body: 'Quiet street.' });
    expect(review.details).toEqual({
      pros: null, cons: null, advice_to_owner: 'Fix the gate.', would_recommend: true, issues_disclosed: false,
      maintenance_or_eviction_issue: true, reported_issues: ['Plumbing: fixed in 1–3 days'],
    });
    expect(photos).toEqual([photo]);
    expect(textOf(view)).toContain('Published: your review is on the listing now.');
    expect(textOf(view)).toContain('in the TenantVoice app, signed-in members can see it with your name.');
    expect(textOf(view)).not.toContain('Your private answer stays with you');
    expect(getByName(view, 'a', 'See it on the listing').getAttribute('href')).toBe('/properties/list-1');
  });

  it('keeps the answers and says why when the server refuses the review', async () => {
    mocks.submit.mockRejectedValue(new ApiError(409, 'A tenant can only review a property once'));
    const view = await render(<ReviewWizard initialStep="submit" />);

    // Opened at the last step, it sends the tenant back to what is missing.
    await typeInto(fieldOf(view, 'Your review'), 'Quiet street.');
    for (const box of inputs(view, 'checkbox')) await tick(box);
    await click(getByName(view, 'button', 'Publish review'));
    expect(textOf(view)).toContain('Step 1 of 3');
    expect(alertText(view)).toContain('Rate every category');

    await rateAll(view);
    await click(getByName(view, 'button', 'Next'));
    await click(getByName(view, 'button', 'Next'));
    await click(getByName(view, 'button', 'Publish review'));

    expect(mocks.submit.mock.calls[0][1]).toMatchObject({ body: 'Quiet street.' });
    expect(alertText(view)).toContain('A tenant can only review a property once');
    // Still on the last step with every answer: sending again sends the same review.
    expect(textOf(view)).toContain('Step 3 of 3');
    await click(getByName(view, 'button', 'Publish review'));
    expect(mocks.submit.mock.calls[1]).toEqual(mocks.submit.mock.calls[0]);
  });

  it('lays each rating scale out as one row of five', async () => {
    const view = await render(<ReviewWizard />);
    const scales = descendants(view).filter((element) => element.getAttribute('role') === 'group'
      && descendants(element).filter((item) => /: \d of 5,/.test(item.getAttribute('aria-label') ?? '')).length === 5);

    expect(scales.length).toBeGreaterThan(0);
    for (const scale of scales) {
      const row = descendants(scale).find((element) => (element.getAttribute('class') ?? '').includes('grid-cols-5'));
      expect(row).toBeTruthy();
    }
  });

  it('refuses a fifth photo', async () => {
    const view = await render(<ReviewWizard initialStep="photos" />);
    const files = [1, 2, 3, 4, 5].map((n) => new File([new Uint8Array([n])], `p${n}.jpg`, { type: 'image/jpeg' }));

    await addFiles(view, files);

    expect(descendants(view).filter((element) => /^Remove photo/.test(element.getAttribute('aria-label') ?? ''))).toHaveLength(4);
    expect(textOf(view)).toContain('You can add up to 4 photos.');
    expect(descendants(view).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'Add photos')).toBe(false);
  });

  it('says that photos can lead signed-in members to the reviewer', async () => {
    // review-photos keys are <users.id>/<file>, and a signed link's path carries that key.
    const view = await render(<ReviewWizard initialStep="photos" />);
    expect(textOf(view)).toContain(
      "A photo's link carries your account's ID, so a member who opens one could find your public profile.",
    );
    expect(textOf(view)).not.toContain('could find my profile from their links');

    await addFiles(view, [new File([new Uint8Array([1])], 'p1.jpg', { type: 'image/jpeg' })]);

    expect(textOf(view)).toContain('Signed-in members who open my photos could find my profile from their links.');
  });

  it('says that the TenantVoice app shows the review with the reviewer\'s name and their answer about leaving', async () => {
    // mobile_property_reviews (any signed-in member) and mobile_owner_review_summary (the owner) return
    // mobile_review_json, which carries the reviewer's full name and maintenanceOrEvictionIssue.
    const view = await render(<ReviewWizard />);
    await rateAll(view);
    await click(getByName(view, 'button', 'Next'));

    expect(textOf(view)).toContain('Who sees this answer');
    expect(textOf(view)).toContain(
      "In the TenantVoice app, signed-in members, the home's owner included, can see it with your review and your name.",
    );
    expect(textOf(view)).not.toContain('Private answer');
    await click(getByName(view, 'button', 'Next'));

    expect(textOf(view)).toContain(
      'I understand that on this website my review is published on the listing as a “Verified tenant”, without my name, '
      + "and that in the TenantVoice app signed-in members, the home's owner included, can see it with my name and any "
      + 'answer I gave about leaving after asking for repairs. Moderators may check it.',
    );
  });

  it('chooses the home the page was opened for', async () => {
    leave();
    leave = createFakeHistory('/tenant/write-review?property=list-2').install(window);
    mocks.homes.mockResolvedValue([HARBOUR, HILL]);

    const view = await render(<ReviewWizard />);

    expect(pressed(home(view, 'Hill house'))).toBe(true);
    expect(pressed(home(view, 'Harbour flat'))).toBe(false);
  });

  it('says when there is nothing to review, and offers a retry when the homes cannot load', async () => {
    mocks.homes.mockResolvedValueOnce([]);
    expect(textOf(await render(<ReviewWizard />))).toContain('Nothing to review yet');
    await cleanup();

    mocks.homes.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<ReviewWizard />);
    expect(textOf(view)).toContain("Couldn't load your homes");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Rate your experience');
  });

  it('keeps every step at AA contrast', async () => {
    const view = await render(<ReviewWizard />);
    expect(lowContrastText(view)).toEqual([]);
    await rateAll(view);
    await click(getByName(view, 'button', 'Next'));
    expect(lowContrastText(view)).toEqual([]);
    await click(getByName(view, 'button', 'Next'));
    expect(lowContrastText(view)).toEqual([]);
  });
});
