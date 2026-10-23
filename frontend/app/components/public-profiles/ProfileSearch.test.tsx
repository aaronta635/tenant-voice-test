import { cleanup, click, descendants, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { PublicProfile, PublicProfilePage } from '@/app/lib/public-profiles';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import ProfileSearch from './ProfileSearch';

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@/app/lib/public-profiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/public-profiles')>()),
  searchPublicProfiles: mocks.search,
}));
/** The page's URL; land() lets the view see a write, as Next does once it commits. */
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory, push: vi.fn() }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: navigation.push, replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => '/search',
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

function profile(id: string, over: Partial<PublicProfile> = {}): PublicProfile {
  return {
    id, role: 'tenant', role_label: 'Tenant', display_name: `Member ${id}`, business_name: null, avatar_url: null,
    areas: ['Newtown'], about: null, verified: false, rating_avg: null, review_count: 0, budget_min: null,
    budget_max: null, move_in_month: null, categories: [], pricing_summary: null, service_area: null, provider_slug: null,
    ...over,
  };
}

function results(count: number, total = count, offset = 0): PublicProfilePage {
  return { items: Array.from({ length: count }, (_, index) => profile(`m${offset + index + 1}`)), total, limit: 12, offset };
}

let leavePage = () => {};
/** A full load of /search with this query. */
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/search${search}`);
  leavePage = navigation.page.install(window);
}

beforeEach(() => {
  vi.clearAllMocks();
  openPage();
  mocks.search.mockResolvedValue(results(0));
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

/** Typing writes the URL 350ms after it pauses. */
async function waitForUrlWrite() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  await settle();
}

async function land() {
  await act(async () => { navigation.page.land(); });
  await settle();
}

const field = (view: FakeElement, label: string) => {
  const input = descendants(view).find((element) => element.tagName === 'INPUT' && element.id === descendants(view)
    .find((candidate) => candidate.tagName === 'LABEL' && textOf(candidate) === label)?.getAttribute('for'));
  if (!input) throw new Error(`No field labelled ${label}`);
  return input;
};
const heading = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'H2') as FakeElement;
const status = (view: FakeElement) => descendants(view).find((element) => element.getAttribute('role') === 'status') as FakeElement;
const lastSearch = () => mocks.search.mock.calls.at(-1)?.[0];

describe('ProfileSearch URL state', () => {
  it('opens the search a link or the homepage put in the URL', async () => {
    openPage('?type=profiles&role=landlord&q=harbour&location=Newtown&page=2');
    mocks.search.mockResolvedValue(results(3, 15, 12));
    const view = await render(<ProfileSearch />);

    expect(lastSearch()).toEqual({ role: 'landlord', q: 'harbour', location: 'Newtown', page: 2 });
    expect(field(view, 'Name or keywords').value).toBe('harbour');
    expect(field(view, 'Location').value).toBe('Newtown');
    expect(getByName(view, 'button', 'Landlords').getAttribute('aria-pressed')).toBe('true');
    expect(getByName(view, 'button', 'All').getAttribute('aria-pressed')).toBe('false');
    expect(textOf(heading(view))).toBe('15 landlords · in Newtown');
    expect(textOf(status(view))).toBe('Showing 13–15 of 15');
  });

  it('pushes a role tab as a new entry and starts again on page one', async () => {
    openPage('?type=profiles&role=all&q=jane&page=3');
    const view = await render(<ProfileSearch />);

    await click(getByName(view, 'button', 'Tenants'));
    expect(navigation.page.stack()).toEqual(['/search?type=profiles&role=all&q=jane&page=3', '>/search?type=profiles&role=tenant&q=jane']);
    await land();

    expect(lastSearch()).toEqual({ role: 'tenant', q: 'jane', location: '', page: 1 });
    expect(getByName(view, 'button', 'Tenants').getAttribute('aria-pressed')).toBe('true');
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('writes typing to the URL once it pauses, replacing the entry', async () => {
    const view = await render(<ProfileSearch />);
    await typeInto(field(view, 'Name or keywords'), 'jo');
    await typeInto(field(view, 'Name or keywords'), 'jon');
    await typeInto(field(view, 'Location'), 'Glebe');
    expect(navigation.page.history.replaceState).not.toHaveBeenCalled();

    await waitForUrlWrite();
    expect(navigation.page.history.replaceState).toHaveBeenCalledTimes(1);
    expect(navigation.page.stack()).toEqual(['>/search?type=profiles&q=jon&location=Glebe']);
    await land();

    expect(lastSearch()).toEqual({ role: 'all', q: 'jon', location: 'Glebe', page: 1 });
    expect(field(view, 'Name or keywords').value).toBe('jon');
  });

  it('takes the text of a search opened from elsewhere, such as Back', async () => {
    openPage('?type=profiles&q=smith');
    const view = await render(<ProfileSearch />);
    await click(getByName(view, 'button', 'Providers'));
    await land();
    await typeInto(field(view, 'Name or keywords'), 'jones');
    await waitForUrlWrite();
    await land();

    await act(async () => { navigation.page.history.back(); navigation.page.land(); });
    await settle();

    expect(field(view, 'Name or keywords').value).toBe('smith');
    expect(lastSearch()).toEqual({ role: 'all', q: 'smith', location: '', page: 1 });
  });

  it('opens other pages through the History API, scrolls up and moves focus to the results', async () => {
    mocks.search.mockResolvedValue(results(12, 30));
    const view = await render(<ProfileSearch />);
    const scrollTo = vi.spyOn(window, 'scrollTo');

    expect(descendants(view).find((element) => element.getAttribute('aria-current') === 'page')?.textContent).toBe('Page 1');
    const next = getByName(view, 'a', 'Next page');
    expect(next.getAttribute('href')).toBe('/search?type=profiles&role=all&page=2');
    mocks.search.mockResolvedValue(results(12, 30, 12));
    await click(next);
    expect(navigation.page.stack()).toEqual(['/search', '>/search?type=profiles&role=all&page=2']);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    await land();

    expect(lastSearch()).toEqual({ role: 'all', q: '', location: '', page: 2 });
    expect(textOf(status(view))).toBe('Showing 13–24 of 30');
    expect(document.activeElement).toBe(heading(view));
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe('ProfileSearch states', () => {
  it('shows a loading state until the profiles arrive', async () => {
    let resolve: (page: PublicProfilePage) => void = () => {};
    mocks.search.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = await render(<ProfileSearch />);

    expect(textOf(status(view))).toBe('Loading profiles…');
    expect(descendants(view).find((element) => element.tagName === 'SECTION')?.getAttribute('aria-busy')).toBe('true');

    await act(async () => { resolve(results(2, 2)); });
    await settle();
    expect(textOf(heading(view))).toBe('2 profiles');
    expect(textOf(status(view))).toBe('Showing 1–2 of 2');
    expect(textOf(view)).toContain('Member m1');
  });

  it('says when nothing matches and clears the search', async () => {
    openPage('?type=profiles&role=tenant&q=zzqx&location=Mars');
    const view = await render(<ProfileSearch />);

    expect(textOf(heading(view))).toBe('0 tenants · in Mars');
    expect(textOf(view)).toContain('No profiles found');
    await click(getByName(view, 'button', 'Clear search'));
    await land();

    expect(navigation.page.stack()).toEqual(['>/search?type=profiles&role=tenant']);
    expect([field(view, 'Name or keywords').value, field(view, 'Location').value]).toEqual(['', '']);
    expect(textOf(view)).toContain('No tenants have a public profile yet.');
  });

  it('says no member has a public profile yet on an empty All tab', async () => {
    const view = await render(<ProfileSearch />);

    expect(textOf(heading(view))).toBe('0 profiles');
    expect(textOf(view)).toContain('No members have a public profile yet.');
    expect(textOf(view)).not.toContain('No profiles have');
  });

  it('shows the error and tries again', async () => {
    mocks.search.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    mocks.search.mockResolvedValueOnce(results(1));
    const view = await render(<ProfileSearch />);

    expect(textOf(view)).toContain("Couldn't load profiles");
    expect(textOf(view)).toContain('The service is temporarily unavailable.');
    await click(getByName(view, 'button', 'Try again'));

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(textOf(view)).toContain('Member m1');
    expect(textOf(view)).not.toContain("Couldn't load profiles");
  });
});
