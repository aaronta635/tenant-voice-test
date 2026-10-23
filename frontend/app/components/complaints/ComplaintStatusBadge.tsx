import type { ComplaintStatus } from '@/app/lib/api';
import { COMPLAINT_STATUS_LABELS } from '@/app/lib/format';

const CLASSES: Record<ComplaintStatus, string> = {
  open: 'bg-[#fef3c7] text-[#92400e]',
  under_review: 'bg-primary/10 text-primary-strong',
  resolved: 'bg-success/10 text-success',
  dismissed: 'bg-background text-text-subtle',
};

export default function ComplaintStatusBadge({ status }: { status: ComplaintStatus }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${CLASSES[status]}`}>
      {COMPLAINT_STATUS_LABELS[status] ?? status}
    </span>
  );
}
