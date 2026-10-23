// Leases (tracker R26): the API's /leases routes (backend services/leases.py)
// and how the pages name where a lease is. The owner drafts the terms of an
// approved application and sends a PDF; the tenant confirms the terms and signs
// it; the owner signs and activates. Every state shown here is the server's.

import { API_BASE, ApiError, apiFetch, friendlyApiError, getAuthToken } from './api';

export type RentFrequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';
/** Where a lease is, as the server works it out from its rows. */
export type LeaseStage = 'draft' | 'review' | 'confirmed' | 'tenant_signed' | 'signed' | 'active' | 'ended' | 'cancelled';
export type LeaseRole = 'tenant' | 'owner';

export type LeaseParty = { id: string; name: string };
/** The latest PDF: the only one either party can open, review or sign. */
export type LeaseDocument = { id: string; filename: string; version: number; created_at: string };
export type LeaseSignature = {
  signer_name: string;
  signed_at: string;
  document_id: string;
  document_sha256: string;
  consent_version: string;
};
export type LeaseActions = { send_document: boolean; confirm: boolean; sign: boolean; owner_sign: boolean; activate: boolean };

export type Lease = {
  id: string;
  application_id: string;
  listing_id: string;
  title: string;
  address: string | null;
  /** The listing's bond, which the guided lease form starts from. */
  bond_amount: number | null;
  tenant: LeaseParty;
  owner: LeaseParty;
  rent_amount: number;
  rent_frequency: RentFrequency;
  currency: string;
  start_date: string;
  end_date: string | null;
  first_due_date: string;
  status: 'draft' | 'active' | 'ended' | 'cancelled';
  stage: LeaseStage;
  tenant_confirmed_at: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
  document: LeaseDocument | null;
  tenant_signature: LeaseSignature | null;
  owner_signature: LeaseSignature | null;
  viewer_role: LeaseRole;
  actions: LeaseActions;
  /** What the viewer agrees to when they sign; the server keeps its own copy. */
  consent: { text: string; version: string } | null;
};

/** An owner's approved application without a lease yet, with what the draft starts from. */
export type LeaseCandidate = {
  application_id: string;
  listing_id: string;
  title: string;
  address: string | null;
  tenant: LeaseParty;
  offer_weekly_rent: number | null;
  move_in_date: string | null;
  bond_amount: number | null;
  lease_term_months: number | null;
  approved_at: string | null;
};

export type LeaseTerms = {
  application_id: string;
  rent_amount: number;
  rent_frequency: RentFrequency;
  start_date: string;
  first_due_date: string;
  end_date: string | null;
};

/** The guided lease form: what the PDF says besides the agreed terms, the parties and the address. */
export type LeaseForm = {
  title: string;
  bond_amount: number | null;
  payment_details: string | null;
  max_occupants: number | null;
  pets_allowed: boolean | null;
  utilities: string | null;
  special_conditions: string | null;
};

export type LeasePreview = { sha256: string; filename: string; size: number; pdf_base64: string };

const path = (id: string) => `/leases/${encodeURIComponent(id)}`;

export const leasesApi = {
  list: () => apiFetch<Lease[]>('/leases'),
  candidates: () => apiFetch<LeaseCandidate[]>('/leases/candidates'),
  get: (id: string) => apiFetch<Lease>(path(id)),
  create: (terms: LeaseTerms) => apiFetch<Lease>('/leases', { method: 'POST', body: terms }),
  preview: (id: string, form: LeaseForm) =>
    apiFetch<LeasePreview>(`${path(id)}/document/preview`, { method: 'POST', body: form }),
  /** Sends the previewed PDF: the server refuses one whose hash is not the preview's. */
  send: (id: string, form: LeaseForm, previewSha256: string) =>
    apiFetch<Lease>(`${path(id)}/document`, { method: 'POST', body: { ...form, preview_sha256: previewSha256 } }),
  upload: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiFetch<Lease>(`${path(id)}/document/upload`, { method: 'POST', formData });
  },
  confirm: (id: string, documentId: string) =>
    apiFetch<Lease>(`${path(id)}/confirm`, { method: 'POST', body: { document_id: documentId } }),
  sign: (id: string, documentId: string, signerName: string) =>
    apiFetch<Lease>(`${path(id)}/sign`, { method: 'POST', body: { document_id: documentId, signer_name: signerName, agree: true } }),
  ownerSign: (id: string, signerName: string) =>
    apiFetch<Lease>(`${path(id)}/owner-signature`, { method: 'POST', body: { signer_name: signerName, agree: true } }),
  activate: (id: string) => apiFetch<Lease>(`${path(id)}/activate`, { method: 'POST' }),
  /** The latest PDF's bytes, streamed by the backend to the lease's two parties only. */
  async pdf(id: string, documentId: string): Promise<Blob> {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}${path(id)}/documents/${encodeURIComponent(documentId)}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    }).catch(() => { throw new ApiError(0, 'Could not connect. Check your connection and try again.'); });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const detail = typeof data === 'object' && data !== null && 'detail' in data ? (data as { detail: unknown }).detail : undefined;
      throw new ApiError(res.status, friendlyApiError(res.status, data), detail);
    }
    return res.blob();
  },
};

