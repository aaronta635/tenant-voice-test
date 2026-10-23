// The admin console's complaints and alert policies (backend
// /admin/complaints and /admin/complaint-categories, R38, R40). The server
// checks on every request that the caller is an active admin. Complaint
// categories are fixed codes; what admins manage are the alert policies
// (mobile_admin_issue_categories) that cover them.

import { apiFetch } from './api';

/** complaints.status, the shared ComplaintStatus an admin sets. */
export type ComplaintStatus = 'OPEN' | 'IN_REVIEW' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** A person a complaint names; role is the web role. */
export type Party = { id: string; full_name: string | null; role: string | null };

export type AdminComplaint = {
  id: string;
  subject: string;
  description: string;
  category: string;
  category_label: string;
  /** False once the category is off the forms, or for one not on the list. */
  category_active: boolean;
  severity: Severity | null;
  status: ComplaintStatus;
  /** Closed by the person who lodged it. */
  withdrawn: boolean;
  lodged_at: string;
  resolved_at: string | null;
  complainant: Party;
  against: Party | null;
  property_id: string | null;
  /** The web's id of the property (its newest listing). */
  listing_id: string | null;
  property_title: string | null;
  assignee: Party | null;
  responded: boolean;
};

export type AdminComplaintPage = { items: AdminComplaint[]; total: number; limit: number; offset: number };

export type AdminComplaintStep = {
  id: string;
  event_type: string | null;
  note: string | null;
  from_status: string | null;
  to_status: string | null;
  actor: Party | null;
  assignee: Party | null;
  /** "web" for a step the web recorded. */
  source: string;
  created_at: string;
};

export type AdminComplaintDetail = AdminComplaint & {
  response: string | null;
  responded_at: string | null;
  resolution_note: string | null;
  evidence_urls: string[];
  /** Oldest first, staff-only steps too. */
  timeline: AdminComplaintStep[];
  /** The statuses this complaint can move to now. */
  transitions: ComplaintStatus[];
  /** tenant_general_complaint for one lodged about a tenancy (the shared review function decides it). */
  source?: string | null;
};

export type Assignee = { id: string; full_name: string; email: string | null };

/** An alert policy's severity, as mobile_admin_save_issue_category takes it. */
export type PolicySeverity = 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL';

/** An alert policy (mobile_admin_issue_categories): which complaints it covers and how fast they need an answer. */
export type IssueCategory = {
  id: string;
  /** Taken from the name when it was created; it never changes. */
  code: string;
  name: string;
  description: string;
  severity: PolicySeverity | null;
  severity_label?: string | null;
  sla_hours: number | null;
  routing_team: string | null;
  /** The complaint category codes it covers. */
  source_categories: string[];
  /** Words in a complaint's description it covers. */
  keywords: string[];
  is_active: boolean;
  /** The version an edit names; the server refuses an edit of another. */
  updated_at: string | null;
  /** The complaints and repairs it covers; only the list counts them. */
  complaint_count: number | null;
};

/** A complaint category code a policy can cover: a general complaint's, a repair's, or both. */
export type CodeChoice = { code: string; label: string; kind: 'general' | 'repair' | 'both' };

export type IssueCategoryList = { categories: IssueCategory[]; codes: CodeChoice[] };

export type CategoryFields = {
  name: string;
  description: string;
  severity: PolicySeverity;
  sla_hours: number;
  routing_team: string;
  source_categories: string[];
  keywords: string[];
};

/** The limits mobile_admin_save_issue_category checks. */
export const POLICY_LIMITS = { nameMin: 3, nameMax: 80, description: 240, teamMin: 3, teamMax: 80, slaMax: 2160 } as const;

export const POLICY_SEVERITY_LABELS: Record<PolicySeverity, string> = {
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
  CRITICAL: 'Critical',
};

export type ComplaintFilters = {
  status: ComplaintStatus | '';
  category: string;
  /** "me", "unassigned" or an admin's id; '' for anyone. */
  assignee: string;
  q: string;
  page: number;
};

export const COMPLAINT_PAGE_SIZE = 20;

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  OPEN: 'Open',
  IN_REVIEW: 'In review',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const STATUS_ACTIONS: Record<ComplaintStatus, string> = {
  OPEN: 'Reopen',
  IN_REVIEW: 'Move to review',
  ESCALATED: 'Escalate',
  RESOLVED: 'Resolve',
  CLOSED: 'Close',
};

