import { PAYMENT_STATUS_LABELS, type PaymentStatus } from '@/app/lib/rent-ledger';

// Outlined on white, so each pairing stays above AA and survives printing without backgrounds.
const TONE: Record<PaymentStatus, string> = {
  PAID: 'border-success text-success',
  OVERDUE: 'border-danger text-danger',
  PARTIALLY_PAID: 'border-warning text-warning',
  UNPAID: 'border-control-border text-text-body',
};

/** A rent charge's balance, as the owner's ledger and the tenant's rent page both show it. */
export default function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border bg-white px-2.5 py-0.5 text-xs font-semibold ${TONE[status]}`}>
      {PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}
