import { cleanup, click, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeHistory } from '@/app/test-utils/fake-history';
import ProviderShell from './ProviderShell';

const session = vi.hoisted(() => ({
  pathname: '/dashboard/network', profileId: 'provider-user', push: vi.fn(), navigate: vi.fn(),
  standing: 'approved' as string | Error,
}));

vi.mock('next/navigation', () => ({ usePathname: () => session.pathname, useRouter: () => ({ push: session.push }) }));
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => session.navigate(href)),
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    profiles: { me: async () => ({ id: session.profileId, full_name: 'Harbour Plumbing' }) },
    providers: { mine: async () => ({ id: 'provider-1', slug: 'harbour-plumbing', business_name: 'Harbour Plumbing', is_published: true }) },
    conversations: { list: async () => [{ unread_count: 2 }] },
    notifications: { list: async () => [{ id: 'n1' }] },
    connections: { list: async () => [{ direction: 'incoming' }] },
    account: {
      standing: async () => {
        if (session.standing instanceof Error) throw session.standing;
        return { state: session.standing };
      },
    },
  },
}));

beforeEach(() => {
  session.pathname = '/dashboard/network';
  session.profileId = 'provider-user';
  session.standing = 'approved';
  // The shell only asks whether the viewport is desktop width.
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(cleanup);

const shell = () => render(<ProviderShell><p>Page</p></ProviderShell>);

describe('ProviderShell header', () => {
  it('keeps the unread notifications dot visible in forced-colors mode, where its fill is removed', async () => {
    const [dot] = getByName(await shell(), 'a', 'Notifications (1 unread)').querySelectorAll('span');

    expect(dot.className.split(' ')).toEqual(expect.arrayContaining(['bg-[#de3b40]', 'forced-colors:bg-[Highlight]']));
  });

  it('shows the unread message count at AA contrast', async () => {
    const messages = getByName(await shell(), 'a', 'Messages (2 unread)');

    expect(textOf(messages)).toBe('2');
    expect(lowContrastText(messages)).toEqual([]);
  });
});

describe('ProviderShell navigation', () => {
  it('shows the current page and its badge at AA contrast', async () => {
    const network = getByName(await shell(), 'a', 'Network1');

    expect(network.getAttribute('aria-current')).toBe('page');
    expect(lowContrastText(network)).toEqual([]);
  });

  it('shows a badge on another page at AA contrast', async () => {
    session.pathname = '/dashboard';
    const network = getByName(await shell(), 'a', 'Network1');

    expect(network.hasAttribute('aria-current')).toBe(false);
    expect(lowContrastText(network)).toEqual([]);
  });

  it('leads to the repairs owners assigned, and marks that page as current there', async () => {
    session.pathname = '/dashboard/repairs';
    const repairs = getByName(await shell(), 'a', 'Assigned repairs');

    expect(repairs.getAttribute('href')).toBe('/dashboard/repairs');
    expect(repairs.getAttribute('aria-current')).toBe('page');
    expect(lowContrastText(repairs)).toEqual([]);
  });

  it('labels the demo workspace at AA contrast', async () => {
    session.profileId = 'a0000000-0000-4000-8000-000000000001';
    const view = await shell();

    expect(textOf(view)).toContain('Sample business, bookings, reviews and earnings');
    expect(lowContrastText(view)).toEqual([]);
  });
});

describe('ProviderShell account standing', () => {
  const banners = (view: FakeElement) => view.querySelectorAll('section').filter((section) => section.getAttribute('aria-labelledby') === 'account-standing-title');

  it('tells a suspended provider on every workspace page what they can still do', async () => {
    session.standing = 'suspended';
    for (const pathname of ['/dashboard', '/dashboard/bookings', '/dashboard/messages']) {
      session.pathname = pathname;
      const view = await shell();

      const [banner] = banners(view);
      expect(textOf(getByName(banner, 'p', 'Your account is suspended'))).toBe('Your account is suspended');
      expect(getByName(banner, 'a', 'Contact TenantVoice support').getAttribute('href')).toBe('/contact');
      expect(lowContrastText(view)).toEqual([]);
      await cleanup();
    }
  });

  it('says nothing to a provider in good standing, or while the standing cannot be read', async () => {
    expect(banners(await shell())).toEqual([]);
    await cleanup();

    session.standing = new Error('Could not connect');
    const view = await shell();
    expect(banners(view)).toEqual([]);
    // The rest of the header still loads.
    expect(textOf(view)).toContain('Harbour Plumbing');
  });

  it('leaves the public pages the shell also wraps alone', async () => {
    session.standing = 'suspended';
    session.pathname = '/providers';

    expect(banners(await shell())).toEqual([]);
  });
});

describe('ProviderShell header search', () => {
  let leavePage = () => {};
  beforeEach(() => { session.push = vi.fn(); });
  afterEach(async () => {
    await cleanup();
    leavePage();
  });

  /** Opens `href` in full, then runs a header search for `text`. */
  async function searchFrom(href: string, text: string) {
    const page = createFakeHistory(href);
    leavePage = page.install(window);
    session.pathname = page.location.pathname;
    const view = await shell();
    const input = getByName(view, 'input', 'Search landlords, tenants');
    await typeInto(input, text);
    await dispatch(input.parentElement as FakeElement, 'submit');
    return page;
  }

  // After a full load of a prerendered page with a query, next 16.2's router
  // sends every push to that pathname back to the loaded URL.
  it('searches again on the search page through the History API', async () => {
    const page = await searchFrom('/dashboard/search-profiles?q=smith', 'brown');

    expect(page.stack()).toEqual(['/dashboard/search-profiles?q=smith', '>/dashboard/search-profiles?q=brown']);
    expect(session.push).not.toHaveBeenCalled();
  });

  it('opens the search page from another page through the router', async () => {
    const page = await searchFrom('/dashboard/network', 'green');

    expect(session.push).toHaveBeenCalledWith('/dashboard/search-profiles?q=green');
    expect(page.history.pushState).not.toHaveBeenCalled();
  });
});

describe('ProviderShell links to the open page', () => {
  let leavePage = () => {};
  beforeEach(() => { session.navigate = vi.fn(); });
  afterEach(async () => {
    await cleanup();
    leavePage();
  });

  /** Opens `href` in full, then clicks the shell link named `name`. */
  async function clickFrom(href: string, name: string) {
    const page = createFakeHistory(href);
    leavePage = page.install(window);
    session.pathname = page.location.pathname;
    await click(getByName(await shell(), 'a', name));
    return page;
  }

  // After a full load of a prerendered page with a query, next 16.2's router
  // sends a link to that page's bare path back to the loaded URL.
  it('opens the sidebar link to the open page through the History API', async () => {
    const page = await clickFrom('/dashboard/bookings?booking=b1', 'Bookings');

    expect(page.stack()).toEqual(['/dashboard/bookings?booking=b1', '>/dashboard/bookings']);
    expect(session.navigate).not.toHaveBeenCalled();
  });

  it('opens the inbox from the header Messages link while a thread is open', async () => {
    const page = await clickFrom('/dashboard/messages?thread=c1', 'Messages (2 unread)');

    expect(page.stack()).toEqual(['/dashboard/messages?thread=c1', '>/dashboard/messages']);
    expect(session.navigate).not.toHaveBeenCalled();
  });

  it('leaves sidebar links to other pages to the router', async () => {
    const page = await clickFrom('/dashboard/network', 'Bookings');

    expect(session.navigate).toHaveBeenCalledWith('/dashboard/bookings');
    expect(page.history.pushState).not.toHaveBeenCalled();
  });

  // The middleware's wrong-workspace redirect is a full load of the Overview
  // with a notice in the query. The layout's per-request render also covers
  // this today; the logo must not depend on it.
  it('clears the wrong-workspace notice from the logo link home', async () => {
    const notice = '/dashboard?notice=wrong-workspace&workspace=Owner&requested=%2Fowner';
    const page = await clickFrom(notice, 'Go to TenantVoice home');

    expect(page.stack()).toEqual([notice, '>/dashboard']);
    expect(session.navigate).not.toHaveBeenCalled();
  });
});
