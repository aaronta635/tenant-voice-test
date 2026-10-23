// The admin console's API (backend /admin, R16, R17). The server checks on
// every request that the caller is an active admin; nothing here decides access.

import { apiFetch } from './api';
import type { AccountVerification, DocumentLink, DocumentRequirement, ProfileDocument } from './profile-documents';

export type AccountStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
/** The statuses an admin sets. */
export type SettableStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type AdminRoleFilter = 'tenant' | 'landlord' | 'service_provider' | 'admin' | 'officer';

export type AdminMe = { id: string; full_name: string; email: string | null };

export type RoleCount = {
  role: string;
  total: number;
  active: number;
  pending_verification: number;
  suspended: number;
  deactivated: number;
};

export type AdminOverview = {
  users_total: number;
  closed_accounts: number;
  roles: RoleCount[];
  pending_documents: number;
  pending_document_people: number;
};

export type AdminUser = {
  id: string;
  full_name: string;
  email: string | null;
  /** The web role (tenant, landlord, service_provider, admin, officer). */
  role: string;
  primary_role: string | null;
  status: AccountStatus;
  verification_status: string | null;
  created_at: string | null;
  pending_documents: number;
};

export type AdminUserPage = { items: AdminUser[]; total: number; limit: number; offset: number };

export type StatusChange = {
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
};

/** Whether the verification gates let a provider take new work, or why not (backend gates.Standing, R18). */
export type ProviderStanding = 'approved' | 'pending' | 'rejected' | 'unknown' | 'suspended' | 'inactive';

/** A provider account on the marketplace (AdminProviderOut). */
export type AdminProvider = {
  has_profile: boolean;
  /** The provider made their profile live. */
  published: boolean;
  /** The marketplace shows them now: live, with an active account. */
  listed: boolean;
  standing: ProviderStanding;
  /** Confirmed bookings from today on (or not dated yet). */
  upcoming_bookings: number;
  jobs_in_progress: number;
};

export type AdminUserDetail = AdminUser & {
  phone: string | null;
  updated_at: string | null;
  closed_at: string | null;
  roles: { role: string; is_primary: boolean }[];
  documents: ProfileDocument[];
  verification: AccountVerification;
  status_history: StatusChange[];
  /** Why this admin may not change the status; null when they may. */
  status_locked: string | null;
  /** A provider's marketplace state and open jobs; null for anyone else. */
  provider?: AdminProvider | null;
  /** On a status change's answer: how many people that change sent a notice to. */
  notified?: number | null;
};

export const ADMIN_PAGE_SIZE = 25;

/** The verification queue's role tabs: the roles the shared verification functions review (no agents). */
export type QueueRole = 'tenant' | 'landlord' | 'provider';
/** profile_documents.review_status: what the queue lists. */
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type Decision = 'APPROVED' | 'REJECTED';

export type ReviewDocument = ProfileDocument & {
  /** The version a decision names; the server refuses a decision made on another. */
  updated_at: string;
  /** Opens the file for `expires_in` seconds from when the queue loaded; null without a file to open. */
  link: DocumentLink | null;
};

/** A document the mobile app keeps for an account (users.metadata.mobile.verificationDocuments): shown, never decided. */
export type MobileVerificationDocument = {
  key: string;
  name: string;
  mime_type: string | null;
  /** As the mobile app saved it. */
  uploaded_at: string | null;
  has_file: boolean;
  /** Opens the file for `expires_in` seconds from when the queue loaded; null without a file here to open. */
  link: DocumentLink | null;
};

/** One account in the queue, with its documents in the status asked for. */
export type VerificationItem = {
  user_id: string;
  full_name: string;
  email: string | null;
  role: string;
  primary_role: string | null;
  account: AccountVerification;
  requirements: DocumentRequirement[];
  /** Whether the account can be approved now: it is in review (a provider also needs a service area and categories). */
  can_approve: boolean;
  /** Why it can't be approved, where that helps. */
  approval_note?: string | null;
  documents: ReviewDocument[];
  /** The mobile app's documents of an account not yet approved. */
  mobile_documents?: MobileVerificationDocument[];
};

export type VerificationQueue = {
  role: QueueRole;
  status: ReviewStatus;
  items: VerificationItem[];
  total: number;
  limit: number;
  offset: number;
  /** Accounts with documents in this status, per tab. */
  counts: Record<QueueRole, number>;
  /** The mobile app's documents could not be read this time. */
  mobile_unavailable?: boolean;
};

export type DocumentDecision = { document: ReviewDocument; account: AccountVerification };

export const VERIFICATION_PAGE_SIZE = 20;

export type VerificationFilters = { role: QueueRole; status: ReviewStatus; page: number };

export type AdminUserFilters = { role: AdminRoleFilter | ''; status: AccountStatus | ''; q: string; page: number };

const userPath = (id: string) => `/admin/users/${encodeURIComponent(id)}`;

