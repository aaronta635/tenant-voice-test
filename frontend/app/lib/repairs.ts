// Repairs for tenants and owners (backend /maintenance, tracker R06). Each
// step is the mobile app's own function on the server, so the steps and
// their order are the shared ones: a tenant reports a repair (an owner may
// log one), the owner assigns a provider who covers its category, the
// provider books the visit and marks it done, and the tenant confirms it
// with a rating. The owner may resolve it at any time, and the tenant may
// then rate it. Times are shown in Sydney time.

import { apiFetch } from './api';
import type { RepairCategory } from './repair-categories';

export type RepairStatus = 'open' | 'in_progress' | 'awaiting_confirmation' | 'resolved' | 'cancelled';
export type RepairPriority = 'low' | 'medium' | 'high' | 'urgent';

export type Repair = {
  id: string;
  property_id: string;
  tenant_id: string;
  owner_id: string;
  provider_id: string | null;
  category: string;
  category_label: string | null;
  priority: string;
  status: RepairStatus;
  title: string;
  description: string;
  photo_urls: string[] | null;
  access_notes: string | null;
  resolution_note: string | null;
  appointment_at: string | null;
  estimated_duration_minutes: number | null;
  appointment_note: string | null;
  completed_at: string | null;
  tenant_rating: number | null;
  logged_by_owner: boolean;
  can_confirm: boolean;
  can_rate: boolean;
  can_assign: boolean;
  can_resolve: boolean;
  created_at: string;
  updated_at: string;
  property_title: string | null;
  property_address: string | null;
  tenant_name: string | null;
  owner_name: string | null;
  provider_name: string | null;
};

/** A home the caller can report a repair for, and the other party there. */
export type RepairHome = {
  listing_id: string;
  property_id: string | null;
  title: string;
  address: string | null;
  owner_name: string | null;
  tenant_name: string | null;
};

/** A provider the owner may assign the repair to: approved, active and covering its category. */
export type RepairProvider = { id: string; name: string; service_area: string | null; pricing_summary: string | null };

export type NewRepair = {
  property_id: string;
  title: string;
  description: string;
  category: RepairCategory;
  priority: RepairPriority;
  /** Keys repairs.uploadPhoto returned. */
  photos: string[];
  access_notes: string | null;
};

export type RepairPhoto = { path: string; url: string | null };

export const repairs = {
  list: () => apiFetch<Repair[]>('/maintenance'),
  homes: () => apiFetch<RepairHome[]>('/maintenance/homes'),
  create: (repair: NewRepair) => apiFetch<Repair>('/maintenance', { method: 'POST', body: repair }),
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch<RepairPhoto>('/maintenance/photos', { method: 'POST', formData: form });
  },
  providers: (id: string) => apiFetch<RepairProvider[]>(`/maintenance/${id}/providers`),
  assign: (id: string, providerId: string) =>
    apiFetch<Repair>(`/maintenance/${id}/assign`, { method: 'POST', body: { provider_id: providerId } }),
  resolve: (id: string, note: string | null) =>
    apiFetch<Repair>(`/maintenance/${id}/resolve`, { method: 'POST', body: { note } }),
  confirm: (id: string, rating: number) =>
    apiFetch<Repair>(`/maintenance/${id}/confirm`, { method: 'POST', body: { rating } }),
  rate: (id: string, rating: number) => apiFetch<Repair>(`/maintenance/${id}/rate`, { method: 'POST', body: { rating } }),
};

export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  awaiting_confirmation: 'Awaiting confirmation',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

export const REPAIR_STATUS_STYLES: Record<RepairStatus, string> = {
  open: 'bg-surface text-primary-strong',
  in_progress: 'bg-[#fff4e5] text-warning',
  awaiting_confirmation: 'bg-[#fff4e5] text-warning',
  resolved: 'bg-[#e6f4ed] text-success',
  cancelled: 'bg-[#f4f4f8] text-text-body',
};

export const PRIORITY_OPTIONS: { value: RepairPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export function priorityLabel(value: string): string {
  return PRIORITY_OPTIONS.find((option) => option.value === value)?.label ?? 'Medium';
}

/** The shared limits (mobile_repair_insert): up to 4 photos of 5 MB, jpeg, png or webp. */
export const MAX_REPAIR_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Why a report cannot be sent yet, or null: the server checks the same. */
export function reportProblem(report: Pick<NewRepair, 'property_id' | 'title' | 'description'>): string | null {
  if (!report.property_id) return 'Choose the home this repair is for.';
  const title = report.title.trim();
  if (!title || title.length > 120) return 'Give the issue a short title (up to 120 characters).';
  const description = report.description.trim();
  if (description.length < 5 || description.length > 2000) return 'Describe the issue in 5 to 2000 characters.';
  return null;
}

/** Why a photo cannot be added, or null. */
export function photoProblem(file: File, count: number): string | null {
  if (count >= MAX_REPAIR_PHOTOS) return `You can attach up to ${MAX_REPAIR_PHOTOS} photos.`;
  if (!PHOTO_TYPES.includes(file.type)) return 'Add a JPEG, PNG or WebP photo.';
  if (file.size > MAX_PHOTO_BYTES) return 'Each photo can be up to 5 MB.';
  return null;
}

/** What happens next, in a few words, for the person reading it. */
export function repairNextStep(repair: Repair, viewer: 'tenant' | 'owner'): string {
  switch (repair.status) {
    case 'open':
      return viewer === 'owner' ? 'Assign a provider who covers this repair.' : 'Waiting for the owner to assign a provider.';
    case 'in_progress':
      return repair.appointment_at ? 'The visit is booked.' : `Waiting for ${repair.provider_name ?? 'the provider'} to book the visit.`;
    case 'awaiting_confirmation':
      return viewer === 'tenant' ? 'The provider marked it done. Confirm it with a rating.' : 'Done. Waiting for the tenant to confirm it.';
    case 'resolved':
      return repair.tenant_rating ? `Resolved. Rated ${repair.tenant_rating} out of 5.` : 'Resolved.';
    default:
      return 'Closed.';
  }
}
