import Link from 'next/link';
import PrivateDetails from '@/app/components/public-profiles/PrivateDetails';
import ProfileAvatar from '@/app/components/public-profiles/ProfileAvatar';
import RatingBadge from '@/app/components/trust/RatingBadge';
import ReportedBadge from '@/app/components/trust/ReportedBadge';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import { formatDate } from '@/app/lib/format';
import {
  budgetLabel,
  moveInLabel,
  profileSearchHref,
  ratingSummary,
  scorecardLabel,
  type PublicProfileDetail,
  type PublicProfileReview,
} from '@/app/lib/public-profiles';

type Props = { profile: PublicProfileDetail; signedIn: boolean };

const card = 'rounded-2xl border border-border bg-white p-5';

/**
 * A tenant's or landlord's public profile (R22): the public fields and
 * published reviews the API sends, the same signed in or out, and blurred
 * stand-ins for everything else. Providers have their own marketplace page.
 */
export default function PublicProfileView({ profile, signedIn }: Props) {
  const role = profile.role === 'tenant' ? 'tenant' : 'landlord';
  const rating = ratingSummary(profile);
  const roleLine = [profile.role_label, profile.business_name].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-6 sm:px-6 lg:px-10">
      <Link
        href={profileSearchHref({ role, q: '', location: '', page: 1 })}
        className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-strong underline"
      >
        ← Find profiles
      </Link>
      {/* The last row takes the height the private details add, so the first two fit their content. */}
      <div className="mt-4 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_auto_1fr]">
        <section className={`${card} lg:col-start-1 lg:row-start-1`}>
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
            <ProfileAvatar name={profile.display_name} url={profile.avatar_url} size="lg" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-start justify-center gap-2 sm:justify-start">
                <h1 className="min-w-0 break-words font-heading text-2xl font-bold text-text-dark">{profile.display_name}</h1>
                {profile.verified ? <VerifiedBadge className="mt-1.5" /> : null}
              </div>
              <p className="mt-1 break-words text-sm text-text-body">{roleLine}</p>
              {profile.areas.length ? <p className="mt-1 break-words text-sm text-text-body">{profile.areas.join(' · ')}</p> : null}
              <div className="mt-2">
                <RatingBadge average={profile.rating_avg} count={profile.review_count} />
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="about-heading" className={`${card} lg:col-start-1 lg:row-start-2`}>
          <h2 id="about-heading" className="font-heading text-xl font-bold text-text-dark">About</h2>
          <p className="mt-3 break-words text-sm leading-relaxed text-text-body">
            {profile.about ?? `${profile.display_name} has not added an about line yet.`}
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            {profile.role === 'tenant' ? (
              <>
                <Row label="Weekly budget" value={budgetLabel(profile.budget_min, profile.budget_max) ?? 'Not shared'} />
                <Row label="Move-in" value={moveInLabel(profile.move_in_month) ?? 'Not shared'} />
                {profile.scorecard ? <Row label="Scorecards" value={scorecardLabel(profile.scorecard)} /> : null}
              </>
            ) : null}
            <Row label={profile.role === 'tenant' ? 'Preferred areas' : 'Areas'} value={profile.areas.join(', ') || 'Not listed'} />
          </dl>
        </section>

        <div className="min-w-0 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
          <PrivateDetails role={role} userId={profile.id} name={profile.display_name} path={`/public/${profile.id}`} signedIn={signedIn} />
        </div>

        <section aria-labelledby="reviews-heading" className={`${card} lg:col-start-1 lg:row-start-3`}>
          <h2 id="reviews-heading" className="font-heading text-xl font-bold text-text-dark">Reviews</h2>
          <p className="mt-1 text-sm text-text-body">{rating ? <><span aria-hidden>★ </span>{rating}</> : 'No reviews yet'}</p>
          {profile.reviews.length ? (
            <ul className="mt-2 divide-y divide-border">
              {profile.reviews.map((review) => <ReviewItem key={review.id} review={review} name={profile.display_name} />)}
            </ul>
          ) : null}
          {profile.review_count > profile.reviews.length ? (
            <p className="mt-3 text-sm text-text-body">Showing the newest {profile.reviews.length} of {profile.review_count} reviews.</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ReviewItem({ review, name }: { review: PublicProfileReview; name: string }) {
  const stars = Math.max(0, Math.min(5, Math.round(review.rating)));
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text-dark">{review.reviewer_label}</p>
        <p className="text-sm font-semibold text-text-dark">
          <span className="sr-only">{stars} out of 5 stars</span>
          <span aria-hidden>{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
        </p>
      </div>
      <p className="mt-0.5 text-xs text-text-body">{formatDate(review.created_at)}</p>
      {review.reported ? <ReportedBadge className="mt-2" /> : null}
      {review.title ? <h3 className="mt-2 break-words text-sm font-semibold text-text-dark">{review.title}</h3> : null}
      {review.body ? <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-text-body">{review.body}</p> : null}
      {review.reply ? (
        <div className="mt-3 rounded-xl border-l-2 border-primary bg-surface p-3">
          <p className="text-xs font-semibold text-text-dark">
            Response from {name}{review.replied_at ? ` · ${formatDate(review.replied_at)}` : ''}
          </p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-text-body">{review.reply}</p>
        </div>
      ) : null}
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
      <dt className="text-text-body">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-text-dark">{value}</dd>
    </div>
  );
}
