import type { Complaint } from '@/app/lib/api';
import { describeStep } from '@/app/lib/complaint-categories';
import { formatDate } from '@/app/lib/format';

/**
 * A complaint's steps, oldest first, from complaint_events: who lodged and
 * answered it, and each status TenantVoice set, with the admin's note. Both
 * parties see the same steps; which admin handles the case is not among them.
 */
export default function ComplaintTimeline({ complaint }: { complaint: Complaint }) {
  const steps = complaint.timeline ?? [];
  if (steps.length === 0) return null;
  const names = { complainant: complaint.complainant_name, respondent: complaint.against_name };
  return (
    <section aria-label={`Timeline of ${complaint.subject}`} className="mt-5 border-t border-border pt-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-text-body">Timeline</h3>
      <ol className="mt-3 space-y-3">
        {steps.map((step) => (
          <li key={step.id} className="flex gap-3">
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary-strong" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-dark">
                {describeStep(step, names)}
                <span className="text-text-body"> · <time dateTime={step.created_at}>{formatDate(step.created_at)}</time></span>
              </p>
              {step.note ? (
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-background px-3 py-2 text-sm text-text-body [overflow-wrap:anywhere]">
                  {step.note}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
