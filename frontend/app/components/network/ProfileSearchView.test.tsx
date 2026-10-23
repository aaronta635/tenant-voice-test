import { cleanup, click, descendants, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionState, MemberSearchResult } from '@/app/lib/connections';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import ProfileSearchView from './ProfileSearchView';

const mockApi = vi.hoisted(() => ({
  connections: { request: vi.fn(), respond: vi.fn(), remove: vi.fn() },
  conversations: { startRental: vi.fn() },
}));
const members = vi.hoisted(() => ({ search: vi.fn(), state: vi.fn() }));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('@/app/lib/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/connections')>()),
  searchMembers: members.search,
  getConnectionState: members.state,
}));
/** The page's URL; navigate() changes it under a mounted view, as Next does. */
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory, push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
    usePathname: () => '/dashboard/search-profiles',
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

let leavePage = () => {};
/** A full load of the search page with this query. */
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/dashboard/search-profiles${search}`);
  leavePage = navigation.page.install(window);
}

beforeEach(() => {
  vi.clearAllMocks();
  openPage();
  members.search.mockResolvedValue([]);
});

/** A search result as /profiles/search sends it. */
function member(id: string, full_name: string, connection: Partial<ConnectionState> = {}, over: Partial<MemberSearchResult> = {}): MemberSearchResult {
  return {
    id, full_name, role: 'landlord', avatar_url: null, location: 'Parramatta', state: 'NSW', connection_status: null,
    rating_avg: null, review_count: 0, verified: false,
    connection: { user_id: id, state: 'none', connection_id: null, ...connection }, ...over,
  };
}
afterEach(async () => {
  await cleanup();
  leavePage();
});

/** The search is debounced by 350ms before it calls the API. */
async function waitForSearch() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  await settle();
}

/** A navigation from elsewhere, such as the header search: Next pushes it and the view sees it. */
async function navigate(search: string) {
  await act(async () => { navigation.page.navigate(`/dashboard/search-profiles?${search}`); });
  await settle();
}

/** Lets the view see the URL it last wrote, as Next does once its history sync commits. */
async function land() {
  await act(async () => { navigation.page.land(); });
  await settle();
}

function lastReplace() {
  return navigation.page.history.replaceState.mock.calls.at(-1)?.[2];
}

function searchBox(view: FakeElement) {
  return descendants(view).find((element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === 'Search names or areas') as FakeElement;
}

function lastSearch() {
  return members.search.mock.calls.at(-1)?.[0];
}

describe('ProfileSearchView connections', () => {
  it("offers each person what their profile's Connect button offers, from the state the search sends", async () => {
    members.search.mockResolvedValue([
      member('lena', 'Lena Landlord', { state: 'declined', connection_id: 'r1' }, { connection_status: 'declined' }),
      member('dana', 'Dana Decliner', { state: 'none', connection_id: 'r2' }, { connection_status: 'declined' }),
      member('jon', 'Jon Doe', { state: 'received', connection_id: 'r3' }, { connection_status: 'pending' }),
      member('ava', 'Ava Agent', { state: 'connected', connection_id: 'r4' }, { connection_status: 'accepted' }),
    ]);
    const view = await render(<ProfileSearchView messagesHref="/dashboard/messages" />);
    await waitForSearch();

    // Lena declined this viewer's request, so only she can ask again; the viewer declined Dana and can.
    expect(textOf(view)).toContain('Lena Landlord declined your request.');
    expect(getByName(view, 'button', 'Connect with Dana Decliner')).toBeTruthy();
    expect(getByName(view, 'button', "Accept Jon Doe's request")).toBeTruthy();
    expect(getByName(view, 'button', 'Message Ava Agent')).toBeTruthy();
    expect(members.state).not.toHaveBeenCalled();  // no read per card
  });

  it('sends a request from a card', async () => {
    members.search.mockResolvedValue([member('mei', 'Mei Lin')]);
    mockApi.connections.request.mockResolvedValue({ id: 'r9' });
    const view = await render(<ProfileSearchView messagesHref="/dashboard/messages" />);
    await waitForSearch();

    await click(getByName(view, 'button', 'Connect with Mei Lin'));

    expect(mockApi.connections.request).toHaveBeenCalledWith('mei');
    expect(textOf(view)).toContain('Pending: request sent');
    expect(getByName(view, 'button', 'Withdraw your request to Mei Lin')).toBeTruthy();
  });

  it('opens a conversation with a connection', async () => {
    members.search.mockResolvedValue([member('ava', 'Ava Agent', { state: 'connected', connection_id: 'r4' })]);
    mockApi.conversations.startRental.mockResolvedValue({ id: 'thread-1' });
    const view = await render(<ProfileSearchView messagesHref="/dashboard/messages" />);
    await waitForSearch();

    await click(getByName(view, 'button', 'Message Ava Agent'));

    expect(mockApi.conversations.startRental).toHaveBeenCalledWith({ peer_id: 'ava', subject: 'Chat with Ava Agent' });
    expect(navigation.push).toHaveBeenCalledWith('/dashboard/messages?thread=thread-1');
  });
});

describe('ProfileSearchView badges', () => {
  // These lists used to send no rating, so a rating seen on a card was gone here.
  it("shows the rating and verified seal each person's profile shows", async () => {
    members.search.mockResolvedValue([
      member('lena', 'Lena Landlord', {}, { rating_avg: 4.5, review_count: 2, verified: true }),
      member('mei', 'Mei Lin', {}, { role: 'tenant' }),
    ]);
    const view = await render(<ProfileSearchView messagesHref="/dashboard/messages" />);
    await waitForSearch();
    // A card is the element around its name row.
    const card = (name: string) => getByName(view, 'h2', name).parentElement?.parentElement as FakeElement;
    const [lena, mei] = [card('Lena Landlord'), card('Mei Lin')];

    expect(textOf(lena)).toContain('Rated 4.5 out of 5 from 2 reviews');
    expect(descendants(lena).some((element) => element.getAttribute('aria-label') === 'Verified by TenantVoice')).toBe(true);
    expect(textOf(mei)).toContain('No ratings yet');
    expect(descendants(mei).some((element) => element.getAttribute('role') === 'img')).toBe(false);
  });
});

describe('ProfileSearchView header search', () => {
  it('adopts a header search that repeats an earlier query after the box was edited', async () => {
    openPage('?q=smith');
    const view = await render(<ProfileSearchView messagesHref="/dashboard/messages" />);
    await waitForSearch();
    expect(lastSearch()).toEqual({ search: 'smith', role: undefined });

    await typeInto(searchBox(view), 'jones');
    await waitForSearch();
    expect(lastReplace()).toBe('/dashboard/search-profiles?q=jones');
    await land();

    await navigate('q=smith');
    expect(searchBox(view).value).toBe('smith');
    await waitForSearch();
    expect(lastSearch()).toEqual({ search: 'smith', role: undefined });
    expect(navigation.page.history.replaceState).toHaveBeenCalledTimes(1);
  });

  it('keeps typing that continues while its own URL update lands', async () => {
    const view = await render(<ProfileSearchView messagesHref="/dashboard/messages" />);
    await typeInto(searchBox(view), 'jo');
    await waitForSearch();
    await typeInto(searchBox(view), 'jon');
    await land();

    expect(searchBox(view).value).toBe('jon');
    await waitForSearch();
    expect(lastReplace()).toBe('/dashboard/search-profiles?q=jon');
  });

  it('resets to an empty search and adopts the next header search', async () => {
    openPage('?q=smith&role=tenant');
    const view = await render(<ProfileSearchView messagesHref="/dashboard/messages" />);
    await click(getByName(view, 'button', 'Reset'));
    expect(searchBox(view).value).toBe('');
    await land();
    expect(navigation.page.location.search).toBe('');

    await navigate('q=smith');
    expect(searchBox(view).value).toBe('smith');
  });
});

describe('ProfileSearchView URL', () => {
  // After a full load of a prerendered page with a query, next 16.2's router
  // sends every push or replace to that pathname back to the loaded URL.
  it('writes typing and Reset through the History API, never the router', async () => {
    openPage('?q=smith&role=landlord');
    const view = await render(<ProfileSearchView messagesHref="/dashboard/messages" />);
    await typeInto(searchBox(view), 'jones');
    await waitForSearch();
    await land();
    expect(navigation.page.stack()).toEqual(['>/dashboard/search-profiles?q=jones&role=landlord']);
    await waitForSearch();
    expect(lastSearch()).toEqual({ search: 'jones', role: 'landlord' });

    await click(getByName(view, 'button', 'Reset'));
    await land();
    expect(navigation.page.stack()).toEqual(['>/dashboard/search-profiles']);
    expect(searchBox(view).value).toBe('');
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
