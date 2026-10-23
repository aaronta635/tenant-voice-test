// Derives the marketplace card/profile view-model from a live PublicProvider
// record. Every value comes from Supabase via the API — nothing is invented.

import type { PublicProvider } from './api';
import { formatMoney } from './format';

/** Placeholder used only when a provider has not uploaded an avatar yet. */
export const PROVIDER_PLACEHOLDER_IMAGE = '/provider-placeholder.svg';

export function providerName(provider: PublicProvider): string {
  return provider.business_name || provider.profiles?.full_name || 'TenantVoice provider';
}

export function providerContactName(provider: PublicProvider): string {
  return provider.profiles?.full_name || providerName(provider);
}

export function providerFirstName(provider: PublicProvider): string {
  return providerContactName(provider).split(' ')[0];
}

export function providerImage(provider: PublicProvider): string {
  return provider.profiles?.avatar_url || PROVIDER_PLACEHOLDER_IMAGE;
}

export function providerLocation(provider: PublicProvider): string {
  const parts = [provider.profiles?.location, provider.profiles?.state].filter(Boolean);
  return parts.join(', ') || 'Australia';
}

/** "$129" / "Free" — the cheapest active service, or a dash when none exist. */
export function providerPriceLabel(provider: PublicProvider): string {
  if (provider.from_price === null || provider.from_price === undefined) return '—';
  if (provider.from_price === 0) return 'Free';
  return formatMoney(provider.from_price);
}

export function providerHref(provider: { id: string; slug: string | null }): string {
  return `/providers/${provider.slug ?? provider.id}`;
}

/**
 * Sign-in link from a provider's booking card, returning to the booking form
 * with the chosen service, time and suburb. Tenants, landlords and providers
 * can all book, so it preselects no account type.
 */
export function bookingSignInHref(pathname: string, booking: URLSearchParams): string {
  return `/login?next=${encodeURIComponent(`${pathname}?${booking}#booking`)}`;
}

export function providerYearsLabel(provider: PublicProvider): string {
  if (provider.years_experience == null) return '—';
  return `${provider.years_experience} year${provider.years_experience === 1 ? '' : 's'}`;
}

/**
 * Filter options for a category listing, derived from the providers that are
 * actually in it — so the sidebar can never offer a filter that matches nothing.
 */
export function deriveCategoryFilters(providers: PublicProvider[]) {
  const serviceTypes = Array.from(new Set(providers.flatMap((p) => p.specialties ?? []))).sort();
  const verificationOptions = Array.from(
    new Set(providers.flatMap((p) => p.verifications)),
  ).sort();
  const availabilityOptions = Array.from(
    new Set(providers.map((p) => p.availability_note).filter((n): n is string => !!n)),
  ).sort();
  const maxPrice = providers.reduce((max, p) => Math.max(max, p.from_price ?? 0), 0);
  const priceCeiling = Math.max(100, Math.ceil((maxPrice * 1.2) / 50) * 50);
  return { serviceTypes, verificationOptions, availabilityOptions, priceCeiling };
}

export function providerServiceAreaLabel(provider: PublicProvider): string {
  if (!provider.service_radius_km) return providerLocation(provider);
  const base = provider.profiles?.location;
  return base
    ? `${provider.service_radius_km}km of ${base}`
    : `${provider.service_radius_km}km radius`;
}

/** Badge claims require review evidence, not arbitrary seeded marketing labels. */
export function providerBadge(provider: PublicProvider): string | null {
  return provider.review_count >= 3 && provider.rating_avg >= 4.5 ? 'Top rated' : null;
}

export function matchesProviderLocation(provider: PublicProvider, query: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const haystack = normalize([provider.profiles?.location, provider.profiles?.state, provider.profiles?.postcode].filter(Boolean).join(' '));
  return normalize(query).split(/\s+/).filter(Boolean).every((part) => haystack.includes(part));
}
