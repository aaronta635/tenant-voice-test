import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListingPage, ModeratedListing } from '@/app/lib/admin-moderation-api';
import { ApiError } from '@/app/lib/api';
import { moderatedListing } from '@/app/test-utils/admin-moderation';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import AdminListings from './AdminListings';

const mocks = vi.hoisted(() => ({ listings: vi.fn(), moderateListing: vi.fn() }));
vi.mock('@/app/lib/admin-moderation-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-moderation-api')>()),
  adminModerationApi: { listings: mocks.listings, moderateListing: mocks.moderateListing },
}));
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => '/admin/listings',
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

const live = moderatedListing('l1', { title: 'Sunny house', manager: { id: 'alex', full_name: 'Alex Agent', role: 'landlord' } });
const rented = moderatedListing('l2', { title: 'Harbour flat', status: 'LEASED', actions: [] });
const paused = moderatedListing('l3', {
  title: 'Old cottage', status: 'PAUSED', actions: ['archive'],
  last_decision: { decision: 'paused', reason: 'Photos of another house.', actor: { id: 'ada', full_name: 'Ada Admin', role: 'admin' }, created_at: '2026-10-05T00:00:00Z' },
});

function pageOf(items: ModeratedListing[], total = items.length): ListingPage {
  return { items, total, limit: 20, offset: 0 };
}

let leavePage = () => {};
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/admin/listings${search}`);
  leavePage = navigation.page.install(window);
}

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};
const openDialog = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open'))!;
const formIn = (element: FakeElement) => descendants(element).find((item) => item.tagName === 'FORM')!;
const row = (view: FakeElement, title: string) =>
  descendants(view).find((element) => element.tagName === 'LI' && textOf(element).startsWith(title))!;

beforeEach(() => {
  vi.clearAllMocks();
  openPage();
  mocks.listings.mockResolvedValue(pageOf([live, rented, paused]));
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

describe('the admin listings', () => {
  it('show each listing with its owner, state, last decision and the actions it allows', async () => {
    const view = await render(<AdminListings />);

    expect(mocks.listings).toHaveBeenCalledWith({ status: '', q: '', page: 1 });
    expect(getByName(row(view, 'Sunny house'), 'a', 'Sunny house').getAttribute('href')).toBe('/properties/l1');
    expect(textOf(row(view, 'Sunny house'))).toContain('Managed by Alex Agent');
    expect(getByName(row(view, 'Sunny house'), 'a', 'Oliver Grant').getAttribute('href')).toBe('/admin/users/oliver');
    expect(descendants(row(view, 'Harbour flat')).some((element) => element.tagName === 'BUTTON')).toBe(false);
    expect(textOf(row(view, 'Old cottage'))).toContain('Paused by Ada Admin on 5 Oct 2026: Photos of another house.');
    expect(descendants(row(view, 'Old cottage')).filter((element) => element.tagName === 'BUTTON').map(textOf)).toEqual(['Archive Old cottage']);
  });

  it('writes the filters to the URL', async () => {
    const view = await render(<AdminListings />);

    const status = field(view, 'Status') as FakeElement;
    status.value = 'PAUSED';
    await dispatch(status, 'change');
    await typeInto(field(view, 'Title') as FakeElement, ' cottage ');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');
    await act(async () => { navigation.page.land(); });
    await settle();

    expect(navigation.page.location.search).toBe('?status=PAUSED&q=cottage');
    expect(mocks.listings).toHaveBeenLastCalledWith({ status: 'PAUSED', q: 'cottage', page: 1 });
  });

  it('pauses a listing with a reason the owner is told', async () => {
    mocks.moderateListing.mockResolvedValue({
      ...live, status: 'PAUSED', actions: ['archive'],
      last_decision: { decision: 'paused', reason: 'Wrong photos.', actor: { id: 'ada', full_name: 'Ada Admin', role: 'admin' }, created_at: '2026-10-06T00:00:00Z' },
    });
    const view = await render(<AdminListings />);

    await click(getByName(view, 'button', 'Pause Sunny house'));
    const dialog = openDialog(view);
    expect(textOf(dialog)).toContain('Its owner is told why, and may publish it again once it is fixed.');
    await dispatch(formIn(dialog), 'submit');
    expect(mocks.moderateListing).not.toHaveBeenCalled();
    await typeInto(field(dialog, 'Reason') as FakeElement, 'Wrong photos.');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.moderateListing).toHaveBeenCalledWith(live, 'pause', 'Wrong photos.');
    expect(textOf(view)).toContain('“Sunny house” was paused. Its owner was told why.');
    expect(textOf(row(view, 'Sunny house'))).toContain('Paused by Ada Admin');
  });

  it('archives a listing, and shows why when the server refuses', async () => {
    mocks.moderateListing.mockRejectedValueOnce(new ApiError(409, 'This listing changed while you were looking at it. Reload the list and try again.'));
    const view = await render(<AdminListings />);

    await click(getByName(view, 'button', 'Archive Old cottage'));
    const dialog = openDialog(view);
    expect(textOf(dialog)).toContain('It leaves search and the owner’s listings for good');
    await typeInto(field(dialog, 'Reason') as FakeElement, 'A scam listing.');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.moderateListing).toHaveBeenCalledWith(paused, 'archive', 'A scam listing.');
    expect(textOf(dialog)).toContain('This listing changed while you were looking at it.');
    expect(mocks.listings).toHaveBeenCalledTimes(2);
  });

  it('says when nothing matches, and offers a retry when the listings cannot load', async () => {
    mocks.listings.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    mocks.listings.mockResolvedValueOnce(pageOf([]));
    const view = await render(<AdminListings />);

    expect(textOf(view)).toContain("Couldn't load the listings");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('No listings found');
  });

  it('keeps the list at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminListings />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
