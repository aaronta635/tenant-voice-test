import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import RatingBadge from '@/app/components/trust/RatingBadge';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import { formatServicePrice, initialsOf } from '@/app/lib/format';
import { suggestionBookingHref, suggestionProfileHref, type ProviderSuggestion } from '@/app/lib/provider-suggestions';

type Props = {
  suggestion: ProviderSuggestion;
  /** The suburb the booking request starts with: the property's, or the member's own. */
  suburb?: string | null;
  /** How many of the reasons to show, best first. */
  reasonsShown?: number;
};

/**
 * One suggested provider, laid out as the reference's category cards: the
 * name with its verified seal, the category and where it is based, the
 * rating pill and the price of the service suggested, then the facts that
 * place it, the booking form for that service and the profile.
 */
export default function ProviderSuggestionCard({ suggestion, suburb, reasonsShown = 4 }: Props) {
  const titleId = `provider-suggestion-${suggestion.id}`;
  const place = [suggestion.location, suggestion.state].filter(Boolean).join(', ');
  const detail = [suggestion.category_name ?? 'Property services', place].filter(Boolean).join(' · ');
  const { service } = suggestion;
  // A mobile service priced 0 has no price yet (backend services/service_providers.py).
  const price = service.price > 0 ? formatServicePrice(service.price, service.pricing_type) : 'No price listed yet';
  return (
    <Card className="flex h-full min-w-0 flex-col p-5">
      <article aria-labelledby={titleId} className="flex h-full min-w-0 flex-col">
        <div className="flex min-w-0 items-start gap-3">
          <div aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface text-base font-semibold text-primary-strong">
            {initialsOf(suggestion.display_name)}
          </div>
          <div className="min-w-0">
            <h3 id={titleId} className="flex flex-wrap items-center gap-1.5 font-semibold text-text-dark">
              <span className="min-w-0 [overflow-wrap:anywhere]">{suggestion.display_name}</span>
              {suggestion.verified ? <VerifiedBadge size="sm" /> : null}
            </h3>
            <p className="mt-0.5 break-words text-sm text-text-body">{detail}</p>
          </div>
        </div>
        {/* On a narrow card the price wraps under the rating rather than squeezing it. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <RatingBadge average={suggestion.rating_avg} count={suggestion.review_count} />
          <p className="min-w-0 break-words text-sm text-text-body">
            <span className="font-bold text-primary-strong">{price}</span> · {service.title}
          </p>
        </div>
        <div className="mt-4 flex-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-body">Why this provider</h4>
          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-text-body">
            {suggestion.reasons.slice(0, reasonsShown).map((reason) => (
              <li key={reason} className="flex gap-2">
                <span aria-hidden="true" className="text-primary-strong">&bull;</span>
                <span className="min-w-0 break-words">{reason}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <ButtonLink href={suggestionBookingHref(suggestion, suburb)} size="sm" fullWidth>
            Request a booking<span className="sr-only">: {service.title} with {suggestion.display_name}</span>
          </ButtonLink>
          <ButtonLink href={suggestionProfileHref(suggestion)} variant="secondary" size="sm" fullWidth>
            View profile<span className="sr-only">: {suggestion.display_name}</span>
          </ButtonLink>
        </div>
      </article>
    </Card>
  );
}
