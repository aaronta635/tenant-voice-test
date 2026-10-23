// Work opportunities for the signed-in provider (backend
// /me/recommendations/provider/opportunities, tracker assumption #19):
// owners and landlords in the areas the provider serves, ranked by that match
// and then by their rating, verification and listings, each with the public
// facts that place them.

import { apiFetch } from './api';

export type OpportunityMatch = 'listing_in_area' | 'based_in_area' | 'state_in_area' | 'same_state';

export type WorkOpportunity = {
  id: string;
  display_name: string;
  role_label: 'Landlord' | 'Agent';
  location: string | null;
  state: string | null;
  verified: boolean;
  rating_avg: number | null;
  review_count: number;
  listing_count: number;
  match: OpportunityMatch;
  reasons: string[];
};

export type WorkOpportunities = {
  items: WorkOpportunity[];
  /** The provider's own suburb and service areas the ranking used, as written. */
  areas: string[];
  generated_at: string;
};

export function workOpportunities(limit = 12): Promise<WorkOpportunities> {
  return apiFetch<WorkOpportunities>('/me/recommendations/provider/opportunities', { query: { limit } });
}

export const MATCH_LABELS: Record<OpportunityMatch, string> = {
  listing_in_area: 'Listings in your areas',
  based_in_area: 'Based in your areas',
  state_in_area: 'In a state you serve',
  same_state: 'In your state',
};

/** "Newtown, Glebe and VIC": the areas as a sentence lists them. */
export function areaList(areas: string[]): string {
  if (areas.length <= 1) return areas.join('');
  return `${areas.slice(0, -1).join(', ')} and ${areas[areas.length - 1]}`;
}
