// The complaint forms' categories (GET /complaint-categories), the tenancies
// a tenant may complain about, and how a complaint's timeline reads (tracker
// R38). The categories are the shared database's fixed general codes, the
// ones create_general_complaint accepts; the categories admins manage are
// alert policies over these codes, not complaint categories.

import { apiFetch } from './api';

export type ComplaintCategoryOption = { code: string; name: string; description: string };

/** complaints.severity: the person lodging a complaint chooses it. */
export type ComplaintSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const COMPLAINT_SEVERITY_OPTIONS: { value: ComplaintSeverity; label: string; hint: string }[] = [
  { value: 'LOW', label: 'Low', hint: 'An inconvenience' },
  { value: 'MEDIUM', label: 'Medium', hint: 'Affects daily life' },
  { value: 'HIGH', label: 'High', hint: 'Needs attention within days' },
  { value: 'CRITICAL', label: 'Critical', hint: 'A risk to health or safety now' },
];

/** A listing the tenant rents (an approved application): the only ones a complaint may name. */
export type ComplaintTenancy = { listing_id: string; title: string; address: string | null };

/** create_general_complaint's rule, once the spaces at either end are trimmed. */
export const DESCRIPTION_LIMITS = { min: 10, max: 3000 } as const;

export type ComplaintStepStatus = 'open' | 'under_review' | 'escalated' | 'resolved' | 'dismissed';

/** One step of a complaint's timeline (complaint_events), as its parties see it. */
export type ComplaintStep = {
  id: string;
  /** "other" is a step another app recorded. */
  kind: 'lodged' | 'updated' | 'responded' | 'status' | 'other';
  /** The status a status step moved the case to. */
  status: ComplaintStepStatus | null;
  /** A TenantVoice admin's note on a status change, written for both parties. */
  note: string | null;
  actor: 'you' | 'complainant' | 'respondent' | 'staff' | 'other';
  created_at: string;
};

export const complaintCategoriesApi = {
  list: () => apiFetch<ComplaintCategoryOption[]>('/complaint-categories'),
  /** The listings of the caller's approved applications. */
  tenancies: () => apiFetch<ComplaintTenancy[]>('/complaints/tenancies'),
};

export const STEP_STATUS_LABELS: Record<ComplaintStepStatus, string> = {
  open: 'Open',
  under_review: 'Under review',
  escalated: 'Escalated',
  resolved: 'Resolved',
  dismissed: 'Withdrawn',
};

/** The names a timeline gives the two parties when the viewer is neither. */
export type StepNames = { complainant?: string | null; respondent?: string | null };

/** Who took a step, as the viewer reads it. */
export function stepActor(step: Pick<ComplaintStep, 'actor'>, names: StepNames = {}) {
  switch (step.actor) {
    case 'you':
      return 'You';
    case 'staff':
      return 'TenantVoice';
    case 'complainant':
      return names.complainant || 'The person who lodged it';
    case 'respondent':
      return names.respondent || 'The other party';
    default:
      return 'Someone';
  }
}

/** A step in one sentence: "TenantVoice set the status to Escalated". */
export function describeStep(step: ComplaintStep, names: StepNames = {}) {
  const who = stepActor(step, names);
  if (step.kind === 'lodged') return `${who} lodged the complaint`;
  if (step.kind === 'updated') return `${who} updated the details`;
  if (step.kind === 'responded') return `${who} responded`;
  if (step.kind === 'status' && step.status === 'dismissed') return `${who} withdrew the complaint`;
  if (step.kind === 'status' && step.status) return `${who} set the status to ${STEP_STATUS_LABELS[step.status]}`;
  return 'The complaint was updated';
}
