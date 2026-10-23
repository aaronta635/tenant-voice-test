// Where a notification opens on the website (docs/shared-db.md, "Shared
// settings"). Both apps write the shared notifications table. The web's own
// notices link to web pages; the mobile app's functions link to its routes
// (/messages, /admin/maintenance, /payments/verified/<id>, ...), and a web
// match alert uses the mobile app's /matches/property/<id> so neither app
// sends a match twice. A mobile route opens the web page for the reader's
// role (MOBILE_ROUTES), a web page opens as it is, and anything else opens
// the reader's notifications page.

/** Whose notification it is, by the workspace they read it in. */
export type ReaderRole = 'tenant' | 'landlord' | 'service_provider' | 'admin';

/** Each reader's notifications page: where a link this table cannot place opens. */
export const NOTIFICATIONS_PAGE: Record<ReaderRole, string> = {
  tenant: '/tenant/notifications',
  landlord: '/owner/notifications',
  service_provider: '/dashboard/notifications',
  admin: '/admin',
};

/**
 * The mobile app's routes, as its functions write them into notifications.link
 * (output/shared-catalog/functions), and the web page each opens for the
 * readers it is sent to. `:name` is one id segment, put in the same place of
 * the web page. A role a route has no page for gets its notifications page.
 */
export const MOBILE_ROUTES: Record<string, Partial<Record<ReaderRole, string>>> = {
  // mobile_inspection_notify: an inspection was booked, decided or cancelled.
  '/inspections': { tenant: '/tenant/properties', landlord: '/owner/properties' },
  // mobile_send_connection_request, mobile_respond_connection_request.
  '/network': { tenant: '/tenant/network', landlord: '/owner/network', service_provider: '/dashboard/network' },
  // mobile_start_conversation, mobile_approve_conversation, mobile_contact_support, mobile_ai_provider_job.
  '/messages': { tenant: '/tenant/messages', landlord: '/owner/messages', service_provider: '/dashboard/messages' },
  // owner_assistant_deliver_reminders, mobile_ai_deliver_inbox.
  '/applications': { tenant: '/tenant/applications', landlord: '/owner/applications' },
  // mobile_admin_decide_verification, mobile_admin_update_user_status, mobile_notify_self.
  '/profile': { tenant: '/tenant/my-profile', landlord: '/owner/profile', service_provider: '/dashboard/profile' },
  // mobile_notify_self: a document to add.
  '/documents': {
    tenant: '/tenant/id-verification',
    landlord: '/owner/profile/verification',
    service_provider: '/dashboard/profile#verification-documents',
  },
  // mobile_ai_deliver_inbox: a repair request.
  '/repairs': { tenant: '/tenant/maintenance', landlord: '/owner/maintenance', service_provider: '/dashboard/repairs' },
  // mobile_ai_tenancy_action: a lease shared or signed.
  '/tenancy': { tenant: '/tenant/dashboard', landlord: '/owner' },
  // owner_assistant_deliver_reminders.
  '/owner-workspace': { landlord: '/owner' },
  // assign_ and update_maintenance_work_order, mobile_create_repair, mobile_resolve_repair, ...
  '/admin/maintenance': {
    tenant: '/tenant/maintenance',
    landlord: '/owner/maintenance',
    service_provider: '/dashboard/repairs',
  },
  // submit_ and review_rental_application, mobile_withdraw_application.
  '/admin/applications': { tenant: '/tenant/applications', landlord: '/owner/applications' },
  // create_general_complaint (the landlord), review_general_complaint (who lodged it).
  '/admin/complaints': {
    tenant: '/tenant/complaints',
    landlord: '/owner/complaints',
    service_provider: '/dashboard/complaints',
  },
  // mobile_submit_review (the owner), reply_to_listing_review (the reviewer), mobile_report_review (admins).
  '/admin/listings/:id': {
    tenant: '/tenant/properties/:id',
    landlord: '/owner/properties/:id',
    service_provider: '/properties/:id',
    admin: '/admin/reviews',
  },
  // The same, for a review of a property without a listing.
  '/admin/properties': { tenant: '/tenant/properties', landlord: '/owner/properties', admin: '/admin/reviews' },
  // review_profile_document, review_user_verification, set_maintenance_worker_status.
  '/admin/profile': {
    tenant: '/tenant/id-verification',
    landlord: '/owner/profile/verification',
    service_provider: '/dashboard/profile#verification-documents',
  },
  // evaluate_red_flag_rule_for_property: a new property red flag, on the admin red flags page.
  '/admin/red-flags': { admin: '/admin/red-flags' },
  // mobile_admin_escalate_alert, for housing officers, who have no workspace on the website.
  '/housing/red-flags': {},
  // mobile_notify_matches, and the web's match alerts (services/matching.py).
  '/matches/property/:id': { tenant: '/tenant/properties/:id' },
  '/matches/landlord/:id': { tenant: '/public/:id' },
  // notify_tenant_lease_document_ready.
  '/documents/lease-ready/:agreement/:document': { tenant: '/tenant/dashboard' },
  // notify_tenant_rent_agreement_activated.
  '/agreements/activated/:id': { tenant: '/tenant/dashboard', landlord: '/owner' },
  // notify_verified_rent_payment: the tenant and the owner.
  '/payments/verified/:id': { tenant: '/tenant/dashboard', landlord: '/owner' },
  // notify_owner_of_tenant_lease_signature.
  '/applications/lease-signed/:id': { tenant: '/tenant/applications', landlord: '/owner/applications' },
};

