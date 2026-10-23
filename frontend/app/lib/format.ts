// Presentation helpers shared by every screen.
// These derive display strings from live API records — they never invent data.

export function initialsOf(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "$1,250", "$99.50", "-$12.50": the sign never lands between "$" and the digits. */
function formatAud(value: number, minimumFractionDigits: number): string {
  const sign = Math.round(value * 100) < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-AU', { minimumFractionDigits, maximumFractionDigits: 2 })}`;
}

/** Whole dollars stay short; an amount with cents always shows both digits. */
export function formatMoney(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '—';
  const amount = Number(value);
  return `${formatAud(amount, Math.round(amount * 100) % 100 === 0 ? 0 : 2)}${suffix}`;
}

/** One decimal everywhere; "New" until a provider has a review (not a fake 0.0). */
export function formatRating(value: number | null | undefined, reviewCount: number | null | undefined): string {
  if (!reviewCount || value === null || value === undefined) return 'New';
  return Number(value).toFixed(1);
}

/** Ledger figures (and every money stat card) always show cents. */
export function formatMoneyExact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return formatAud(Number(value), 2);
}

const MARKET_TIME_ZONE = 'Australia/Sydney';

/** A date-only value is a calendar date, never a midnight in the viewer's zone. */
function displayDate(value: string): { date: Date; timeZone: string } | null {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime()) || (dateOnly && date.toISOString().slice(0, 10) !== value)) return null;
  return { date, timeZone: dateOnly ? 'UTC' : MARKET_TIME_ZONE };
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = displayDate(value);
  if (!parsed) return '—';
  return parsed.date.toLocaleDateString('en-AU', { timeZone: parsed.timeZone, day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = displayDate(value);
  if (!parsed) return '';
  return parsed.date.toLocaleDateString('en-AU', { timeZone: parsed.timeZone, weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTime(value: string | null | undefined): string {
  if (!value || !/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return '';
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return '';
  // Format the wall-clock value directly; today's DST transition is irrelevant.
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-AU', { timeZone: MARKET_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "Tue 12 May · 10:00 am" from a booking's date + optional time. */
export function formatSchedule(
  date: string | null | undefined,
  time: string | null | undefined,
): string {
  if (!date) return 'Time to be confirmed';
  const day = formatShortDate(date);
  return time ? `${day} · ${formatTime(time)}` : day;
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value);
}

/** Chat-style timestamp: time for today, weekday this week, else a date. */
export function messageTimestamp(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = (at: Date) => at.toLocaleDateString('en-CA', { timeZone: MARKET_TIME_ZONE });
  const daysAgo = Math.round((Date.parse(day(new Date())) - Date.parse(day(date))) / 86_400_000);
  const time = date.toLocaleTimeString('en-AU', { timeZone: MARKET_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
  if (daysAgo === 0) return time;
  if (daysAgo === 1) return `Yesterday · ${time}`;
  if (daysAgo > 1 && daysAgo < 7) return `${date.toLocaleDateString('en-AU', { timeZone: MARKET_TIME_ZONE, weekday: 'short' })} · ${time}`;
  return `${formatDate(value)} · ${time}`;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

// --- Enum labels -----------------------------------------------------------
export const BOOKING_STATUS_LABELS: Record<string, string> = {
  new_enquiry: 'New enquiry',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  payment: 'Paid',
  refund: 'Refunded',
  platform_fee: 'Fee',
  payout: 'Payout',
};

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  approved: 'Approved',
  declined: 'Declined',
};

export const PROPERTY_STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  rented: 'Rented',
  off_market: 'Off market',
};

export const ROLE_LABELS: Record<string, string> = {
  tenant: 'Tenant',
  landlord: 'Landlord',
  service_provider: 'Service provider',
  officer: 'Officer',
  admin: 'Admin',
};

/** "$129 fixed" / "$220 per hour" from a service's pricing pair. */
export function formatServicePrice(
  price: number | null | undefined,
  pricingType: string | null | undefined,
): string {
  if (price === null || price === undefined) return '—';
  const amount = formatMoney(price);
  if (pricingType === 'hourly') return `${amount} per hour`;
  if (pricingType === 'from') return `from ${amount}`;
  return amount;
}

export const COMPLAINT_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  under_review: 'Under review',
  resolved: 'Resolved',
  dismissed: 'Withdrawn',
};

export const COMPLAINT_CATEGORY_LABELS: Record<string, string> = {
  safety: 'Safety',
  maintenance: 'Maintenance',
  harassment: 'Harassment',
  other: 'Other',
};
