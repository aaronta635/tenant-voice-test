// The admin console's oversight (backend /admin/activity and /admin/analytics,
// R40): the audit logs, and counts over time. The server checks on every
// request that the caller is an active admin.

import { apiFetch } from './api';
import type { Party } from './admin-complaints-api';

/** admin: the shared admin log (decisions from both apps); web: the web's requests and events. */
export type ActivityLog = 'admin' | 'web';

export type ActivityEntry = {
  id: string;
  log: ActivityLog;
  actor: Party | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
};

export type ActivityPage = { log: ActivityLog; items: ActivityEntry[]; total: number; limit: number; offset: number };

export type AnalyticsRange = 30 | 90 | 365;

export type Analytics = {
  days: AnalyticsRange;
  granularity: 'day' | 'week' | 'month';
  start: string;
  end: string;
  /** The first day of each period, oldest first (Sydney's calendar). */
  periods: string[];
  series: { key: string; label: string; counts: number[]; total: number }[];
  totals: { users: number; listings: number; applications: number; complaints: number; reviews: number };
  complaints_by_category: { code: string; label: string; count: number }[];
  complaints_by_status: { status: string; label: string; count: number }[];
  reviews_by_status: { status: string; label: string; count: number }[];
};

export type ActivityFilters = {
  log: ActivityLog;
  actor: string;
  action: string;
  entity: string;
  /** Calendar days (YYYY-MM-DD) in Sydney, inclusive. */
  from: string;
  to: string;
  page: number;
};

export const ACTIVITY_PAGE_SIZE = 25;

export const ACTIVITY_LOG_LABELS: Record<ActivityLog, string> = { admin: 'Admin decisions', web: 'Web activity' };

/** The kinds of row the logs name, for the filter; others still show. */
export const ENTITY_LABELS: Record<string, string> = {
  user: 'Accounts',
  profile_document: 'Documents',
  review: 'Reviews',
  listing: 'Listings',
  property: 'Properties',
  complaint: 'Complaints',
  issue_category: 'Complaint categories',
  repair: 'Repairs',
};

/** One row of each kind, as a log entry names it. */
export const ENTITY_NOUNS: Record<string, string> = {
  user: 'Account',
  profile_document: 'Document',
  review: 'Review',
  listing: 'Listing',
  property: 'Property',
  complaint: 'Complaint',
  issue_category: 'Complaint category',
  repair: 'Repair',
};

export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  30: 'Last 30 days',
  90: 'Last 90 days',
  365: 'Last 12 months',
};

const LOGS = Object.keys(ACTIVITY_LOG_LABELS) as ActivityLog[];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function pageOf(params: Pick<URLSearchParams, 'get'>) {
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return Number.isFinite(page) && page > 1 ? page : 1;
}

export function parseActivityFilters(params: Pick<URLSearchParams, 'get'>): ActivityFilters {
  const log = params.get('log') ?? '';
  const day = (name: string) => {
    const value = params.get(name) ?? '';
    return DAY.test(value) ? value : '';
  };
  return {
    log: (LOGS as string[]).includes(log) ? (log as ActivityLog) : 'admin',
    actor: (params.get('actor') ?? '').slice(0, 100),
    action: (params.get('action') ?? '').slice(0, 80),
    entity: /^[a-z_]{1,40}$/.test(params.get('entity') ?? '') ? params.get('entity')! : '',
    from: day('from'),
    to: day('to'),
    page: pageOf(params),
  };
}

export function activityFiltersHref(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  if (filters.log !== 'admin') params.set('log', filters.log);
  for (const key of ['actor', 'action', 'entity', 'from', 'to'] as const) {
    if (filters[key].trim()) params.set(key, filters[key].trim());
  }
  if (filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return query ? `/admin/activity?${query}` : '/admin/activity';
}

export function parseAnalyticsRange(params: Pick<URLSearchParams, 'get'>): AnalyticsRange {
  const days = Number(params.get('days'));
  return days === 90 || days === 365 ? days : 30;
}

export function analyticsHref(days: AnalyticsRange): string {
  return days === 30 ? '/admin/analytics' : `/admin/analytics?days=${days}`;
}

export const adminActivityApi = {
  activity: ({ log, actor, action, entity, from, to, page }: ActivityFilters) =>
    apiFetch<ActivityPage>('/admin/activity', {
      query: {
        log, actor: actor.trim(), action: action.trim(), entity_type: entity, from, to,
        limit: ACTIVITY_PAGE_SIZE, offset: (page - 1) * ACTIVITY_PAGE_SIZE,
      },
    }),
  analytics: (days: AnalyticsRange) => apiFetch<Analytics>('/admin/analytics', { query: { days } }),
};
