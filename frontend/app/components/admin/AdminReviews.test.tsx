import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModeratedReview, ReviewQueue } from '@/app/lib/admin-moderation-api';
import { ApiError } from '@/app/lib/api';
import { moderatedReview } from '@/app/test-utils/admin-moderation';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import AdminReviews from './AdminReviews';

const mocks = vi.hoisted(() => ({ reviews: vi.fn(), moderateReview: vi.fn() }));
vi.mock('@/app/lib/admin-moderation-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-moderation-api')>()),
  adminModerationApi: { reviews: mocks.reviews, moderateReview: mocks.moderateReview },
}));
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => '/admin/reviews',
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

const reported = moderatedReview('r1');
const flagged = moderatedReview('r2', {
  status: 'FLAGGED', reviewer: { id: 'noah', full_name: 'Noah Tenant', role: 'tenant' }, body: 'Mould everywhere.', reports: [],
  open_reports: 0,
});
const hidden = moderatedReview('r3', {
  status: 'HIDDEN', open_reports: 0,
  decisions: [{
    id: 'd1', decision: 'hidden', from_status: 'PUBLISHED', to_status: 'HIDDEN', reason: 'Personal attack.',
    actor: { id: 'ada', full_name: 'Ada Admin', role: 'admin' }, created_at: '2026-10-03T00:00:00Z',
  }],
});

function queueOf(view: ReviewQueue['view'], items: ModeratedReview[], counts = { reported: 2, hidden: 1 }): ReviewQueue {
  return { view, items, total: items.length, limit: 20, offset: 0, counts };
}

