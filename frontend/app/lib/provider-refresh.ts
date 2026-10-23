// Keeps the provider workspace header (name, setup links and badges) current
// without re-fetching data that rarely changes: every backend call also
// verifies the session with Supabase Auth, so polling is not free.

/** How often the header re-checks its unread and pending counts while the tab is visible. */
export const COUNTS_POLL_MS = 30_000;

/** Pages fire this after saving the profile or provider, so the header shows the change. */
export const ACCOUNT_CHANGED_EVENT = 'tenantvoice:account-changed';

/** Pages fire this after an action that changes a header count. */
export const COUNTS_CHANGED_EVENT = 'tenantvoice:counts-changed';

export function announceAccountChange() {
  window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
}

type Refresher = { request: () => void; requestAfterChange: () => void; stop: () => void };

/**
 * Runs `load` one call at a time. `request` is dropped while a call is in
 * flight, so a burst of triggers (returning to a tab fires both focus and
 * visibilitychange) costs one call. `requestAfterChange` queues one more call
 * instead, so a change made while a call was in flight is still picked up.
 */
function createRefresher(load: () => Promise<unknown>): Refresher {
  let inFlight = false;
  let queued = false;
  let stopped = false;
  async function run() {
    inFlight = true;
    do {
      queued = false;
      try { await load(); } catch { /* A failed refresh keeps the values already shown. */ }
    } while (queued && !stopped);
    inFlight = false;
  }
  return {
    request: () => { if (!inFlight && !stopped) void run(); },
    requestAfterChange: () => { if (stopped) return; if (inFlight) queued = true; else void run(); },
    stop: () => { stopped = true; },
  };
}

type Page = { window: EventTarget; document: EventTarget & { readonly visibilityState: DocumentVisibilityState } };

/**
 * Loads the profile and provider once, then again only after a page saves
 * them, or when the tab comes back into view (another tab may have saved).
 * Returns a function that stops watching.
 */
export function watchAccount({ window: win, document: doc, load }: Page & { load: () => Promise<unknown> }): () => void {
  const account = createRefresher(load);
  const changed = () => account.requestAfterChange();
  const shown = () => { if (doc.visibilityState === 'visible') account.request(); };
  account.request();
  win.addEventListener(ACCOUNT_CHANGED_EVENT, changed);
  doc.addEventListener('visibilitychange', shown);
  return () => {
    account.stop();
    win.removeEventListener(ACCOUNT_CHANGED_EVENT, changed);
    doc.removeEventListener('visibilitychange', shown);
  };
}

/**
 * Polls the header counts while the tab is visible, on the inbox too: the
 * inbox's own polling refreshes its thread list, not the header badge.
 * Returns a function that stops polling.
 */
export function watchCounts({ window: win, document: doc, loadMessageCount, loadOtherCounts }: Page & {
  loadMessageCount: () => Promise<unknown>;
  loadOtherCounts: () => Promise<unknown>;
}): () => void {
  const messages = createRefresher(loadMessageCount);
  const others = createRefresher(loadOtherCounts);
  const poll = () => {
    if (doc.visibilityState !== 'visible') return;
    others.request();
    messages.request();
  };
  const changed = () => { others.requestAfterChange(); messages.requestAfterChange(); };
  poll();
  const timer = setInterval(poll, COUNTS_POLL_MS);
  win.addEventListener('focus', poll);
  doc.addEventListener('visibilitychange', poll);
  win.addEventListener(COUNTS_CHANGED_EVENT, changed);
  return () => {
    clearInterval(timer);
    messages.stop();
    others.stop();
    win.removeEventListener('focus', poll);
    doc.removeEventListener('visibilitychange', poll);
    win.removeEventListener(COUNTS_CHANGED_EVENT, changed);
  };
}
