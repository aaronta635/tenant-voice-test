import { ACCOUNT_STATUS_LABELS, type AccountStatus } from '@/app/lib/admin-api';

const TONES: Record<AccountStatus, string> = {
  ACTIVE: 'border-success text-success',
  PENDING_VERIFICATION: 'border-warning text-warning',
  SUSPENDED: 'border-danger text-danger',
  DEACTIVATED: 'border-control-border text-text-body',
};

/** An account's users.status in words, outlined in its tone. */
export default function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border bg-white px-2.5 py-0.5 text-xs font-semibold ${TONES[status] ?? TONES.DEACTIVATED}`}>
      {ACCOUNT_STATUS_LABELS[status] ?? status}
    </span>
  );
}
