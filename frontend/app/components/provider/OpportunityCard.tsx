import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import ConnectButton from '@/app/components/trust/ConnectButton';
import RatingBadge from '@/app/components/trust/RatingBadge';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import { initialsOf } from '@/app/lib/format';
import { MATCH_LABELS, type WorkOpportunity } from '@/app/lib/work-opportunities';

/**
 * One owner or landlord in the provider's areas, laid out as the reference's
 * owner cards: the rating pill, the name with its verified seal, the role and
 * where they are, then the facts that place them, and Connect.
 */
export default function OpportunityCard({ owner }: { owner: WorkOpportunity }) {
  const place = [owner.location, owner.state].filter(Boolean).join(', ');
  return (
    <Card className="flex min-w-0 flex-col p-5">
      {/* On a narrow card the rating moves under the name rather than squeezing it. */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 items-start gap-3">
          <div aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface text-base font-semibold text-primary-strong">
            {initialsOf(owner.display_name)}
          </div>
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-1.5 font-semibold text-text-dark">
              <span className="min-w-0 [overflow-wrap:anywhere]">{owner.display_name}</span>
              {owner.verified ? <VerifiedBadge size="sm" /> : null}
            </h3>
            <p className="mt-0.5 text-sm text-text-body">{owner.role_label}</p>
            <p className="mt-1 break-words text-xs text-text-body">{place ? `Based in ${place}` : 'Area not listed'}</p>
          </div>
        </div>
        <RatingBadge average={owner.rating_avg} count={owner.review_count} />
      </div>
      <span className={`mb-4 self-start rounded-full px-3 py-1 text-xs font-semibold ${owner.match === 'listing_in_area' || owner.match === 'based_in_area' ? 'bg-success/10 text-success' : 'bg-surface text-primary-strong'}`}>
        {MATCH_LABELS[owner.match]}
      </span>
      <div className="mb-5 flex-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-body">Why this owner</h4>
        <ul className="mt-2 space-y-2 text-sm leading-6 text-text-body">
          {owner.reasons.map((reason) => (
            <li key={reason} className="flex gap-2"><span aria-hidden="true" className="text-primary-strong">&bull;</span><span>{reason}</span></li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <ConnectButton userId={owner.id} name={owner.display_name} signedIn compact />
        <ButtonLink href={`/public/${owner.id}`} variant="secondary" size="sm" fullWidth>
          View profile<span className="sr-only">: {owner.display_name}</span>
        </ButtonLink>
      </div>
    </Card>
  );
}
