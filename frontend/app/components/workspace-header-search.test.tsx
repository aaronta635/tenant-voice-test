import { cleanup, click, dispatch, getByName, render, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeHistory } from '@/app/test-utils/fake-history';
import OwnerShell from './owner/OwnerShell';
import TenantShell from './tenant/TenantShell';

// ProviderShell.test.tsx covers the provider header; these are the other two workspaces.
const session = vi.hoisted(() => ({ pathname: '/', push: vi.fn(), navigate: vi.fn() }));

vi.mock('next/navigation', () => ({ usePathname: () => session.pathname, useRouter: () => ({ push: session.push }) }));
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => session.navigate(href)),
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    profiles: { me: async () => ({ id: 'me', full_name: 'Sam Sample', role: 'landlord' }) },
    dashboard: { owner: async () => null, ownerBadges: async () => null },
    conversations: { list: async () => [] },
  },
}));

let leavePage = () => {};
beforeEach(() => { session.push = vi.fn(); session.navigate = vi.fn(); });
afterEach(async () => {
  await cleanup();
  leavePage();
});

describe.each([
  { name: 'OwnerShell', Shell: OwnerShell, label: 'Search tenants, providers', searchPage: '/owner/search-profiles', other: '/owner/network' },
  { name: 'TenantShell', Shell: TenantShell, label: 'Search tenants, owners, providers', searchPage: '/tenant/search-profile', other: '/tenant/network' },
])('$name header search', ({ Shell, label, searchPage, other }) => {
  /** Opens `href` in full, then runs a header search for `text`. */
  async function searchFrom(href: string, text: string) {
    const page = createFakeHistory(href);
    leavePage = page.install(window);
    session.pathname = page.location.pathname;
    const view = await render(<Shell><p>Page</p></Shell>);
    const input = getByName(view, 'input', label);
    await typeInto(input, text);
    await dispatch(input.parentElement as FakeElement, 'submit');
    return page;
  }

  // After a full load of a prerendered page with a query, next 16.2's router
  // sends every push to that pathname back to the loaded URL.
  it('searches again on the search page through the History API', async () => {
    const page = await searchFrom(`${searchPage}?q=smith`, 'brown');

    expect(page.stack()).toEqual([`${searchPage}?q=smith`, `>${searchPage}?q=brown`]);
    expect(session.push).not.toHaveBeenCalled();
  });

  it('opens the search page from another page through the router', async () => {
    const page = await searchFrom(other, 'green');

    expect(session.push).toHaveBeenCalledWith(`${searchPage}?q=green`);
    expect(page.history.pushState).not.toHaveBeenCalled();
  });
});

describe.each([
  { name: 'OwnerShell', Shell: OwnerShell, home: '/owner', bookings: '/owner/bookings', messages: '/owner/messages', other: '/owner/network' },
  { name: 'TenantShell', Shell: TenantShell, home: '/tenant/dashboard', bookings: '/tenant/bookings', messages: '/tenant/messages', other: '/tenant/network' },
])('$name links to the open page', ({ Shell, home, bookings, messages, other }) => {
  /** Opens `href` in full, then clicks the shell link named `name`. */
  async function clickFrom(href: string, name: string) {
    const page = createFakeHistory(href);
    leavePage = page.install(window);
    session.pathname = page.location.pathname;
    await click(getByName(await render(<Shell><p>Page</p></Shell>), 'a', name));
    return page;
  }

  // After a full load of a prerendered page with a query, next 16.2's router
  // sends a link to that page's bare path back to the loaded URL.
  it('opens the sidebar link to the open page through the History API', async () => {
    const page = await clickFrom(`${bookings}?booking=b1`, 'Service bookings');

    expect(page.stack()).toEqual([`${bookings}?booking=b1`, `>${bookings}`]);
    expect(session.navigate).not.toHaveBeenCalled();
  });

  it('opens the inbox from the header Messages link while a thread is open', async () => {
    const page = await clickFrom(`${messages}?thread=c1`, 'Messages');

    expect(page.stack()).toEqual([`${messages}?thread=c1`, `>${messages}`]);
    expect(session.navigate).not.toHaveBeenCalled();
  });

  // The middleware's wrong-workspace redirect is a full load of home with a notice in the query.
  it('clears the wrong-workspace notice from the logo link home', async () => {
    const notice = `${home}?notice=wrong-workspace&workspace=Provider&requested=%2Fdashboard`;
    const page = await clickFrom(notice, 'Go to TenantVoice home');

    expect(page.stack()).toEqual([notice, `>${home}`]);
    expect(session.navigate).not.toHaveBeenCalled();
  });

  it('leaves sidebar links to other pages to the router', async () => {
    const page = await clickFrom(other, 'Service bookings');

    expect(session.navigate).toHaveBeenCalledWith(bookings);
    expect(page.history.pushState).not.toHaveBeenCalled();
  });
});
