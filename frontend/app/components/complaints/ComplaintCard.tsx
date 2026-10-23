'use client';

import { useState } from 'react';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import ComplaintStatusBadge from '@/app/components/complaints/ComplaintStatusBadge';
import ComplaintTimeline from '@/app/components/complaints/ComplaintTimeline';
import { api, ApiError, type Complaint } from '@/app/lib/api';
import { COMPLAINT_CATEGORY_LABELS, formatDate } from '@/app/lib/format';

type Props = {
  complaint: Complaint;
  /** 'mine' = I raised it; 'against' = it is about me/my property. */
  perspective: 'mine' | 'against';
  onChanged: (updated: Complaint) => void;
};

export default function ComplaintCard({ complaint, perspective, onChanged }: Props) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isClosed = complaint.status === 'resolved' || complaint.status === 'dismissed';

  async function submitResponse() {
    if (!reply.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.complaints.respond(complaint.id, reply.trim()));
      setSuccess('Response saved.');
      setReply('');
      setReplying(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that response.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.complaints.setStatus(complaint.id, 'dismissed'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not withdraw this complaint.');
    } finally {
      setBusy(false);
    }
  }

  const subtitle =
    perspective === 'mine'
      ? complaint.property_title ?? complaint.against_name ?? 'TenantVoice'
      : `Raised by ${complaint.complainant_name ?? 'a tenant'}`;

  return (
    <Card className="rounded-[16px] border border-border p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-background px-3 py-1 text-xs font-semibold text-text-body">
              {complaint.category_label ?? COMPLAINT_CATEGORY_LABELS[complaint.category] ?? complaint.category}
            </span>
            <ComplaintStatusBadge status={complaint.status} />
            {complaint.is_escalated ? (
              <span className="rounded-full bg-[#fee2e2] px-3 py-1 text-xs font-bold text-[#991b1b]">
                Escalated
              </span>
            ) : null}
          </div>
          <h2 className="mt-3 font-heading text-lg font-bold text-text-dark">{complaint.subject}</h2>
          <p className="mt-1 text-sm text-text-body">
            {subtitle} · {formatDate(complaint.created_at)}
          </p>
        </div>
      </div>

      <p className="mt-4 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-text-body">
        {complaint.description}
      </p>

      {complaint.response ? (
        <div className="mt-5 rounded-[12px] border-l-4 border-primary bg-background p-4">
          <p className="text-xs font-bold tracking-wide text-text-subtle uppercase">
            Response{complaint.responded_at ? ` · ${formatDate(complaint.responded_at)}` : ''}
          </p>
          <p className="mt-2 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-text-body">
            {complaint.response}
          </p>
        </div>
      ) : null}

      {complaint.resolution_note ? (
        <div className="mt-4 rounded-[12px] bg-success/10 p-4">
          <p className="text-xs font-bold tracking-wide text-success uppercase">Outcome</p>
          <p className="mt-1 text-sm text-text-body">{complaint.resolution_note}</p>
        </div>
      ) : null}

      <ComplaintTimeline complaint={complaint} />

      <FormMessage error={error} success={success} className="mt-3" />

      {!isClosed && !replying ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {perspective === 'against' && !replying ? (
            <Button variant="primary" disabled={busy} onClick={() => { setReply(complaint.response ?? ''); setError(null); setSuccess(null); setReplying(true); }}>
              {complaint.response ? 'Update response' : 'Respond'}
            </Button>
          ) : null}
          {perspective === 'mine' ? (
            <Button variant="ghost" disabled={busy} onClick={withdraw}>
              {busy ? 'Withdrawing…' : 'Withdraw complaint'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {replying ? (
        <div className="mt-4 border-t border-border pt-4">
          <label
            htmlFor={`reply-${complaint.id}`}
            className="text-[11px] font-semibold tracking-[0.8px] text-text-body uppercase"
          >
            Your response
          </label>
          <textarea
            id={`reply-${complaint.id}`}
            rows={4}
            autoFocus
            readOnly={busy}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Explain what happened and what you're doing about it…"
            className="mt-2 w-full rounded-[10px] border border-border bg-background p-3 text-sm text-text-dark focus:ring-2 focus:ring-primary focus:outline-none"
          />
          <div className="mt-3 flex gap-3">
            <Button variant="primary" disabled={busy || !reply.trim()} onClick={submitResponse}>
              {busy ? 'Sending…' : 'Send response'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setReplying(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
