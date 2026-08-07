// Presentation helpers shared by every screen.
// These derive display strings from live API records — they never invent data.

export function initialsOf(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatMoney(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '—';
  return `$${Number(value).toLocaleString('en-AU', { maximumFractionDigits: 2 })}${suffix}`;
}

export function formatMoneyExact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `$${Number(value).toFixed(2)}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '';
  // Backend times arrive as 'HH:MM:SS'.
  const [hours, minutes] = value.split(':');
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
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
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  const daysAgo = (now.getTime() - date.getTime()) / 86_400_000;
  if (daysAgo < 2) return 'Yesterday';
  if (daysAgo < 7) return date.toLocaleDateString('en-AU', { weekday: 'short' });
  return formatDate(value);
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
