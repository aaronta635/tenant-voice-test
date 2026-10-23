import type { Metadata } from 'next';
import { connection } from 'next/server';

export const metadata: Metadata = { title: { absolute: 'Overview · TenantVoice' } };

// The provider workspace renders per request, not from prerendered HTML.
// next 16.2 caches a prerendered page's route under the empty query it was
// built with, but with the loaded URL as its address: after a full load of
// /dashboard/messages?thread=c1, a "Message" button elsewhere that pushed
// ?thread=c3 opened c1 instead. A request-time render carries the real
// query. next 16.3.0 fixes the cache (vercel/next.js#94144); drop this then.
// Cost: these pages are sent with Cache-Control: no-store, so Chrome's
// back/forward cache no longer restores them on Back from another site,
// losing unsent drafts and filters. Narrower: connection() only in the
// messages, bookings, search-profiles, finances layouts and client-bookings.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await connection();
  return children;
}
