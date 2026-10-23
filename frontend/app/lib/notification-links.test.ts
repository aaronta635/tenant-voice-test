import { describe, expect, it } from 'vitest';
import { MOBILE_ROUTES, NOTIFICATIONS_PAGE, notificationHref, readerRoleOf, type ReaderRole } from './notification-links';

const ROLES: ReaderRole[] = ['tenant', 'landlord', 'service_provider', 'admin'];
const LISTING = 'b2000000-0000-4000-8000-000000000001';

// Every link the mobile app's functions write (output/shared-catalog/functions), and where each reader goes.
const EXPECTED: [string, Partial<Record<ReaderRole, string>>][] = [
  ['/inspections', { tenant: '/tenant/properties', landlord: '/owner/properties' }],
  ['/network', { tenant: '/tenant/network', landlord: '/owner/network', service_provider: '/dashboard/network' }],
  ['/messages', { tenant: '/tenant/messages', landlord: '/owner/messages', service_provider: '/dashboard/messages' }],
  ['/applications', { tenant: '/tenant/applications', landlord: '/owner/applications' }],
  ['/profile', { tenant: '/tenant/my-profile', landlord: '/owner/profile', service_provider: '/dashboard/profile' }],
  ['/documents', {
    tenant: '/tenant/id-verification', landlord: '/owner/profile/verification',
    service_provider: '/dashboard/profile#verification-documents',
  }],
  ['/repairs', { tenant: '/tenant/maintenance', landlord: '/owner/maintenance', service_provider: '/dashboard/repairs' }],
  ['/tenancy', { tenant: '/tenant/dashboard', landlord: '/owner' }],
  ['/owner-workspace', { landlord: '/owner' }],
  ['/admin/maintenance', {
    tenant: '/tenant/maintenance', landlord: '/owner/maintenance', service_provider: '/dashboard/repairs',
  }],
  ['/admin/applications', { tenant: '/tenant/applications', landlord: '/owner/applications' }],
  ['/admin/complaints', {
    tenant: '/tenant/complaints', landlord: '/owner/complaints', service_provider: '/dashboard/complaints',
  }],
  [`/admin/listings/${LISTING}`, {
    tenant: `/tenant/properties/${LISTING}`, landlord: `/owner/properties/${LISTING}`,
    service_provider: `/properties/${LISTING}`, admin: '/admin/reviews',
  }],
  ['/admin/properties', { tenant: '/tenant/properties', landlord: '/owner/properties', admin: '/admin/reviews' }],
  ['/admin/profile', {
    tenant: '/tenant/id-verification', landlord: '/owner/profile/verification',
    service_provider: '/dashboard/profile#verification-documents',
  }],
  ['/admin/red-flags', { admin: '/admin/red-flags' }],
  ['/housing/red-flags', {}],
  [`/matches/property/${LISTING}`, { tenant: `/tenant/properties/${LISTING}` }],
  ['/matches/landlord/c1000000-0000-4000-8000-000000000002', { tenant: '/public/c1000000-0000-4000-8000-000000000002' }],
  ['/documents/lease-ready/agreement-1/doc-2', { tenant: '/tenant/dashboard' }],
  ['/agreements/activated/agreement-1', { tenant: '/tenant/dashboard', landlord: '/owner' }],
  ['/payments/verified/payment-1', { tenant: '/tenant/dashboard', landlord: '/owner' }],
  ['/applications/lease-signed/signature-1', { tenant: '/tenant/applications', landlord: '/owner/applications' }],
];

describe('notificationHref for the mobile app\'s routes', () => {
  it('covers every route in the table, and nothing else', () => {
    const tested = EXPECTED.map(([link]) => Object.keys(MOBILE_ROUTES).find((pattern) => {
      const parts = pattern.split('/');
      const segments = link.split('/');
      return parts.length === segments.length && parts.every((part, index) => part.startsWith(':') || part === segments[index]);
    }));
    expect(new Set(tested)).toEqual(new Set(Object.keys(MOBILE_ROUTES)));
  });

  it.each(EXPECTED)('opens %s at the web page for each reader, else their notifications page', (link, pages) => {
    for (const role of ROLES) {
      expect(notificationHref(link, role), `${link} for ${role}`).toBe(pages[role] ?? NOTIFICATIONS_PAGE[role]);
    }
  });

  it('opens a web match alert, which links as the mobile app does, at the home', () => {
    expect(notificationHref(`/matches/property/${LISTING}`, 'tenant')).toBe(`/tenant/properties/${LISTING}`);
  });

  it('takes only an id where the route has one', () => {
    expect(notificationHref('/admin/listings/<script>', 'tenant')).toBe('/tenant/notifications');
    expect(notificationHref('/matches/property', 'tenant')).toBe('/tenant/notifications');
    expect(notificationHref(`/matches/property/${LISTING}/extra`, 'tenant')).toBe('/tenant/notifications');
  });

  it('reads a route with a query or a trailing slash as the route', () => {
    expect(notificationHref('/messages?thread=t1', 'landlord')).toBe('/owner/messages');
    expect(notificationHref('/network/', 'service_provider')).toBe('/dashboard/network');
  });
});

describe('notificationHref for the web\'s own links', () => {
  it.each([
    ['/tenant/messages?thread=c3000000-0000-4000-8000-000000000001', 'tenant'],
    ['/owner/properties/p1?tab=applications', 'landlord'],
    ['/dashboard/profile#verification-documents', 'service_provider'],
    ['/providers/nina-cleans', 'tenant'],
    [`/properties/${LISTING}`, 'landlord'],
    ['/public/c1000000-0000-4000-8000-000000000002', 'tenant'],
    ['/admin/complaints/k1', 'admin'],
  ] as [string, ReaderRole][])('opens %s as it is', (link, role) => {
    expect(notificationHref(link, role)).toBe(link);
  });

  it('opens nothing for a notice without a link', () => {
    expect(notificationHref(null, 'tenant')).toBeNull();
    expect(notificationHref('', 'landlord')).toBeNull();
    expect(notificationHref('   ', 'service_provider')).toBeNull();
  });

  it.each([
    '/somewhere-new', 'https://example.com/phish', '//evil.example/messages', '/\\evil.example', 'javascript:alert(1)',
    '/admin/users',
  ])('opens an unknown or outside link (%s) at the reader\'s notifications page', (link) => {
    expect(notificationHref(link, 'tenant')).toBe('/tenant/notifications');
  });
});

describe('readerRoleOf', () => {
  it.each([
    ['/tenant/notifications', 'tenant'],
    ['/owner/notifications', 'landlord'],
    ['/dashboard/notifications', 'service_provider'],
    ['/admin', 'admin'],
    ['/properties', null],
    [null, null],
  ] as [string | null, ReaderRole | null][])('reads %s as %s', (pathname, role) => {
    expect(readerRoleOf(pathname)).toBe(role);
  });
});
