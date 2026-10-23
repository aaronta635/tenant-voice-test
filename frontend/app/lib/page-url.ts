/**
 * Query-string changes to the page that is already open.
 *
 * next 16.2's router cannot change the query of a prerendered page that was
 * loaded with one. After a full load of /dashboard/messages?thread=c1, every
 * router.push or router.replace to /dashboard/messages, and every link to the
 * bare /dashboard/messages, lands on ?thread=c1 again: hydration caches the
 * route under an empty query but records the loaded URL as its address. The
 * History API skips that cache, and Next syncs pushState and replaceState
 * into useSearchParams, so these changes go through it.
 */

type Mode = 'push' | 'replace';

/** The open URL as path, query and hash, the form the writes below use. */
function openUrl() {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

function write(href: string, mode: Mode) {
  if (href === openUrl()) return;
  if (mode === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
}

/** Sets params on the current URL, removing those set to null or ''. Replaces the history entry unless told to push. */
export function setSearchParams(changes: Record<string, string | null>, mode: Mode = 'replace') {
  // The live URL, not a render's useSearchParams, so changes in one tick add up.
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  // Not params.size: Safari 16.4 and Chrome 111-112, inside Next's browser targets, lack it.
  const query = params.toString();
  write(`${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`, mode);
}

/** Opens href through the History API, as the router would, if it is on the current page; says whether it was. */
function pushWithinPage(href: string) {
  const url = new URL(href, window.location.href);
  if (url.pathname !== window.location.pathname) return false;
  const target = `${url.pathname}${url.search}${url.hash}`;
  // Written even when already open: a History API write makes Next drop a
  // navigation it is still loading, so an earlier click cannot land after this.
  // Like next/link, a link to the URL already open leaves the scroll alone.
  if (target === openUrl()) {
    window.history.replaceState(null, '', target);
    return true;
  }
  window.history.pushState(null, '', target);
  // Scrolls as the router does after a push: to the hash target, else the top.
  // After the write, so Back still restores the position left behind.
  const anchor = url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1)));
  if (anchor) anchor.scrollIntoView();
  else window.scrollTo(0, 0);
  return true;
}

/** Opens href as a new history entry: within the current page through the History API, elsewhere through the router. */
export function pushHref(router: { push: (href: string) => void }, href: string) {
  if (!pushWithinPage(href)) router.push(href);
}

/**
 * A Link's onNavigate for links that can point at the open page, such as a
 * sidebar entry or "View all bookings". Clicked there, the link lands on the
 * loaded URL too, so it opens like pushHref; links to other pages are left to
 * the router. Next calls onNavigate only for plain clicks, so a modified or
 * middle click still opens the href in a new tab.
 */
export function navigateWithinPage(href: string) {
  return (event: { preventDefault: () => void }) => {
    if (pushWithinPage(href)) event.preventDefault();
  };
}
