// Tenant scorecards (backend /me/scorecard-requests and /scorecard-requests,
// tracker R43). A tenant asks the owner or agent of a home they rent or
// rented; the owner rates them on the seven items of the Owner/Agent Tenant
// Scorecard from 1 to 5, with an optional comment, or declines. Only the two
// of them read a request, and the tenant chooses whether a completed one
// counts on their public profile.

import { apiFetch } from './api';
import { formatDate } from './format';

export type ScorecardStatus = 'pending' | 'completed' | 'declined' | 'cancelled';

export type ScorecardItemKey =
  | 'paid_rent_on_time'
  | 'looked_after_property'
  | 'communicated_respectfully'
  | 'followed_lease_conditions'
  | 'cooperated_with_inspections'
  | 'left_property_in_good_condition'
  | 'would_rent_again';

/** The scorecard's questions in its order: the keys of docs/shared-db.md ("Scorecards") and the backend's ITEMS. */
export const SCORECARD_ITEMS: { key: ScorecardItemKey; label: string }[] = [
  { key: 'paid_rent_on_time', label: 'Paid rent on time' },
  { key: 'looked_after_property', label: 'Looked after the property' },
  { key: 'communicated_respectfully', label: 'Communicated respectfully' },
  { key: 'followed_lease_conditions', label: 'Followed lease conditions' },
  { key: 'cooperated_with_inspections', label: 'Cooperated with inspections' },
  { key: 'left_property_in_good_condition', label: 'Left property in good condition' },
  { key: 'would_rent_again', label: 'Would you rent to this tenant again?' },
];

export const RATINGS = [1, 2, 3, 4, 5] as const;
export const COMMENT_LENGTH = 1000;
export const REASON_LENGTH = 500;

export type ScorecardAnswers = Record<ScorecardItemKey, number>;

export type ScorecardAnswer = { key: string; label: string; rating: number };

export type ScorecardRequest = {
  id: string;
  status: ScorecardStatus;
  tenant_id: string;
  tenant_name: string;
  owner_id: string;
  owner_name: string;
  /** The home, as both of them know it: its street line, suburb and state. */
  property_id: string;
  property_label: string;
  suburb: string | null;
  state: string | null;
  requested_at: string;
  /** When it was completed, declined or cancelled; null while it waits. */
  decided_at: string | null;
  /** Once completed: every rating in the scorecard's order. */
  answers: ScorecardAnswer[];
  average: number | null;
  comment: string | null;
  /** The owner's reason for declining, when they gave one. */
  reason: string | null;
  /** The tenant's choice to show it on their public profile; null in the owner's view. */
  visible_on_profile: boolean | null;
};

/** Someone the tenant may ask, for one home: the owner of a lease, or the owner or agent of an approved application. */
export type ScorecardRecipient = {
  owner_id: string;
  owner_name: string;
  owner_role_label: string;
  property_id: string;
  property_label: string;
  suburb: string | null;
  state: string | null;
  source: 'agreement' | 'application';
  /** A request to them for this home already waits for their answer. */
  pending_request_id: string | null;
  /** They already completed the scorecard for this home: one tenancy has one. */
  completed_request_id?: string | null;
  /** After a decline or a cancel, when they may be asked about this home again (ISO 8601); null when now. */
  ask_again_from?: string | null;
};

/** Why a recipient cannot be asked now, as the request form says it; null when they can. */
export function recipientHold(recipient: ScorecardRecipient): string | null {
  if (recipient.pending_request_id) return 'Already asked: waiting for their answer';
  if (recipient.completed_request_id) return 'Already completed your scorecard for this home';
  if (recipient.ask_again_from) return `You can ask them again from ${formatDate(recipient.ask_again_from)}`;
  return null;
}

const one = (id: string) => `/scorecard-requests/${encodeURIComponent(id)}`;

export const scorecards = {
  /** A tenant's requests sent, or an owner's received; newest first. */
  list: () => apiFetch<ScorecardRequest[]>('/me/scorecard-requests'),
  recipients: () => apiFetch<ScorecardRecipient[]>('/me/scorecard-requests/recipients'),
  request: (ownerId: string, propertyId: string) =>
    apiFetch<ScorecardRequest>('/me/scorecard-requests', {
      method: 'POST',
      body: { owner_user_id: ownerId, property_id: propertyId },
    }),
  submit: (id: string, answers: ScorecardAnswers, comment: string | null) =>
    apiFetch<ScorecardRequest>(`${one(id)}/submit`, { method: 'POST', body: { answers, comment } }),
  decline: (id: string, reason: string | null) =>
    apiFetch<ScorecardRequest>(`${one(id)}/decline`, { method: 'POST', body: { reason } }),
  cancel: (id: string) => apiFetch<ScorecardRequest>(`${one(id)}/cancel`, { method: 'POST' }),
  setVisible: (id: string, visible: boolean) =>
    apiFetch<ScorecardRequest>(one(id), { method: 'PATCH', body: { visible_on_profile: visible } }),
};

export const SCORECARD_STATUS_LABELS: Record<ScorecardStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

/** Outlined pills on white, as the application stages are (lib/listings). */
export const SCORECARD_STATUS_STYLES: Record<ScorecardStatus, string> = {
  pending: 'border-warning text-warning',
  completed: 'border-primary-strong text-primary-strong',
  declined: 'border-danger text-danger',
  cancelled: 'border-control-border text-text-body',
};

/** "4.6 out of 5", to one decimal as every rating is shown. */
export function formatScorecardAverage(average: number | null | undefined): string {
  if (average === null || average === undefined || Number.isNaN(average)) return 'No rating';
  return `${average.toFixed(1)} out of 5`;
}

const DECIDED_LABELS: Record<ScorecardStatus, string> = {
  pending: '',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

/** "Asked 1 Oct 2026 · Completed 5 Oct 2026": when it was asked, and answered or cancelled. */
export function scorecardDates(item: Pick<ScorecardRequest, 'status' | 'requested_at' | 'decided_at'>): string {
  const asked = `Asked ${formatDate(item.requested_at)}`;
  return item.decided_at && item.status !== 'pending' ? `${asked} · ${DECIDED_LABELS[item.status]} ${formatDate(item.decided_at)}` : asked;
}

/** "1 Harbour Street, Wollongong NSW": the home a request is about. */
export function scorecardHome(item: Pick<ScorecardRequest, 'property_label' | 'suburb' | 'state'>): string {
  const area = [item.suburb, item.state].filter(Boolean).join(' ');
  return area ? `${item.property_label}, ${area}` : item.property_label;
}

/** The items not rated yet, in the scorecard's order. */
export function unratedItems(ratings: Partial<Record<ScorecardItemKey, number>>): ScorecardItemKey[] {
  return SCORECARD_ITEMS.map((item) => item.key).filter((key) => !RATINGS.includes(ratings[key] as (typeof RATINGS)[number]));
}
