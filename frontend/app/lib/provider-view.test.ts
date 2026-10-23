import { expect, it } from 'vitest';
import { bookingSignInHref, matchesProviderLocation, providerBadge, providerImage } from './provider-view';
import type { PublicProvider } from './api';
const provider = { profiles: {location:'Newtown',state:'NSW',postcode:'2042',avatar_url:null}, review_count:0, rating_avg:0, badge_label:'Top rated' } as PublicProvider;
it('matches all suggested location forms without punctuation sensitivity', () => {
  for (const query of ['Newtown','Newtown, NSW','Newtown NSW','2042','NSW']) expect(matchesProviderLocation(provider,query)).toBe(true);
  expect(matchesProviderLocation(provider,'2026')).toBe(false);
});
it('does not invent a provider photo or an unsupported rating badge', () => {
  expect(providerImage(provider)).toBe('/provider-placeholder.svg');
  expect(providerBadge(provider)).toBeNull();
  expect(providerBadge({...provider,review_count:3,rating_avg:4.5})).toBe('Top rated');
});
it('signs in to book without presuming the booker is a tenant', () => {
  const href = bookingSignInHref('/providers/harbour-plumbing', new URLSearchParams({ service: 'blocked-drain', slot: '2026-10-22|09:00:00', suburb: 'Newtown' }));
  const url = new URL(href, 'https://tenantvoice.test');
  expect(url.pathname).toBe('/login');
  // Landlords and providers book too; a preselected Tenant tab rejects their sign-in.
  expect(url.searchParams.has('role')).toBe(false);
  expect(url.searchParams.get('next')).toBe('/providers/harbour-plumbing?service=blocked-drain&slot=2026-10-22%7C09%3A00%3A00&suburb=Newtown#booking');
});
