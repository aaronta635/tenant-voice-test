import StatePill, { type PillTone } from '@/app/components/admin/StatePill';
import { complaintStatusLabel, type AdminComplaint, type ComplaintStatus } from '@/app/lib/admin-complaints-api';

const TONES: Record<ComplaintStatus, PillTone> = {
  OPEN: 'warning',
  IN_REVIEW: 'info',
  ESCALATED: 'danger',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

/** A complaint's status as the admin console shows it; a withdrawn one reads as withdrawn. */
export default function ComplaintStatePill({ complaint }: { complaint: Pick<AdminComplaint, 'status' | 'withdrawn'> }) {
  return <StatePill tone={complaint.withdrawn ? 'neutral' : TONES[complaint.status] ?? 'neutral'}>{complaintStatusLabel(complaint)}</StatePill>;
}