export const adminApi = {
  me: () => apiFetch<AdminMe>('/admin/me'),
  overview: () => apiFetch<AdminOverview>('/admin/overview'),
  users: ({ role, status, q, page }: AdminUserFilters) =>
    apiFetch<AdminUserPage>('/admin/users', {
      query: { role, status, q: q.trim(), limit: ADMIN_PAGE_SIZE, offset: (page - 1) * ADMIN_PAGE_SIZE },
    }),
  user: (id: string) => apiFetch<AdminUserDetail>(userPath(id)),
  setStatus: (id: string, status: SettableStatus, reason: string) =>
    apiFetch<AdminUserDetail>(`${userPath(id)}/status`, { method: 'POST', body: { status, reason: reason.trim() || null } }),
  documentLink: (id: string) => apiFetch<DocumentLink>(`/admin/documents/${encodeURIComponent(id)}/link`),
  verification: ({ role, status, page }: VerificationFilters) =>
    apiFetch<VerificationQueue>('/admin/verification', {
      query: { role, status, limit: VERIFICATION_PAGE_SIZE, offset: (page - 1) * VERIFICATION_PAGE_SIZE },
    }),
  verificationItem: (userId: string, status: ReviewStatus) =>
    apiFetch<VerificationItem>(`/admin/verification/${encodeURIComponent(userId)}`, { query: { status } }),
  /** A decision on the version of the document the admin saw: 409 when it changed since. */
  decideDocument: (document: Pick<ReviewDocument, 'id' | 'updated_at'>, decision: Decision, reason = '') =>
    apiFetch<DocumentDecision>(`/admin/documents/${encodeURIComponent(document.id)}/decision`, {
      method: 'POST',
      body: { decision, reason: reason.trim() || null, expected_updated_at: document.updated_at },
    }),
  /** Approve or reject an account in review (409 once it is decided); a rejection needs a reason. */
  decideAccount: (userId: string, decision: Decision, reason = '') =>
    apiFetch<AdminUserDetail>(`${userPath(userId)}/verification`, { method: 'POST', body: { decision, reason: reason.trim() || null } }),
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  ACTIVE: 'Active',
  PENDING_VERIFICATION: 'Pending verification',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
};

export const ROLE_FILTER_LABELS: Record<AdminRoleFilter, string> = {
  tenant: 'Tenants',
  landlord: 'Landlords',
  service_provider: 'Providers',
  admin: 'Admins',
  officer: 'Officers',
};

export const ROLE_LABELS: Record<string, string> = {
  tenant: 'Tenant',
  landlord: 'Landlord',
  service_provider: 'Service provider',
  admin: 'Admin',
  officer: 'Officer',
};

export const QUEUE_ROLE_LABELS: Record<QueueRole, string> = {
  tenant: 'Tenants',
  landlord: 'Landlords',
  provider: 'Providers',
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

/** The queue tab an account of this web role is listed in; none for staff. */
export function queueRoleOf(role: string): QueueRole | null {
  if (role === 'tenant' || role === 'landlord') return role;
  return role === 'service_provider' ? 'provider' : null;
}

const ROLE_FILTERS = Object.keys(ROLE_FILTER_LABELS) as AdminRoleFilter[];
const QUEUE_ROLES = Object.keys(QUEUE_ROLE_LABELS) as QueueRole[];
const REVIEW_STATUSES = Object.keys(REVIEW_STATUS_LABELS) as ReviewStatus[];
const STATUSES = Object.keys(ACCOUNT_STATUS_LABELS) as AccountStatus[];

/** The users page's filters from its URL; anything unknown reads as no filter. */
export function parseUserFilters(params: Pick<URLSearchParams, 'get'>): AdminUserFilters {
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    role: (ROLE_FILTERS as string[]).includes(role) ? (role as AdminRoleFilter) : '',
    status: (STATUSES as string[]).includes(status) ? (status as AccountStatus) : '',
    q: (params.get('q') ?? '').slice(0, 100),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** The users page's URL for these filters; the first page and empty filters stay out of it. */
export function userFiltersHref(filters: AdminUserFilters): string {
  const params = new URLSearchParams();
  if (filters.role) params.set('role', filters.role);
  if (filters.status) params.set('status', filters.status);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return query ? `/admin/users?${query}` : '/admin/users';
}

/** The verification page's tab, status and page from its URL: tenants in review, first page, unless it says otherwise. */
export function parseVerificationFilters(params: Pick<URLSearchParams, 'get'>): VerificationFilters {
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    role: (QUEUE_ROLES as string[]).includes(role) ? (role as QueueRole) : 'tenant',
    status: (REVIEW_STATUSES as string[]).includes(status) ? (status as ReviewStatus) : 'PENDING',
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** The verification page's URL for these filters; the defaults stay out of it. */
export function verificationHref(filters: VerificationFilters): string {
  const params = new URLSearchParams();
  if (filters.role !== 'tenant') params.set('role', filters.role);
  if (filters.status !== 'PENDING') params.set('status', filters.status);
  if (filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return query ? `/admin/verification?${query}` : '/admin/verification';
}
