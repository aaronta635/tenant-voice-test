// The Housing Portal's API (backend /housing, tracker R41). The server checks on
// every request that the caller is an active officer; nothing here decides
// access. The admins' side of the data category requests is /admin/datapoint-requests.

import { apiFetch } from './api';

export type OfficerMe = { id: string; full_name: string; email: string | null };

/** One count of a breakdown: the stored value, how it reads, and how many. */
export type Count = { key: string; label: string; count: number };

export type CategoryStatuses = {
  code: string;
  label: string;
  total: number;
  statuses: Count[];
  median_days_to_resolve: number | null;
};

export type ComplaintSummary = {
  total: number;
  /** Open, in review or escalated. */
  open: number;
  statuses: Count[];
  severities: Count[];
  categories: CategoryStatuses[];
  median_days_to_resolve: number | null;
};

export type ReviewFigures = {
  total: number;
  statuses: Count[];
  /** Published or reported: the reviews profiles and listings show. */
  visible: number;
  property_reviews: number;
  verified: number;
  average_rating: number | null;
  average_landlord_rating: number | null;
  distribution: Count[];
};

export type HousingOverview = {
  complaints: ComplaintSummary;
  reviews: ReviewFigures;
  red_flags: { events: Count[]; open_events: number; alerts: Count[]; open_alerts: number };
  referrals: { total: number; open: number; statuses: Count[] };
};

/** mobile_admin_referral_packages.status, as mobile_housing_update_referral sets it. */
export type PackageStatus = 'REFERRED' | 'UNDER_REVIEW' | 'PACKAGE_READY' | 'CLOSED';
export type ReferralAction = 'START_REVIEW' | 'PREPARE_PACKAGE' | 'CLOSE';

export type Referral = {
  id: string;
  alert_id: string | null;
  complaint_id: string | null;
  case_reference: string | null;
  severity: string | null;
  /** How the portal names it: New, Under review, Package ready, Closed. */
  status: string;
  package_status: PackageStatus | string;
  title: string | null;
  reason: string | null;
  category: string | null;
  area: string | null;
  address: string | null;
  assigned_team: string | null;
  admin_note: string | null;
  regulator_note: string | null;
  referred_at: string | null;
  updated_at: string | null;
  complaint: { description: string | null; category: string | null; severity: string | null; status: string | null; lodged_at: string | null };
  parties: { tenant_name: string | null; owner_name: string | null };
  evidence: {
    trigger_reason: string | null;
    days_open: number | null;
    property_open_complaints: number | null;
    owner_open_complaints: number | null;
    photo_count: number;
    documents_verified: boolean | null;
    work_order_status: string | null;
    events: { type: string | null; note: string | null; created_at: string | null }[];
  };
};

export type ReferralUpdate = { id: string; status: string; package_status: string; regulator_note: string | null; updated_at: string | null };

export type RedFlagEvent = {
  id: string;
  rule: string | null;
  severity: string | null;
  summary: string;
  /** OPEN, ACKNOWLEDGED, RESOLVED or DISMISSED. */
  status: string;
  /** The home's suburb and state, never its street. */
  area: string | null;
  complaint_count: number | null;
  threshold: number | null;
  window_days: number | null;
  details: string | null;
  triggered_at: string | null;
  resolved_at: string | null;
};

export const FLAG_STATUSES = ['New', 'Under review', 'Escalated', 'Closed'] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

export type RegulatoryFlag = {
  id: string;
  severity: string;
  title: string;
  area: string;
  category: string;
  reports: number;
  threshold: number;
  status: FlagStatus;
  raised_at: string | null;
};

export type RedFlags = { events: RedFlagEvent[]; alerts: RegulatoryFlag[] };

export const DATAPOINTS = {
  complaint_categories: 'Complaint categories',
  maintenance_categories: 'Maintenance categories',
  red_flag_rules: 'Red-flag rules',
  review_questions: 'Review questions',
  other: 'Other',
} as const;
export type Datapoint = keyof typeof DATAPOINTS;
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'completed';
export type RequestDecision = Exclude<RequestStatus, 'pending'>;

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Waiting for an admin',
  accepted: 'Accepted',
  declined: 'Declined',
  completed: 'Completed',
};

