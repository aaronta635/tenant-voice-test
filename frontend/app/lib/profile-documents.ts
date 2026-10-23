// Private documents for tenants, landlords and providers (backend /me/documents, R15).
// A file is stored and saved in one request, so a failed upload never shows
// as uploaded, and a file opens only through a link signed for a few minutes.

import { apiFetch } from './api';

export type DocumentStatus = 'pending' | 'verified' | 'rejected';
export type RequirementStatus = 'missing' | DocumentStatus;
/** Who may see a file besides its owner and admins. */
export type DocumentVisibility = 'private' | 'applications';
/** What a tenant's other document is, when the profile completion counts it. */
export type DocumentKind = 'payslip' | 'employment_contract';

export type ProfileDocument = {
  id: string;
  /** A ProfileDocumentType value, such as PASSPORT. */
  document_type: string;
  label: string;
  status: DocumentStatus;
  rejection_reason: string | null;
  file_name: string | null;
  has_file: boolean;
  /** Whether the link endpoint can open it: a file the website stored for its owner. */
  can_open: boolean;
  visibility: DocumentVisibility;
  /** A tenant's other document marked as a payslip or a contract. */
  kind: DocumentKind | null;
  submitted_at: string | null;
  verified_at: string | null;
};

export type DocumentTypeInfo = {
  type: string;
  label: string;
  description: string;
  group: string;
  group_label: string;
  /** False for every type today: a person keeps one document of each (UNIQUE (user_id, document_type)). */
  repeatable: boolean;
  /** A type the account's verification requires. */
  required: boolean;
  /** What a document of this type may be marked as: a tenant's other documents only. */
  kinds: { value: DocumentKind; label: string }[];
  /** A type offered before and still held: it can be opened, replaced or deleted, not uploaded again. */
  kept_only?: boolean;
};

export type DocumentRequirement = { key: string; label: string; types: string[]; status: RequirementStatus };

/** The account's verification (users.verification_status), which the verified badge reads (R17). */
export type AccountVerification = {
  status: DocumentStatus;
  /** Why, when rejected: the rejected requirements, or an admin's reason. */
  rejection_reason: string | null;
  approved_at: string | null;
  /** An admin rejected the account itself: it is back in review once a document its verification needs is replaced or deleted. */
  account_rejected: boolean;
};

export type DocumentChecklist = {
  role: string;
  can_share: boolean;
  types: DocumentTypeInfo[];
  requirements: DocumentRequirement[];
  requirements_met: boolean;
  account: AccountVerification;
  documents: ProfileDocument[];
};

export type DocumentLink = { url: string; expires_in: number };

function fileForm(file: File, fields: Record<string, string | undefined> = {}) {
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) if (value) form.append(key, value);
  return form;
}

const path = (id: string) => `/me/documents/${encodeURIComponent(id)}`;

export const documentsApi = {
  checklist: () => apiFetch<DocumentChecklist>('/me/documents'),
  upload: (
    documentType: string,
    file: File,
    options: { label?: string; visibility?: DocumentVisibility; kind?: DocumentKind } = {},
  ) =>
    apiFetch<ProfileDocument>('/me/documents', {
      method: 'POST',
      formData: fileForm(file, {
        document_type: documentType, label: options.label, visibility: options.visibility, kind: options.kind,
      }),
    }),
  replaceFile: (id: string, file: File) =>
    apiFetch<ProfileDocument>(`${path(id)}/file`, { method: 'PUT', formData: fileForm(file) }),
  update: (id: string, changes: { visibility?: DocumentVisibility; label?: string | null; kind?: DocumentKind | null }) =>
    apiFetch<ProfileDocument>(path(id), { method: 'PATCH', body: changes }),
  remove: (id: string) => apiFetch<void>(path(id), { method: 'DELETE' }),
  link: (id: string) => apiFetch<DocumentLink>(`${path(id)}/link`),
};

/** What a document's or a requirement's status reads as; a PENDING document is in review. */
export const STATUS_LABELS: Record<RequirementStatus, string> = {
  missing: 'Not uploaded',
  pending: 'In review',
  verified: 'Verified',
  rejected: 'Rejected',
};

/** An account's verification in words: pending is not "in review", as a document may still be missing. */
export const VERIFICATION_LABELS: Record<DocumentStatus, string> = {
  pending: 'Not verified yet',
  verified: 'Verified',
  rejected: 'Not verified',
};

/** How a mark reads in a sentence: "Payslip.pdf is marked as a payslip." */
export const KIND_PHRASES: Record<DocumentKind, string> = {
  payslip: 'a payslip',
  employment_contract: 'an employment contract',
};

export const VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  private: 'Only me and admins',
  applications: 'Also owners I apply to',
};

/** The documents of one type, newest first, as the backend lists them. */
export function documentsOfType(checklist: DocumentChecklist, type: string): ProfileDocument[] {
  return checklist.documents.filter((document) => document.document_type === type);
}

/** The checklist's types by group, in the order the backend lists them. */
export function groupedTypes(types: DocumentTypeInfo[]): { group: string; label: string; types: DocumentTypeInfo[] }[] {
  const groups: { group: string; label: string; types: DocumentTypeInfo[] }[] = [];
  for (const type of types) {
    const existing = groups.find((item) => item.group === type.group);
    if (existing) existing.types.push(type);
    else groups.push({ group: type.group, label: type.group_label, types: [type] });
  }
  return groups;
}