/** A move from one status to another as the action an admin takes: back to review from a finished case reopens it. */
export function statusAction(from: ComplaintStatus, to: ComplaintStatus) {
  if (to === 'IN_REVIEW' && (from === 'RESOLVED' || from === 'CLOSED')) return 'Reopen';
  return STATUS_ACTIONS[to];
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

/** The status a complaint shows: a withdrawn one reads as withdrawn, not closed. */
export function complaintStatusLabel(complaint: Pick<AdminComplaint, 'status' | 'withdrawn'>) {
  return complaint.withdrawn ? 'Withdrawn' : COMPLAINT_STATUS_LABELS[complaint.status] ?? complaint.status;
}

/** A step's status in words, whichever vocabulary it was recorded in. */
export function stepStatusLabel(value: string | null) {
  if (!value) return null;
  if (value in COMPLAINT_STATUS_LABELS) return COMPLAINT_STATUS_LABELS[value as ComplaintStatus];
  const words: Record<string, string> = { open: 'Open', under_review: 'Under review', resolved: 'Resolved', dismissed: 'Withdrawn' };
  return words[value] ?? value.replace(/_/g, ' ').toLowerCase();
}

const STATUSES = Object.keys(COMPLAINT_STATUS_LABELS) as ComplaintStatus[];
// A category filter is a code or another app's name for one, such as
// "Noise/Disturbance": any text the API takes (60 characters), which it only
// compares, never puts into a query.
const MAX_CATEGORY = 60;
const ASSIGNEE = /^(me|unassigned|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The complaints page's filters from its URL; anything unknown reads as no filter. */
export function parseComplaintFilters(params: Pick<URLSearchParams, 'get'>): ComplaintFilters {
  const status = params.get('status') ?? '';
  const category = params.get('category') ?? '';
  const assignee = params.get('assignee') ?? '';
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    status: (STATUSES as string[]).includes(status) ? (status as ComplaintStatus) : '',
    category: category.trim() && category.length <= MAX_CATEGORY ? category : '',
    assignee: ASSIGNEE.test(assignee) ? assignee : '',
    q: (params.get('q') ?? '').slice(0, 100),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** The complaints page's URL for these filters; the first page and empty filters stay out of it. */
export function complaintFiltersHref(filters: ComplaintFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.assignee) params.set('assignee', filters.assignee);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return query ? `/admin/complaints?${query}` : '/admin/complaints';
}

/** A list typed as words separated by commas or new lines, each once, in order. */
export function splitWords(text: string): string[] {
  const words: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const word = part.trim().replace(/\s+/g, ' ');
    if (word && !words.includes(word)) words.push(word);
  }
  return words;
}

/** The code the database gives a new policy: "Pest control" becomes pest_control (a suffix follows if it is taken). */
export function codeFromName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9]+/g, '_').toLowerCase().replace(/^_+|_+$/g, '');
}

const complaintPath = (id: string) => `/admin/complaints/${encodeURIComponent(id)}`;
const categoryPath = (id: string) => `/admin/complaint-categories/${encodeURIComponent(id)}`;

export const adminComplaintsApi = {
  list: ({ status, category, assignee, q, page }: ComplaintFilters) =>
    apiFetch<AdminComplaintPage>('/admin/complaints', {
      query: { status, category, assignee, q: q.trim(), limit: COMPLAINT_PAGE_SIZE, offset: (page - 1) * COMPLAINT_PAGE_SIZE },
    }),
  get: (id: string) => apiFetch<AdminComplaintDetail>(complaintPath(id)),
  /** A change of the status the admin saw (409 when it moved since), with the note both parties read. */
  setStatus: (complaint: Pick<AdminComplaint, 'id' | 'status'>, status: ComplaintStatus, note: string) =>
    apiFetch<AdminComplaintDetail>(`${complaintPath(complaint.id)}/status`, {
      method: 'POST', body: { status, note: note.trim(), expected_status: complaint.status },
    }),
  assign: (id: string, assigneeId: string | null, note = '') =>
    apiFetch<AdminComplaintDetail>(`${complaintPath(id)}/assignment`, {
      method: 'POST', body: { assignee_id: assigneeId, note: note.trim() || null },
    }),
  assignees: () => apiFetch<Assignee[]>('/admin/complaints/assignees'),
  categories: () => apiFetch<IssueCategoryList>('/admin/complaint-categories'),
  createCategory: (input: CategoryFields) =>
    apiFetch<IssueCategory>('/admin/complaint-categories', { method: 'POST', body: input }),
  /** An edit of the version the admin opened: 409 when someone changed it since. */
  updateCategory: (category: Pick<IssueCategory, 'id' | 'updated_at'>, changes: Partial<CategoryFields>) =>
    apiFetch<IssueCategory>(categoryPath(category.id), {
      method: 'PATCH', body: { ...changes, expected_updated_at: category.updated_at },
    }),
  setCategoryActive: (id: string, isActive: boolean, reason = '') =>
    apiFetch<IssueCategory>(`${categoryPath(id)}/active`, {
      method: 'POST', body: { is_active: isActive, reason: reason.trim() || null },
    }),
};