/** What an admin may answer from each status; declined and completed are final (backend REQUEST_NEXT). */
export const REQUEST_NEXT: Record<RequestStatus, RequestDecision[]> = {
  pending: ['accepted', 'declined', 'completed'],
  accepted: ['completed', 'declined'],
  declined: [],
  completed: [],
};

export type DatapointRequest = {
  id: string;
  officer_id: string | null;
  officer_name: string | null;
  datapoint: Datapoint | string;
  datapoint_label: string;
  requested_change: string;
  reason: string;
  status: RequestStatus;
  admin_response: string | null;
  responded_by_name: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SurveyStatus = 'Draft' | 'Live' | 'Closed';

export type Survey = {
  id: string;
  title: string;
  audience: string;
  status: SurveyStatus;
  responses: number;
  target_responses: number;
  /** Text: an ISO date the web saved, or another app's words ("Not scheduled"). */
  closes_at: string;
  created_at: string | null;
  questions: { id: number; sort_order: number; text: string }[];
  next_status: SurveyStatus | null;
};

export type NewSurvey = {
  title: string;
  audience: string;
  target_responses: number;
  closes_on: string | null;
  questions: string[];
};

export type AggregateCell = {
  area: string;
  state: string;
  category: string;
  category_code: string;
  /** null when suppressed. */
  count: number | null;
  suppressed: boolean;
};

export type Aggregates = { threshold: number; areas: number; suppressed_cells: number; cells: AggregateCell[] };

export const housingApi = {
  me: () => apiFetch<OfficerMe>('/housing/me'),
  overview: () => apiFetch<HousingOverview>('/housing/overview'),
  referrals: () => apiFetch<Referral[]>('/housing/referrals'),
  actOnReferral: (id: string, action: ReferralAction, note: string | null) =>
    apiFetch<ReferralUpdate>(`/housing/referrals/${encodeURIComponent(id)}/actions`, { method: 'POST', body: { action, note } }),
  redFlags: () => apiFetch<RedFlags>('/housing/red-flags'),
  setFlagStatus: (id: string, status: FlagStatus, fromStatus: FlagStatus) =>
    apiFetch<RegulatoryFlag>(`/housing/red-flags/alerts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status, from_status: fromStatus } }),
  complaints: () => apiFetch<ComplaintSummary>('/housing/complaints'),
  datapointRequests: () => apiFetch<DatapointRequest[]>('/housing/datapoint-requests'),
  requestDatapointChange: (body: { datapoint: Datapoint; requested_change: string; reason: string }) =>
    apiFetch<DatapointRequest>('/housing/datapoint-requests', { method: 'POST', body }),
  surveys: () => apiFetch<Survey[]>('/housing/surveys'),
  createSurvey: (body: NewSurvey) => apiFetch<Survey>('/housing/surveys', { method: 'POST', body }),
  setSurveyStatus: (id: string, status: SurveyStatus, fromStatus: SurveyStatus) =>
    apiFetch<Survey>(`/housing/surveys/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status, from_status: fromStatus } }),
  aggregates: () => apiFetch<Aggregates>('/housing/aggregates'),
};

/** The admins' side of the officers' data category requests. */
export const adminDatapointApi = {
  list: () => apiFetch<DatapointRequest[]>('/admin/datapoint-requests'),
  answer: (id: string, status: RequestDecision, response: string, fromStatus: RequestStatus) =>
    apiFetch<DatapointRequest>(`/admin/datapoint-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status, response, from_status: fromStatus } }),
};

/** The actions an officer is offered for a referral in each status; the database takes any of them. */
export function referralActions(status: string): { action: ReferralAction; label: string }[] {
  switch (status) {
    case 'REFERRED':
      return [{ action: 'START_REVIEW', label: 'Start review' }, { action: 'CLOSE', label: 'Close' }];
    case 'UNDER_REVIEW':
      return [{ action: 'PREPARE_PACKAGE', label: 'Mark package ready' }, { action: 'CLOSE', label: 'Close' }];
    case 'PACKAGE_READY':
      return [{ action: 'START_REVIEW', label: 'Back to review' }, { action: 'CLOSE', label: 'Close' }];
    default:
      return [{ action: 'START_REVIEW', label: 'Reopen review' }];
  }
}
