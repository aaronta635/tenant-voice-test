import type { ProviderRecommendationFilters, RecommendationChatMessage, RecommendationCriteria } from './api';

export type ChatService = { id: string; title: string };

export const EMPTY_CRITERIA: RecommendationCriteria = { role: null, location: null, service_ids: [], new_only: false };
/** Matches the API: each message at most 600 characters, at most 20 messages. */
export const CHAT_MESSAGE_LIMIT = 600;
const CHAT_HISTORY_LIMIT = 20;

export const ASSISTANT_GREETING =
  'Tell me who you would like to reach, for example "landlords in Parramatta for my rental appraisals". '
  + 'I will ask if anything is missing, then you confirm before I search.';

/** The most recent messages the chat endpoint accepts. */
export function chatHistory(messages: RecommendationChatMessage[]): RecommendationChatMessage[] {
  return messages.slice(-CHAT_HISTORY_LIMIT);
}

/** Role and area are required before a search; services and new-only are optional. */
export function criteriaReady(criteria: RecommendationCriteria): boolean {
  return criteria.role !== null && criteria.location !== null;
}

export function missingCriteria(criteria: RecommendationCriteria): string[] {
  return [criteria.role === null ? 'who to reach' : null, criteria.location === null ? 'an area' : null]
    .filter((item): item is string => item !== null);
}

export function criteriaToFilters(criteria: RecommendationCriteria): ProviderRecommendationFilters {
  return {
    role: criteria.role === 'tenant' || criteria.role === 'landlord' ? criteria.role : undefined,
    location: criteria.location?.trim() || undefined,
    service_ids: criteria.service_ids.length ? [...criteria.service_ids] : undefined,
    new_only: criteria.new_only || undefined,
    limit: 12,
  };
}

/** e.g. "landlords in Newtown for Rental appraisal" — used in headings and status text. */
export function describeSearch(criteria: RecommendationCriteria, services: ChatService[]): string {
  const who = criteria.role === 'landlord' ? 'landlords' : criteria.role === 'tenant' ? 'tenants' : 'landlords and tenants';
  const area = criteria.location?.trim();
  const where = area ? ` in ${area}` : criteria.location === '' ? ' in any area' : '';
  const titles = criteria.service_ids
    .map(id => services.find(service => service.id === id)?.title)
    .filter((title): title is string => !!title);
  const focus = titles.length ? ` for ${titles.join(', ')}` : '';
  const scope = criteria.new_only ? ' you are not connected with yet' : '';
  return `${who}${scope}${where}${focus}`;
}

/** Keep only selections that are still among the provider's services. */
export function keepKnownServices(criteria: RecommendationCriteria, services: ChatService[]): RecommendationCriteria {
  const known = new Set(services.map(service => service.id));
  const serviceIds = criteria.service_ids.filter(id => known.has(id));
  return serviceIds.length === criteria.service_ids.length ? criteria : { ...criteria, service_ids: serviceIds };
}
