import type { ApplicationEvent } from '@/app/lib/api';
import { formatDateTime } from '@/app/lib/format';
import { APPLICATION_STAGE_LABELS } from '@/app/lib/listings';

type Props = {
  history: ApplicationEvent[];
  /** Whose view it is, to name the steps they made "you". */
  viewer: 'applicant' | 'landlord';
  /** The applicant's name, for the landlord's view. */
  applicantName?: string;
};

function actor(event: ApplicationEvent, viewer: Props['viewer'], applicantName: string): string | null {
  if (!event.by) return null;
  if (event.by === viewer) return 'you';
  return event.by === 'landlord' ? 'the landlord' : applicantName;
}

/** An application's steps, oldest first (application_status_events), each with who made it and the landlord's note. */
export default function ApplicationHistory({ history, viewer, applicantName = 'the applicant' }: Props) {
  if (history.length === 0) return <p className="text-sm text-text-body">No steps recorded yet.</p>;
  return (
    <ol className="space-y-3 border-l-2 border-border pl-4">
      {history.map((event, index) => {
        const by = actor(event, viewer, applicantName);
        return (
          <li key={`${event.created_at}-${index}`} className="min-w-0 text-sm">
            <p className="font-semibold text-text-dark">
              {APPLICATION_STAGE_LABELS[event.to_stage]}
              {by ? <span className="font-normal text-text-body"> by {by}</span> : null}
            </p>
            <p className="text-xs text-text-body">{formatDateTime(event.created_at)}</p>
            {event.note ? (
              <p className="mt-1 whitespace-pre-line break-words rounded-lg bg-surface p-2 text-text-dark">“{event.note}”</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
