// A tenant's matches (R34): the homes and landlords the server matched to the
// tenant's saved preferences, with the facts behind each match
// (backend/app/services/matching.py). The page filters nothing itself: a home
// that fails one of the tenant's musts never arrives.

import { apiFetch } from './api';
import type { VerificationRequiredDetail } from './verification-gate';

/** The preferences a tenant can make a must; the others only rank a home lower. */
export type EssentialFilter = 'budget' | 'location' | 'pets' | 'bedrooms' | 'move_in';
export const ESSENTIAL_FILTERS: { key: EssentialFilter; label: string }[] = [
  { key: 'budget', label: 'Weekly budget' },
  { key: 'location', label: 'Suburbs' },
  { key: 'pets', label: 'Pets' },
  { key: 'bedrooms', label: 'Bedrooms' },
  { key: 'move_in', label: 'Move-in date' },
];

/** Where a tenant edits the preferences matching reads. */
export const PREFERENCES_HREF = '/tenant/rental-preferences';

export type MatchFilter = {
  key: EssentialFilter;
  /** A must (the tenant's mark, or the default: every filter is a must until marked otherwise). */
  essential: boolean;
  /** The tenant saved a value for it; without one it leaves nothing out. */
  active: boolean;
  /** The saved value in words, such as "Up to $650 a week". */
  summary: string | null;
};

export type MatchListing = {
  id: string;
  title: string;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  property_type: string | null;
  price: number;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  pet_friendly: boolean;
  available_from: string | null;
  photo_url: string | null;
  published_at: string | null;
};

export type MatchLevel = 'strong' | 'good' | 'fair';

export type PropertyMatch = {
  listing: MatchListing;
  /** 0-100: the share of the preferences and trust signals the home meets. */
  score: number;
  match_level: MatchLevel;
  /** Facts that fit, best first. */
  reasons: string[];
  /** The nice-to-haves it misses. */
  unmet: string[];
  /** The owner's badges; null when their profile is out of the public lists. */
  landlord: { id: string; verified: boolean; rating_avg: number | null; review_count: number } | null;
};

/** verification_required: the model is the paid AI, which needs a verified account (tracker R18). */
export type MatchAiStatus = 'not_configured' | 'ready' | 'applied' | 'unavailable' | 'cooldown' | 'verification_required';

export type PropertyMatches = {
  items: PropertyMatch[];
  filters: MatchFilter[];
  has_preferences: boolean;
  /** Published listings looked at, and how many each must left out. */
  considered: number;
  excluded: Partial<Record<EssentialFilter, number>>;
  excluded_total: number;
  source: 'rules' | 'ai';
  ai_status: MatchAiStatus;
  message: string | null;
  /** Why the model was not asked (ai_status verification_required); read it with refusalOf. */
  verification?: VerificationRequiredDetail | null;
  generated_at: string;
  cached: boolean;
};

export type LandlordMatch = {
  id: string;
  display_name: string;
  role_label: string;
  avatar_url: string | null;
  areas: string[];
  verified: boolean;
  rating_avg: number | null;
  review_count: number;
  listing_count: number;
  listings: { id: string; title: string; suburb: string | null; price: number }[];
  score: number;
  reasons: string[];
};

export type LandlordMatches = { items: LandlordMatch[]; has_preferences: boolean; generated_at: string };

export const MATCH_LEVEL_LABELS: Record<MatchLevel, string> = {
  strong: 'Strong match',
  good: 'Good match',
  fair: 'Fair match',
};

export function getPropertyMatches(): Promise<PropertyMatches> {
  return apiFetch<PropertyMatches>('/me/matches/properties');
}

/** Asks the model to re-order the matches; the rule order comes back whenever it cannot. */
export function refinePropertyMatches(): Promise<PropertyMatches> {
  return apiFetch<PropertyMatches>('/me/matches/properties/refine', { method: 'POST' });
}

export function getLandlordMatches(): Promise<LandlordMatches> {
  return apiFetch<LandlordMatches>('/me/matches/landlords');
}

/** Saves which filters are musts; answers the matches they leave. */
export function saveMatchEssentials(essentials: EssentialFilter[]): Promise<PropertyMatches> {
  return apiFetch<PropertyMatches>('/me/matches/essentials', { method: 'PUT', body: { essentials } });
}
