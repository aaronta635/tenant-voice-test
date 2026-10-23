// The listing page's view beacon (backend POST /properties/{id}/views, R28).
// The server counts one view per viewer, listing and Sydney day, and keeps
// only a keyed hash of the viewer. A signed-in member counts as their account;
// a signed-out visitor as the random id this browser keeps under VISITOR_KEY,
// which says nothing about them and is sent nowhere else.

import { apiFetch } from './api';

export const VISITOR_KEY = 'tv_visitor';
// What the server accepts as a visitor id (backend schemas/listing_views.py).
const VISITOR_ID = /^[A-Za-z0-9-]{16,64}$/;

// The visitor id of a browser that keeps no storage (a private window): one per page load.
let pageVisitor: string | null = null;
// Listings this page load has counted already: the server would not count them again today.
const sent = new Set<string>();

function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The random id this browser keeps for the views it sends while signed out. */
export function visitorId(): string {
  try {
    const stored = localStorage.getItem(VISITOR_KEY);
    if (stored && VISITOR_ID.test(stored)) return stored;
    const created = randomId();
    localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    pageVisitor ??= randomId();
    return pageVisitor;
  }
}

/** Counts a view of the listing, once per page load. Never throws: a view not counted changes nothing here. */
export async function recordListingView(listingId: string): Promise<void> {
  if (!listingId || sent.has(listingId)) return;
  sent.add(listingId);
  try {
    await apiFetch<{ counted: boolean }>(`/properties/${encodeURIComponent(listingId)}/views`, {
      method: 'POST',
      body: { visitor_id: visitorId() },
    });
  } catch {
    // The listing is not public, or the server could not be reached: nothing to show.
  }
}

/** For tests: forget the listings this page load counted, and its storage-less visitor id. */
export function resetListingViews(): void {
  sent.clear();
  pageVisitor = null;
}
