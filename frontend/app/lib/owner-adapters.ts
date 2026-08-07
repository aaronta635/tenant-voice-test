// Maps live backend records onto the shapes the owner UI components already
// consume (defined in owner-data.ts), so the presentational cards stay untouched.

import type { Application, Property } from '@/app/lib/api';
import type { Applicant } from '@/app/lib/owner-data';

export function propertyLabel(property: Pick<Property, 'title' | 'address'>): string {
  return `${property.title}, ${property.address}`;
}

export function formatMoney(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '—';
  return `$${Number(value).toLocaleString()}${suffix}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  // Backend returns ISO date / datetime strings; show the date part.
  return value.slice(0, 10);
}

/** Convert a backend Application (+ resolved property label) into an Applicant. */
export function toApplicant(app: Application, label: string): Applicant {
  return {
    id: app.id,
    name: app.tenant_name ?? 'Applicant',
    propertySlug: app.property_id,
    propertyLabel: label,
    status: app.status,
    appliedDate: formatDate(app.created_at),
    income: formatMoney(app.annual_income, '/yr'),
    moveInDate: formatDate(app.move_in_date),
    email: '—', // email lives in Supabase auth, not exposed to landlords
    phone: app.tenant_phone ?? '—',
    rentOffered: formatMoney(app.rent_offered, '/week'),
    tenantScore: app.tenant_score ?? 0,
    shortlisted: app.shortlisted,
    hasPets: app.has_pets,
  };
}
