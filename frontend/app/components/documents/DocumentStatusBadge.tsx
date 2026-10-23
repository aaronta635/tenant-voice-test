import { STATUS_LABELS, type RequirementStatus } from '@/app/lib/profile-documents';

const TONES: Record<RequirementStatus, string> = {
  missing: 'border-control-border text-text-body',
  pending: 'border-warning text-warning',
  verified: 'border-success text-success',
  rejected: 'border-danger text-danger',
};

/**
 * A document's, requirement's or account's status in words and a shape, never
 * by colour alone. label replaces the words, as an account's verification
 * reads them (VERIFICATION_LABELS).
 */
export default function DocumentStatusBadge({ status, label }: { status: RequirementStatus; label?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-white px-2.5 py-0.5 text-xs font-semibold ${TONES[status]}`}>
      <StatusIcon status={status} />
      {label ?? STATUS_LABELS[status]}
    </span>
  );
}

function StatusIcon({ status }: { status: RequirementStatus }) {
  const path = {
    missing: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5" />,
    pending: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    verified: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>,
    rejected: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  }[status];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
      {path}
    </svg>
  );
}
