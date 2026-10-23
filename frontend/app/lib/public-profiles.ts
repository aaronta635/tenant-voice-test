// Public profiles (R22): the tenants, landlords and providers anyone may
// browse before signing in. The API sends only the public fields
// (backend/app/schemas/public_profiles.py), the same signed in or out, so
// these calls never send the visitor's token.

import { apiFetch } from './api';
import { formatMoney } from './format';
import { searchHref, type ProfileRole } from './home-search';

/** The /search role tabs, part of the site's search contract (lib/home-search). */
export type ProfileRoleFilter = ProfileRole;
export type PublicProfileRole = Exclude<ProfileRoleFilter, 'all'>;

export type PublicProfile = {
  id: string;
  role: PublicProfileRole;
  /** "Tenant", "Landlord", "Agent" (listed with landlords) or "Service provider". */
  role_label: string;
  /** Tenants by first name and surname initial; everyone else by full or business name. */
  display_name: string;
  business_name: string | null;
  avatar_url: string | null;
  areas: string[];
  /** One line, already cut short by the API. */
  about: string | null;
  verified: boolean;
  /** From published reviews; null until there is one. */
  rating_avg: number | null;
  review_count: number;
  /** Tenants: weekly budget and move-in month ("2026-11"). */
  budget_min: number | null;
  budget_max: number | null;
  move_in_month: string | null;
  /** Providers. */
  categories: string[];
  pricing_summary: string | null;
  service_area: string | null;
  provider_slug: string | null;
};

export type PublicProfileReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  /** The reviewer by role only, e.g. "Verified tenant". */
  reviewer_label: string;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
  /** Reported, and no moderator has decided yet: it stays up, marked as reported. */
  reported: boolean;
};

/** The owner scorecards a tenant chose to show (R43), as one figure: never who wrote them or what they said. */
export type PublicScorecard = { average: number; count: number };

export type PublicProfileDetail = PublicProfile & {
  reviews: PublicProfileReview[];
  /** Tenants: null while they show no scorecard (or keep their score private). */
  scorecard?: PublicScorecard | null;
};

export type PublicProfilePage = { items: PublicProfile[]; total: number; limit: number; offset: number };

/** A profile search as the /search URL holds it. */
export type ProfileSearch = { role: ProfileRoleFilter; q: string; location: string; page: number };

export const PROFILE_PAGE_SIZE = 12;
export const PROFILE_ROLE_FILTERS: ProfileRoleFilter[] = ['all', 'tenant', 'landlord', 'provider'];

export function searchPublicProfiles(search: ProfileSearch): Promise<PublicProfilePage> {
  return apiFetch<PublicProfilePage>('/public/profiles', {
    auth: false,
    query: {
      role: search.role,
      q: search.q.trim(),
      location: search.location.trim(),
      limit: PROFILE_PAGE_SIZE,
      offset: (search.page - 1) * PROFILE_PAGE_SIZE,
    },
  });
}

export function getPublicProfile(id: string): Promise<PublicProfileDetail> {
  return apiFetch<PublicProfileDetail>(`/public/profiles/${encodeURIComponent(id)}`, { auth: false });
}

// ---------------------------------------------------------------------------
// The URL contract the homepage and /search share (lib/home-search):
//   /search?type=profiles&role=<all|tenant|landlord|provider>&q=<text>
// role defaults to all; /search also keeps a location and a page.
// ---------------------------------------------------------------------------
type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function param(params: Params, key: string): string {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function isRoleFilter(value: string): value is ProfileRoleFilter {
  return (PROFILE_ROLE_FILTERS as string[]).includes(value);
}

export function parseProfileSearch(params: Params): ProfileSearch {
  const role = param(params, 'role');
  const page = Number(param(params, 'page'));
  return {
    role: isRoleFilter(role) ? role : 'all',
    q: param(params, 'q'),
    location: param(params, 'location'),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The URL of a profile search; on page one with no location, searchHref('profiles', q, role) writes the same. */
export function profileSearchHref({ role, q, location, page }: ProfileSearch): string {
  const query = new URLSearchParams({ type: 'profiles', role });
  if (q.trim()) query.set('q', q);
  if (location.trim()) query.set('location', location);
  if (page > 1) query.set('page', String(page));
  return `/search?${query}`;
}

/**
 * Where /search sends the other search types: the pages the homepage search
 * opens for them. Null for a profile search (also the reference site's
 * "renter-profiles" type), which /search shows itself.
 */
export function searchTypeHref(params: Params): string | null {
  const type = param(params, 'type');
  if (type === 'properties' || type === 'services') return searchHref(type, param(params, 'q'));
  return null;
}

/** A provider opens their marketplace page; tenants and landlords their public profile. */
export function publicProfileHref(profile: Pick<PublicProfile, 'id' | 'role' | 'provider_slug'>): string {
  if (profile.role === 'provider') return `/providers/${encodeURIComponent(profile.provider_slug ?? profile.id)}`;
  return `/public/${profile.id}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public profile links carry a member id; anything else is a provider's slug. */
export function isProfileId(value: string): boolean {
  return UUID.test(value);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
/** "$500–$800", "From $500" or "Up to $800"; null when the tenant shared no budget. */
export function budgetLabel(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return min === max ? formatMoney(min) : `${formatMoney(min)}–${formatMoney(max)}`;
  if (min !== null) return `From ${formatMoney(min)}`;
  if (max !== null) return `Up to ${formatMoney(max)}`;
  return null;
}

/** "2026-11" -> "Nov 2026". */
export function moveInLabel(month: string | null): string | null {
  const match = month ? /^(\d{4})-(\d{2})$/.exec(month) : null;
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return date.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "4.6 out of 5 from 2 owner scorecards". */
export function scorecardLabel(scorecard: PublicScorecard): string {
  return `${scorecard.average.toFixed(1)} out of 5 from ${scorecard.count} owner scorecard${scorecard.count === 1 ? '' : 's'}`;
}

/** "4.8 · 12 reviews"; the card shows "No ratings yet" without a published review. */
export function ratingSummary(profile: Pick<PublicProfile, 'rating_avg' | 'review_count'>): string | null {
  if (!profile.review_count || profile.rating_avg === null) return null;
  return `${profile.rating_avg.toFixed(1)} · ${profile.review_count} review${profile.review_count === 1 ? '' : 's'}`;
}
