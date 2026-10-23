// The admin console's moderation (backend /admin/reviews and /admin/listings,
// R40). The server checks on every request that the caller is an active admin.

import { apiFetch } from './api';
import type { Party } from './admin-complaints-api';

/** reviews.status */
export type ReviewStatus = 'PUBLISHED' | 'HIDDEN' | 'FLAGGED' | 'ARCHIVED';
export type ReviewView = 'reported' | 'hidden';
export type ReviewAction = 'hide' | 'restore';

/** A report mobile_report_review kept, from either app. */
export type ReviewReport = {
  id: string;
  reporter: Party | null;
  /** spam, misleading, offensive, hate, privacy or other. */
  reason: string | null;
  details: string | null;
  /** Waiting for a decision; false once one closed it. */
  open: boolean;
  created_at: string | null;
};

/** A property review's details, for admins: the private eviction answer included. */
export type ModeratedReviewDetails = {
  pros: string | null;
  cons: string | null;
  advice_to_owner: string | null;
  would_recommend: boolean | null;
  issues_disclosed: boolean | null;
  maintenance_or_eviction_issue: boolean | null;
  reported_issues: string[];
};

export type ModerationDecision = {
  id: string;
  /** hidden, restored or kept. */
  decision: string | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  actor: Party | null;
  created_at: string;
};

export type ModeratedReview = {
  id: string;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string | null;
  reply: string | null;
  is_verified_interaction: boolean;
  created_at: string | null;
  reviewer: Party | null;
  reviewed: Party | null;
  property_id: string | null;
  listing_id: string | null;
  property_title: string | null;
  /** Reports made since the last decision. */
  open_reports: number;
  /** Newest first, kept after every decision. */
  reports: ReviewReport[];
  decisions: ModerationDecision[];
  /** A property review's category scores, by code (lib/property-reviews REVIEW_CATEGORIES). */
  ratings: Record<string, number>;
  details: ModeratedReviewDetails | null;
  photo_count: number;
  /** Links that expire after expires_in seconds; the queue signs new ones on each load. */
  photos: { url: string; expires_in: number }[];
};

export type ReviewQueue = {
  view: ReviewView;
  items: ModeratedReview[];
  total: number;
  limit: number;
  offset: number;
  counts: Record<ReviewView, number>;
};

/** listings.status */
export type ListingStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'APPLICATIONS_CLOSED' | 'LEASED' | 'ARCHIVED';
export type ListingAction = 'pause' | 'archive';

export type ModeratedListing = {
  id: string;
  title: string;
  status: ListingStatus;
  weekly_rent: number;
  address: string;
  suburb: string | null;
  created_at: string | null;
  published_at: string | null;
  owner: Party | null;
  manager: Party | null;
  /** What an admin may do to it now. */
  actions: ListingAction[];
  last_decision: { decision: string | null; reason: string | null; actor: Party | null; created_at: string } | null;
};

export type ListingPage = { items: ModeratedListing[]; total: number; limit: number; offset: number };

export type ReviewFilters = { view: ReviewView; page: number };
export type ListingFilters = { status: ListingStatus | ''; q: string; page: number };
export const REVIEW_PAGE_SIZE = 20;
export const LISTING_PAGE_SIZE = 20;

export const REVIEW_VIEW_LABELS: Record<ReviewView, string> = { reported: 'Reported', hidden: 'Hidden' };

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  PUBLISHED: 'Published',
  FLAGGED: 'Reported',
  HIDDEN: 'Hidden',
  ARCHIVED: 'Archived',
};

export const DECISION_LABELS: Record<string, string> = {
  hidden: 'Hidden',
  restored: 'Restored',
  kept: 'Kept published',
  paused: 'Paused',
  archived: 'Archived',
};

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  PAUSED: 'Paused',
  APPLICATIONS_CLOSED: 'Applications closed',
  LEASED: 'Leased',
  ARCHIVED: 'Archived',
};

const VIEWS = Object.keys(REVIEW_VIEW_LABELS) as ReviewView[];
const LISTING_STATUSES = Object.keys(LISTING_STATUS_LABELS) as ListingStatus[];

function pageOf(params: Pick<URLSearchParams, 'get'>) {
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return Number.isFinite(page) && page > 1 ? page : 1;
}

function href(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** The review queue's view and page from its URL: reported reviews, first page, unless it says otherwise. */
export function parseReviewFilters(params: Pick<URLSearchParams, 'get'>): ReviewFilters {
  const view = params.get('view') ?? '';
  return { view: (VIEWS as string[]).includes(view) ? (view as ReviewView) : 'reported', page: pageOf(params) };
}

export function reviewFiltersHref(filters: ReviewFilters): string {
  const params = new URLSearchParams();
  if (filters.view !== 'reported') params.set('view', filters.view);
  if (filters.page > 1) params.set('page', String(filters.page));
  return href('/admin/reviews', params);
}

export function parseListingFilters(params: Pick<URLSearchParams, 'get'>): ListingFilters {
  const status = params.get('status') ?? '';
  return {
    status: (LISTING_STATUSES as string[]).includes(status) ? (status as ListingStatus) : '',
    q: (params.get('q') ?? '').slice(0, 100),
    page: pageOf(params),
  };
}

export function listingFiltersHref(filters: ListingFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.page > 1) params.set('page', String(filters.page));
  return href('/admin/listings', params);
}

export const adminModerationApi = {
  reviews: ({ view, page }: ReviewFilters) =>
    apiFetch<ReviewQueue>('/admin/reviews', {
      query: { view, limit: REVIEW_PAGE_SIZE, offset: (page - 1) * REVIEW_PAGE_SIZE },
    }),
  /** A decision on the status the admin saw (409 when it moved since); the reason is required. */
  moderateReview: (review: Pick<ModeratedReview, 'id' | 'status'>, action: ReviewAction, reason: string) =>
    apiFetch<ModeratedReview>(`/admin/reviews/${encodeURIComponent(review.id)}/moderation`, {
      method: 'POST', body: { action, reason: reason.trim(), expected_status: review.status },
    }),
  listings: ({ status, q, page }: ListingFilters) =>
    apiFetch<ListingPage>('/admin/listings', {
      query: { status, q: q.trim(), limit: LISTING_PAGE_SIZE, offset: (page - 1) * LISTING_PAGE_SIZE },
    }),
  moderateListing: (listing: Pick<ModeratedListing, 'id' | 'status'>, action: ListingAction, reason: string) =>
    apiFetch<ModeratedListing>(`/admin/listings/${encodeURIComponent(listing.id)}/moderation`, {
      method: 'POST', body: { action, reason: reason.trim(), expected_status: listing.status },
    }),
};
