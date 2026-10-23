import type { ScorecardRequest } from '@/app/lib/scorecards';

/**
 * A completed scorecard as both of its parties read it: each of the seven
 * ratings in the scorecard's order, and the owner's comment. The card around
 * it gives the average and the date.
 */
export default function ScorecardResult({ request, id }: { request: ScorecardRequest; id?: string }) {
  return (
    <div id={id} className="mt-3 min-w-0 rounded-xl border border-border bg-background p-4">
      <dl className="space-y-2 text-sm">
        {request.answers.map((answer) => {
          const stars = Math.max(0, Math.min(5, Math.round(answer.rating)));
          return (
            <div key={answer.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <dt className="min-w-0 break-words text-text-body">{answer.label}</dt>
              <dd className="shrink-0 font-semibold text-text-dark">
                <span aria-hidden className="mr-1.5 text-warning">{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
                {stars} out of 5
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-3 border-t border-border pt-3 text-sm">
        <p className="font-semibold text-text-dark">Comment</p>
        <p className="mt-1 whitespace-pre-line break-words text-text-body">{request.comment ?? 'No comment was left.'}</p>
      </div>
    </div>
  );
}