/** A preview's PDF, from the base64 the API sends it as. */
export function previewBlob(preview: LeasePreview): Blob {
  const bytes = Uint8Array.from(atob(preview.pdf_base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'application/pdf' });
}

export const FREQUENCY_LABELS: Record<RentFrequency, string> = {
  WEEKLY: 'Weekly',
  FORTNIGHTLY: 'Fortnightly',
  MONTHLY: 'Monthly',
};

const PER: Record<RentFrequency, string> = { WEEKLY: 'a week', FORTNIGHTLY: 'a fortnight', MONTHLY: 'a month' };

/** "$650 a week". */
export function rentText(amount: number, frequency: RentFrequency): string {
  const cents = Math.round(amount * 100) % 100 !== 0;
  return `$${amount.toLocaleString('en-AU', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })} ${PER[frequency] ?? ''}`.trim();
}

/** What a stage means to the person looking, owner or tenant. */
export function stageLabel(stage: LeaseStage, role: LeaseRole): string {
  const labels: Record<LeaseStage, [owner: string, tenant: string]> = {
    draft: ['Draft: send the lease PDF', 'Your owner is preparing the lease'],
    review: ['Sent: the tenant is reviewing it', 'Ready for you to review'],
    confirmed: ['Terms confirmed: the tenant signs next', 'Terms confirmed: sign the lease next'],
    tenant_signed: ['Signed by the tenant: your signature next', 'Signed by you: waiting for the owner'],
    signed: ['Signed by both: activate the lease', 'Signed by both: waiting for the owner to activate it'],
    active: ['Active', 'Active'],
    ended: ['Ended', 'Ended'],
    cancelled: ['Cancelled', 'Cancelled'],
  };
  return labels[stage][role === 'owner' ? 0 : 1];
}

export const STAGE_STYLES: Record<LeaseStage, string> = {
  draft: 'border-border bg-surface text-text-body',
  review: 'border-primary-strong/30 bg-[#f0f1ff] text-primary-strong',
  confirmed: 'border-primary-strong/30 bg-[#f0f1ff] text-primary-strong',
  tenant_signed: 'border-primary-strong/30 bg-[#f0f1ff] text-primary-strong',
  signed: 'border-success/40 bg-[#ecfdf3] text-[#1b7c4f]',
  active: 'border-success/40 bg-[#ecfdf3] text-[#1b7c4f]',
  ended: 'border-border bg-surface text-text-body',
  cancelled: 'border-border bg-surface text-text-body',
};

/** The steps of a lease in order, and how far a lease is along them. */
export const LEASE_STEPS = [
  { id: 'terms', label: 'Terms drafted' },
  { id: 'sent', label: 'Lease PDF sent' },
  { id: 'confirmed', label: 'Tenant confirmed the terms' },
  { id: 'tenant_signed', label: 'Tenant signed' },
  { id: 'owner_signed', label: 'Owner signed' },
  { id: 'active', label: 'Lease active' },
] as const;

/** How many of LEASE_STEPS are done. A lease counts as signed only when the server says both signed its latest PDF. */
export function stepsDone(lease: Pick<Lease, 'stage'>): number {
  const done: Record<LeaseStage, number> = {
    draft: 1, review: 2, confirmed: 3, tenant_signed: 4, signed: 5, active: 6, ended: 6, cancelled: 1,
  };
  return done[lease.stage];
}

/** The ISO date a number of days or months after another (end dates default to one day short of the term). */
export function addToDate(iso: string, { days = 0, months = 0 }: { days?: number; months?: number }): string {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay) + days);
  return target.toISOString().slice(0, 10);
}
