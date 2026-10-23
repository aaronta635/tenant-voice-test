import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import { navigateWithinPage, pushHref, setSearchParams } from './page-url';

let page: FakeHistory;
/** Each window.scrollTo call, with the URL that was open when it ran. */
let scrolls: string[];
function open(href: string) {
  page = createFakeHistory(href);
  scrolls = [];
  vi.stubGlobal('window', {
    scrollTo: (x: number, y: number) => { scrolls.push(`${x},${y} on ${page.location.pathname}${page.location.search}`); },
  });
  page.install(window);
}
beforeEach(() => open('/'));
afterEach(() => { vi.unstubAllGlobals(); });

describe('setSearchParams', () => {
  it('replaces the current entry, keeping the other params and the hash', () => {
    open('/dashboard/search-profiles?q=smith&role=tenant#results');
    setSearchParams({ q: 'jones' });
    expect(page.history.replaceState).toHaveBeenLastCalledWith(null, '', '/dashboard/search-profiles?q=jones&role=tenant#results');

    setSearchParams({ q: null, role: '' });
    expect(page.stack()).toEqual(['>/dashboard/search-profiles']);
    expect(page.location.hash).toBe('#results');
  });

  it('can push instead, so Back returns to the previous query', () => {
    open('/dashboard/messages?thread=c1');
    setSearchParams({ thread: 'c2' }, 'push');
    expect(page.stack()).toEqual(['/dashboard/messages?thread=c1', '>/dashboard/messages?thread=c2']);
  });

  it('adds up two changes made in the same tick, before the page sees either', () => {
    open('/dashboard/search-profiles');
    setSearchParams({ q: 'jones' });
    setSearchParams({ role: 'landlord' });
    expect(page.location.search).toBe('?q=jones&role=landlord');
  });

  // Safari 16.4-16.6 and Chrome/Edge 111-112, all inside Next 16's default
  // browser targets, have no URLSearchParams.size.
  it('keeps the query on browsers whose URLSearchParams has no size', () => {
    const size = vi.spyOn(URLSearchParams.prototype, 'size', 'get').mockReturnValue(undefined as unknown as number);
    try {
      open('/dashboard/messages?thread=c1');
      setSearchParams({ thread: 'c2' }, 'push');
      expect(page.stack()).toEqual(['/dashboard/messages?thread=c1', '>/dashboard/messages?thread=c2']);
    } finally {
      size.mockRestore();
    }
  });

  it('writes nothing when the URL would not change, so no duplicate entry is pushed', () => {
    open('/dashboard/messages?thread=c1');
    setSearchParams({ thread: 'c1' }, 'push');
    setSearchParams({ role: null });
    expect(page.history.pushState).not.toHaveBeenCalled();
    expect(page.history.replaceState).not.toHaveBeenCalled();
  });
});

describe('pushHref', () => {
  it('stays on the open page through the History API, not the router', () => {
    open('/dashboard/search-profiles?q=smith');
    const router = { push: vi.fn() };
    pushHref(router, '/dashboard/search-profiles?q=brown');
    expect(router.push).not.toHaveBeenCalled();
    expect(page.stack()).toEqual(['/dashboard/search-profiles?q=smith', '>/dashboard/search-profiles?q=brown']);
    expect(scrolls).toEqual(['0,0 on /dashboard/search-profiles?q=brown']);
  });

  it('opens another page through the router', () => {
    open('/dashboard/network');
    const router = { push: vi.fn() };
    pushHref(router, '/dashboard/search-profiles?q=green');
    expect(router.push).toHaveBeenCalledWith('/dashboard/search-profiles?q=green');
    expect(page.history.pushState).not.toHaveBeenCalled();
  });
});

describe('navigateWithinPage', () => {
  const click = () => ({ preventDefault: vi.fn() });

  it('opens a link to the open page through the History API, not the router', () => {
    open('/dashboard/bookings?booking=b1');
    const event = click();
    navigateWithinPage('/dashboard/bookings')(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(page.stack()).toEqual(['/dashboard/bookings?booking=b1', '>/dashboard/bookings']);
  });

  it('leaves a link to another page to the router', () => {
    open('/dashboard/network');
    const event = click();
    navigateWithinPage('/dashboard/bookings')(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(page.history.pushState).not.toHaveBeenCalled();
    expect(scrolls).toEqual([]);
  });

  it('keeps a link to the URL already open from the router, which could reopen the loaded query', () => {
    open('/dashboard/bookings');
    const event = click();
    navigateWithinPage('/dashboard/bookings')(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(page.history.pushState).not.toHaveBeenCalled();
  });

  // Next drops a navigation it is still loading when the History API is
  // written. Click Bookings, then the open Network page's own link before
  // Bookings arrives: the user should stay on Network, as with the router.
  it('still writes the URL already open, so a navigation still loading cannot land after the click', () => {
    open('/dashboard/network');
    navigateWithinPage('/dashboard/network')(click());
    // A null state: Next ignores writes that carry its own.
    expect(page.history.replaceState).toHaveBeenCalledWith(null, '', '/dashboard/network');
    expect(page.stack()).toEqual(['>/dashboard/network']);
    // Like next/link for the URL already open, it keeps the reader's place.
    expect(scrolls).toEqual([]);
  });

  // Next's Link scrolls to the top after a push; pushState alone does not.
  it('scrolls to the top once the new entry is written, so Back keeps the old position', () => {
    open('/dashboard/bookings?booking=b2');
    navigateWithinPage('/dashboard/bookings')(click());
    expect(scrolls).toEqual(['0,0 on /dashboard/bookings']);
  });

  it('scrolls to the hash target instead when the page has it', () => {
    open('/dashboard/bookings?booking=b2');
    const target = { scrollIntoView: vi.fn() };
    vi.stubGlobal('document', { getElementById: (id: string) => (id === 'upcoming' ? target : null) });
    navigateWithinPage('/dashboard/bookings#upcoming')(click());
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(scrolls).toEqual([]);
  });
});
