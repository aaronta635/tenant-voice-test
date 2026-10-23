// The admin console's red flags (backend /admin/red-flags, tracker R39).
// The database raises a flag when a rule's count of complaints about one
// property is reached; admins manage the rules here and decide the flags.
// The server checks on every request that the caller is an active admin.

import { apiFetch } from './api';

export type TriggerMode = 'TOTAL' | 'WINDOW';
export type FlagSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FlagStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';
export type FlagAction = 'acknowledge' | 'resolve' | 'dismiss';

export type RedFlagRule = {
  id: string;
  /** Unique, from the name when the rule was created; it never changes. */
  rule_key: string;
  name: string;
  description: string;
  threshold_count: number;
  trigger_mode: TriggerMode;
  window_days: number;
  severity: FlagSeverity;
  is_active: boolean;
  created_at: string | null;
  /** The version an edit names. */
  updated_at: string | null;
  /** Its open or acknowledged flags, and every flag it raised. */
  active_flags: number;
  total_flags: number;
};

export type RuleFields = {
  name: string;
  description: string;
  threshold_count: number;
  trigger_mode: TriggerMode;
  window_days: number;
  severity: FlagSeverity;
};

export type FlagDecision = {
  action: string | null;
  from_status: string | null;
  to_status: string | null;
  actor_id: string | null;
  actor_name: string | null;
  note: string | null;
  at: string | null;
};

/** What the database recorded when it raised the flag. */
export type FlagEvidence = {
  details?: string;
  complaintCount?: number;
  thresholdCount?: number;
  triggerMode?: TriggerMode;
  windowDays?: number | null;
  windowStart?: string | null;
  evaluatedAt?: string;
  [key: string]: unknown;
};

export type RedFlagEvent = {
  id: string;
  rule_id: string;
  rule_name: string | null;
  summary: string;
  status: FlagStatus;
  triggered_at: string;
  resolved_at: string | null;
  property_id: string | null;
  address: string | null;
  /** The property's newest listing. */
  listing_id: string | null;
  property_title: string | null;
  complaint: { id: string; category_label: string; status: string | null; lodged_at: string | null } | null;
  evidence: FlagEvidence;
  /** Oldest first. */
  decisions: FlagDecision[];
  /** What an admin may do with it now. */
  actions: FlagAction[];
};

export type RedFlagEventPage = { items: RedFlagEvent[]; total: number; limit: number; offset: number };

/** The table's checks. */
export const RULE_LIMITS = { thresholdMax: 10000, windowMax: 3650 } as const;
export const FLAG_PAGE_SIZE = 50;

export const FLAG_STATUS_LABELS: Record<FlagStatus, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};

export const FLAG_ACTION_LABELS: Record<FlagAction, string> = {
  acknowledge: 'Acknowledge',
  resolve: 'Resolve',
  dismiss: 'Dismiss',
};

export const FLAG_SEVERITY_LABELS: Record<FlagSeverity, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

/** "3 complaints about one property within 30 days", or "in total". */
export function ruleSummary(rule: Pick<RedFlagRule, 'threshold_count' | 'trigger_mode' | 'window_days'>) {
  const count = `${rule.threshold_count} ${rule.threshold_count === 1 ? 'complaint' : 'complaints'} about one property`;
  return rule.trigger_mode === 'TOTAL'
    ? `${count} in total`
    : `${count} within ${rule.window_days} ${rule.window_days === 1 ? 'day' : 'days'}`;
}

const rulePath = (id: string) => `/admin/red-flags/rules/${encodeURIComponent(id)}`;

export const redFlagsApi = {
  rules: () => apiFetch<RedFlagRule[]>('/admin/red-flags/rules'),
  createRule: (fields: RuleFields) => apiFetch<RedFlagRule>('/admin/red-flags/rules', { method: 'POST', body: fields }),
  /** An edit of the version the admin opened: 409 when someone changed it since. */
  updateRule: (rule: Pick<RedFlagRule, 'id' | 'updated_at'>, changes: Partial<RuleFields>) =>
    apiFetch<RedFlagRule>(rulePath(rule.id), { method: 'PATCH', body: { ...changes, expected_updated_at: rule.updated_at } }),
  setRuleActive: (id: string, isActive: boolean, reason = '') =>
    apiFetch<RedFlagRule>(`${rulePath(id)}/active`, { method: 'POST', body: { is_active: isActive, reason: reason.trim() || null } }),
  /** Only a rule that never raised a flag: 409 otherwise. */
  deleteRule: (id: string) => apiFetch<void>(rulePath(id), { method: 'DELETE' }),
  /** Runs the rule over every property now; how many flags it opened. */
  evaluate: (id: string) =>
    apiFetch<{ rule_id: string; created: number; evaluated_at: string }>(`${rulePath(id)}/evaluate`, { method: 'POST' }),
  events: (status: FlagStatus | '', page = 1) =>
    apiFetch<RedFlagEventPage>('/admin/red-flags/events', {
      query: { status, limit: FLAG_PAGE_SIZE, offset: (page - 1) * FLAG_PAGE_SIZE },
    }),
  /** A decision on the status the admin saw (409 when it moved since), with the note kept beside the evidence. */
  decide: (event: Pick<RedFlagEvent, 'id' | 'status'>, action: FlagAction, note = '') =>
    apiFetch<RedFlagEvent>(`/admin/red-flags/events/${encodeURIComponent(event.id)}/${action}`, {
      method: 'POST', body: { note: note.trim() || null, expected_status: event.status },
    }),
};