let leavePage = () => {};
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/admin/reviews${search}`);
  leavePage = navigation.page.install(window);
}

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};
const openDialog = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open'))!;
const formIn = (element: FakeElement) => descendants(element).find((item) => item.tagName === 'FORM')!;
const cardOf = (view: FakeElement, heading: string) =>
  descendants(view).find((element) => element.tagName === 'LI' && textOf(element).includes(heading))!;

beforeEach(() => {
  vi.clearAllMocks();
  openPage();
  mocks.reviews.mockImplementation(async ({ view }: { view: ReviewQueue['view'] }) => (
    view === 'hidden' ? queueOf('hidden', [hidden]) : queueOf('reported', [reported, flagged])));
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

describe('the review report queue', () => {
  it('lists the reported reviews with their reports, and counts each view', async () => {
    const view = await render(<AdminReviews />);

    expect(mocks.reviews).toHaveBeenCalledWith({ view: 'reported', page: 1 });
    expect(textOf(view)).toContain('2 reported reviews');
    const views = descendants(view).find((element) => element.getAttribute('aria-label') === 'Review views')!;
    expect(textOf(getByName(views, 'a', /Reported/))).toBe('Reported(2)');
    expect(getByName(views, 'a', /Hidden/).getAttribute('href')).toBe('/admin/reviews?view=hidden');
    const mias = cardOf(view, "Mia Tenant's review of Harbour flat");
    expect(textOf(mias)).toContain('The owner is a crook.');
    expect(textOf(mias)).toContain('Oliver Grant');
    expect(textOf(mias)).toContain('Offensive content: Defamatory.');
    expect(textOf(mias)).toContain('1 waiting');
    expect(textOf(cardOf(view, "Noah Tenant's review"))).toContain('Flagged, with no report on record.');
  });

  it("shows an admin a property review's ratings, private answer and photos", async () => {
    const detailed = moderatedReview('r4', {
      reviewer: { id: 'tess', full_name: 'Tess Tenant', role: 'tenant' },
      ratings: { conditionAtMoveIn: 4, ownerResponsiveness: 2 },
      details: {
        pros: 'Bright rooms.', cons: null, advice_to_owner: 'Fix the gate.', would_recommend: false, issues_disclosed: null,
        maintenance_or_eviction_issue: true, reported_issues: ['Plumbing: not fixed'],
      },
      photo_count: 2, photos: [{ url: 'https://abcd.supabase.co/storage/v1/object/sign/review-photos/t/1.png?token=x', expires_in: 600 }],
      reports: [{ ...reported.reports[0], open: false, reason: 'misleading', details: null }],
    });
    mocks.reviews.mockResolvedValue(queueOf('reported', [detailed]));

    const card = cardOf(await render(<AdminReviews />), "Tess Tenant's review");

    for (const text of ['Condition at move-in4 of 5', 'Landlord responsiveness2 of 5', 'Advice to the landlordFix the gate.',
      'Would recommendNo', 'ProblemsPlumbing: not fixed', 'Private: left after asking for repairsYes', 'Photos (2)',
      'Misleading information', 'decided']) {
      expect(textOf(card)).toContain(text);
    }
    expect(descendants(card).filter((element) => element.tagName === 'IMG')).toHaveLength(1);
    expect(lowContrastText(card)).toEqual([]);
  });

  it('hides a review with a reason, which then leaves the queue', async () => {
    mocks.moderateReview.mockResolvedValue({ ...reported, status: 'HIDDEN', open_reports: 0 });
    const view = await render(<AdminReviews />);

    await click(getByName(view, 'button', "Hide Mia Tenant's review"));
    const dialog = openDialog(view);
    expect(textOf(dialog)).toContain('It leaves every public page at once. Mia Tenant is told why');
    await dispatch(formIn(dialog), 'submit');
    expect(mocks.moderateReview).not.toHaveBeenCalled();

    mocks.reviews.mockResolvedValue(queueOf('reported', [flagged], { reported: 1, hidden: 2 }));
    await typeInto(field(dialog, 'Reason') as FakeElement, 'Personal attack on the owner.');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.moderateReview).toHaveBeenCalledWith(reported, 'hide', 'Personal attack on the owner.');
    expect(textOf(view)).toContain('The review was hidden. Mia Tenant was told why.');
    expect(textOf(view)).not.toContain('The owner is a crook.');
    expect(textOf(view)).toContain('1 reported review');
  });

  it('keeps a reported review published with a reason', async () => {
    mocks.moderateReview.mockResolvedValue({ ...flagged, status: 'PUBLISHED' });
    const view = await render(<AdminReviews />);

    await click(getByName(view, 'button', "Keep published Noah Tenant's review"));
    const dialog = openDialog(view);
    await typeInto(field(dialog, 'Reason') as FakeElement, 'The photos show mould.');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.moderateReview).toHaveBeenCalledWith(flagged, 'restore', 'The photos show mould.');
    expect(textOf(view)).toContain('The review stays published.');
  });

  it('restores a hidden review from the hidden view, with its decisions shown', async () => {
    openPage('?view=hidden');
    mocks.moderateReview.mockResolvedValue({ ...hidden, status: 'PUBLISHED' });
    const view = await render(<AdminReviews />);

    expect(mocks.reviews).toHaveBeenCalledWith({ view: 'hidden', page: 1 });
    expect(textOf(view)).toContain('Hidden by Ada Admin');
    expect(textOf(view)).toContain('Personal attack.');
    await click(getByName(view, 'button', "Restore Mia Tenant's review"));
    const dialog = openDialog(view);
    expect(textOf(dialog)).toContain('It shows on public pages again.');
    await typeInto(field(dialog, 'Reason') as FakeElement, 'Upheld on appeal.');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.moderateReview).toHaveBeenCalledWith(hidden, 'restore', 'Upheld on appeal.');
    expect(textOf(view)).toContain('The review was restored.');
  });

  it('shows the server\'s reason when the review changed first, and reloads the queue', async () => {
    mocks.moderateReview.mockRejectedValue(new ApiError(409, 'This review changed while you were looking at it. Reload the queue and try again.'));
    const view = await render(<AdminReviews />);

    await click(getByName(view, 'button', "Hide Mia Tenant's review"));
    const dialog = openDialog(view);
    await typeInto(field(dialog, 'Reason') as FakeElement, 'Rude');
    await dispatch(formIn(dialog), 'submit');

    expect(textOf(dialog)).toContain('This review changed while you were looking at it.');
    expect(mocks.reviews).toHaveBeenCalledTimes(2);
  });

  it('says when nothing waits, and offers a retry when the queue cannot load', async () => {
    mocks.reviews.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    mocks.reviews.mockResolvedValueOnce(queueOf('reported', [], { reported: 0, hidden: 0 }));
    const view = await render(<AdminReviews />);

    expect(textOf(view)).toContain("Couldn't load the reviews");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Nothing to decide');
  });

  it('keeps the queue at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminReviews />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
