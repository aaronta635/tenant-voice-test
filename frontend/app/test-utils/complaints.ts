// A complaint as GET /complaints returns it, for the complaint pages' tests.
import type { Complaint } from '@/app/lib/api';
import type { ComplaintStep } from '@/app/lib/complaint-categories';

export function stepOf(id: string, over: Partial<ComplaintStep> = {}): ComplaintStep {
  return { id, kind: 'lodged', status: null, note: null, actor: 'you', created_at: '2026-10-01T00:00:00Z', ...over };
}

/** Tia's complaint about Oliver's flat: answered, then escalated by TenantVoice with a note. */
export function complaintOf(over: Partial<Complaint> = {}): Complaint {
  return {
    id: 'c1', complainant_id: 'tia', against_id: 'oliver', property_id: 'p1', category: 'MOULD', category_label: 'Mould',
    subject: 'Mould in the bathroom', description: 'Black mould keeps coming back.', status: 'under_review',
    response: null, responded_at: null, resolution_note: null, resolved_at: null, is_escalated: true, evidence_urls: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', complainant_name: 'Tia Nguyen',
    against_name: 'Oliver Grant', property_title: 'Harbour flat',
    timeline: [
      stepOf('s1'),
      stepOf('s2', { kind: 'responded', actor: 'respondent', created_at: '2026-10-02T00:00:00Z' }),
      stepOf('s3', { kind: 'status', status: 'escalated', actor: 'staff', note: 'We asked for the repair invoice.', created_at: '2026-10-03T00:00:00Z' }),
    ],
    ...over,
  };
}