/** The first path segment of every web page a notice may open; /admin only for staff. */
const WEB_ROOTS = new Set([
  'tenant', 'owner', 'dashboard', 'properties', 'providers', 'public', 'categories', 'search', 'faqs',
  'how-it-works', 'contact', 'rental-rights', 'privacy', 'terms',
]);
const ID_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/** The reader's role from the workspace a page is in: /tenant, /owner, /dashboard or /admin. */
export function readerRoleOf(pathname: string | null | undefined): ReaderRole | null {
  const root = (pathname ?? '').split('/')[1];
  if (root === 'tenant') return 'tenant';
  if (root === 'owner') return 'landlord';
  if (root === 'dashboard') return 'service_provider';
  if (root === 'admin') return 'admin';
  return null;
}

/** A local path, never another site: no "//", no backslash or control characters. */
function localPath(link: string): boolean {
  return link.startsWith('/') && !link.startsWith('//') && !/[\\\x00-\x20\x7f]/.test(link);
}

/** The ids a route pattern takes from a path, or null when the path is not that route. */
function matchRoute(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const ids: Record<string, string> = {};
  for (const [index, part] of parts.entries()) {
    const segment = segments[index];
    if (part.startsWith(':')) {
      if (!ID_SEGMENT.test(segment)) return null;
      ids[part.slice(1)] = segment;
    } else if (part !== segment) {
      return null;
    }
  }
  return ids;
}

/**
 * The web page a notification's link opens for its reader, or null when it
 * has no link. A mobile route opens its page for the role, a web page opens
 * as it is, and an unknown link (or a role a route has no page for) opens the
 * reader's notifications page.
 */
export function notificationHref(link: string | null | undefined, role: ReaderRole): string | null {
  const value = (link ?? '').trim();
  if (!value) return null;
  const fallback = NOTIFICATIONS_PAGE[role];
  if (!localPath(value)) return fallback;
  const path = value.split(/[?#]/)[0];
  const segments = path.split('/').filter(Boolean);
  for (const [pattern, pages] of Object.entries(MOBILE_ROUTES)) {
    const ids = matchRoute(pattern, segments);
    if (!ids) continue;
    const page = pages[role];
    return page ? page.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(ids[name])) : fallback;
  }
  const root = segments[0];
  if (root && (WEB_ROOTS.has(root) || (root === 'admin' && role === 'admin'))) return value;
  return fallback;
}
