// The owner's and tenant's dashboards and a listing's analytics (tracker R28,
// R35): the shapes backend/app/schemas/dashboard.py answers with, and their
// names. Every figure is counted by the server from the rows it names; nothing
// here works one out. The calls are api.dashboard in lib/api.ts.

import type { ListingStatus } from './api';

/** An accepted open-home booking, or an inspection (routine, entry, exit, viewing) still to come. */
export type UpcomingInspection = {
  id: string;
  kind: 'booking' | 'inspection';
  listing_id: string;
  listing_title: string | null;
  starts_at: string;
  duration_minutes: number | null;
  /** "Open home booking", or the inspection's type. */
  label: string;
};

/** One listing's figures on the owner's dashboard. */
export type OwnerListingPerformance = {
  id: string;
  title: string | null;
  listing_status: ListingStatus;
  /** Under an active rent agreement. */
  occupied: boolean;
  /** Withdrawn and expired applications are left out, as on My properties. */
  application_count: number;
  new_application_count: number;
  /** Views over the dashboard's view_days. */
  /** null until the views table exists. */
  view_count: number | null;
  favourite_count: number;
  review_count: number;
  rating_avg: number | null;
  upcoming_inspection_count: number;
};

export type AnalyticsDays = 7 | 30 | 90;

export type ListingAnalytics = {
  property_id: string;
  title: string | null;
  listing_status: ListingStatus;
  published_at: string | null;
  days: AnalyticsDays;
  /** The range's first and last Sydney days (YYYY-MM-DD). */
  start: string;
  end: string;
  /** available is false until the views table exists: no figures and no days then. */
  views: { available: boolean; total: number | null; period: number | null; daily: { date: string; count: number }[] };
  favourites: { total: number; period: number };
  applications: {
    total: number;
    period: number;
    new: number;
    reviewing: number;
    shortlisted: number;
    approved: number;
    declined: number;
    withdrawn: number;
    expired: number;
  };
  inspections: {
    bookings: number;
    pending: number;
    accepted: number;
    reschedule_requested: number;
    rejected: number;
    cancelled: number;
    upcoming_count: number;
    upcoming: UpcomingInspection[];
  };
  reviews: {
    count: number;
    rating_avg: number | null;
    awaiting_reply: number;
    /** 5 stars down to 1. */
    distribution: { rating: number; count: number }[];
  };
  lease: {
    agreement_id: string;
    start_date: string;
    end_date: string | null;
    rent_amount: number;
    rent_frequency: RentFrequency;
  } | null;
};

export type RentFrequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';
/** As mobile_my_rent_summary names a charge's state. */
export type RentStatus = 'PAID' | 'OVERDUE' | 'PARTIALLY_PAID' | 'UNPAID';

export type TenantLease = {
  agreement_id: string;
  listing_id: string;
  listing_title: string | null;
  address: string | null;
  rent_amount: number;
  rent_frequency: RentFrequency;
  start_date: string;
  end_date: string | null;
  first_due_date: string | null;
};

export type RentCharge = {
  charge_id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  amount_due: number;
  /** Successful, verified payments. */
  amount_paid: number;
  amount_outstanding: number;
  status: RentStatus;
};

export type RentalHistoryItem = {
  id: string;
  /** tenantvoice: an application an owner approved on TenantVoice; self_reported: added on the profile. */
  source: 'tenantvoice' | 'self_reported';
  listing_id: string | null;
  title: string | null;
  address: string | null;
  start_date: string | null;
  end_date: string | null;
  current: boolean;
  weekly_rent: number | null;
  landlord_name: string | null;
};

export const ANALYTICS_DAYS: AnalyticsDays[] = [7, 30, 90];

export const ANALYTICS_DAYS_LABELS: Record<AnalyticsDays, string> = {
  7: 'Last 7 days',
  30: 'Last 30 days',
  90: 'Last 90 days',
};

/** The range in the analytics page's URL (?days=), 30 days unless it names another one offered. */
export function parseAnalyticsDays(params: { get(name: string): string | null }): AnalyticsDays {
  const days = Number(params.get('days'));
  return ANALYTICS_DAYS.includes(days as AnalyticsDays) ? (days as AnalyticsDays) : 30;
}

/**
 * The views to chart: one column a day, or for 90 days one a week of seven days from the range's first,
 * as the admin analytics groups them. 90 daily columns are about a quarter of a pixel wide on a phone.
 */
export function viewSeries(daily: { date: string; count: number }[], days: AnalyticsDays) {
  if (days < 90) return { counts: daily.map((point) => point.count), periods: daily.map((point) => point.date), granularity: 'day' as const };
  const counts: number[] = [];
  const periods: string[] = [];
  daily.forEach((point, index) => {
    if (index % 7 === 0) {
      periods.push(point.date);
      counts.push(0);
    }
    counts[counts.length - 1] += point.count;
  });
  return { counts, periods, granularity: 'week' as const };
}

/** The analytics page of a listing for a range; 30 days is the bare URL. */
export function analyticsHref(listingId: string, days: AnalyticsDays = 30): string {
  const path = `/owner/properties/${encodeURIComponent(listingId)}/analytics`;
  return days === 30 ? path : `${path}?days=${days}`;
}

export const RENT_FREQUENCY_LABELS: Record<RentFrequency, string> = {
  WEEKLY: 'per week',
  FORTNIGHTLY: 'per fortnight',
  MONTHLY: 'per month',
};

export const RENT_STATUS_LABELS: Record<RentStatus, string> = {
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  PARTIALLY_PAID: 'Part paid',
  UNPAID: 'Due',
};

/** "50%", "33.3%": a share as the server rounds it, or a dash without listings. */
export function formatShare(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString('en-AU', { maximumFractionDigits: 1 })}%`;
}

/** "1 view", "3 views". */
export function counted(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-AU')} ${count === 1 ? one : many}`;
}
