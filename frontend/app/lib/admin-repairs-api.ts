// The admin console's repairs (backend /admin/repairs, R40): every repair,
// and an admin's decision to cancel or close one with a reason its tenant,
// owner and provider are told. The server checks on every request that the
// caller is an active admin; the parties' repair routes refuse an admin.

import { apiFetch } from './api';
import type { Party } from './admin-complaints-api';

/** The web's repair statuses, as the parties' pages show them. */
export type RepairStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled';
export type RepairPriority = 'low' | 'normal' | 'urgent';
export type RepairAction = 'cancel' | 'close';

export type AdminRepair = {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: RepairPriority;
  status: RepairStatus;
  /** The work order's own status, such as ASSIGNED or SCHEDULED: a decision names it as the one the admin saw. */
  work_status: string;
  property_title: string | null;
  /** The listing's suburb and state. */
  area: string | null;
  tenant: Party | null;
  owner: Party | null;
  provider: Party | null;
  /** The visit the assigned provider booked. */
  appointment_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  /** What an admin may do to it now. */
  actions: RepairAction[];
  last_decision: { decision: string | null; reason: string | null; actor: Party | null; created_at: string } | null;
};

export type RepairPage = { items: AdminRepair[]; total: number; limit: number; offset: number };

export type RepairFilters = { status: RepairStatus | ''; priority: RepairPriority | ''; q: string; page: number };
export const REPAIR_PAGE_SIZE = 20;

export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Done',
  cancelled: 'Cancelled',
};

export const REPAIR_PRIORITY_LABELS: Record<RepairPriority, string> = { low: 'Low', normal: 'Normal', urgent: 'Urgent' };

export const REPAIR_DECISION_LABELS: Record<string, string> = { cancelled: 'Cancelled', closed: 'Closed' };

const STATUSES = Object.keys(REPAIR_STATUS_LABELS) as RepairStatus[];
const PRIORITIES = Object.keys(REPAIR_PRIORITY_LABELS) as RepairPriority[];

function pageOf(params: Pick<URLSearchParams, 'get'>) {
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return Number.isFinite(page) && page > 1 ? page : 1;
}

/** The repairs list's filters from its URL; anything it does not know reads as no filter. */
export function parseRepairFilters(params: Pick<URLSearchParams, 'get'>): RepairFilters {
  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  return {
    status: (STATUSES as string[]).includes(status) ? (status as RepairStatus) : '',
    priority: (PRIORITIES as string[]).includes(priority) ? (priority as RepairPriority) : '',
    q: (params.get('q') ?? '').slice(0, 100),
    page: pageOf(params),
  };
}

export function repairFiltersHref(filters: RepairFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return query ? `/admin/repairs?${query}` : '/admin/repairs';
}

export const adminRepairsApi = {
  list: ({ status, priority, q, page }: RepairFilters) =>
    apiFetch<RepairPage>('/admin/repairs', {
      query: { status, priority, q: q.trim(), limit: REPAIR_PAGE_SIZE, offset: (page - 1) * REPAIR_PAGE_SIZE },
    }),
  /** A decision on the work order status the admin saw (409 when it moved since); the reason is required. */
  decide: (repair: Pick<AdminRepair, 'id' | 'work_status'>, action: RepairAction, reason: string) =>
    apiFetch<AdminRepair>(`/admin/repairs/${encodeURIComponent(repair.id)}/decision`, {
      method: 'POST', body: { action, reason: reason.trim(), expected_status: repair.work_status },
    }),
};
