// The admin console's alerts (backend /admin/alerts, tracker R39, R41):
// unresolved complaints past an alert policy's response time, or repeating
// at a property or an owner, as mobile_admin_alerts lists them. A critical
// one can be referred to the Housing Portal. The server checks on every
// request that the caller is an active admin.

import { apiFetch } from './api';

export type AlertSeverity = 'HIGH' | 'CRITICAL';
export type AlertStatus = 'OPEN' | 'UNDER_REVIEW' | 'ESCALATED';

export type AdminAlert = {
  id: string;
  complaint_id: string | null;
  category_id: string | null;
  /** The alert policy that covered the complaint. */
  category_name: string | null;
  routing_team: string | null;
  severity: AlertSeverity | string;
  status: AlertStatus | string;
  title: string;
  reason: string;
  address: string | null;
  area: string | null;
  days_open: number;
  property_open_complaints: number;
  owner_open_complaints: number;
  photo_count: number;
  documents_verified: boolean;
  created_at: string | null;
  updated_at: string | null;
  escalated_at: string | null;
  escalation_note: string | null;
};

export type Escalation = {
  id: string;
  status: string | null;
  escalated_at: string | null;
  escalation_note: string | null;
  /** The referral package's status: REFERRED at first. */
  housing_portal_status: string | null;
  /** TV-... */
  case_reference: string | null;
};

export const ALERT_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  UNDER_REVIEW: 'Under review',
  ESCALATED: 'Referred',
};

export const adminAlertsApi = {
  list: () => apiFetch<AdminAlert[]>('/admin/alerts'),
  escalate: (id: string, note: string) =>
    apiFetch<Escalation>(`/admin/alerts/${encodeURIComponent(id)}/escalate`, { method: 'POST', body: { note: note.trim() || null } }),
};
