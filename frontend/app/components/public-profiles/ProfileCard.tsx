import Link from 'next/link';
import ProfileAvatar from '@/app/components/public-profiles/ProfileAvatar';
import RatingBadge from '@/app/components/trust/RatingBadge';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import { budgetLabel, moveInLabel, publicProfileHref, type PublicProfile } from '@/app/lib/public-profiles';

type Props = { profile: PublicProfile };

/** A search result: only the public fields the API sends, laid out like the reference cards. */
export default function ProfileCard({ profile }: Props) {
  const roleLine = [profile.role_label, profile.business_name].filter(Boolean).join(' · ');

  return (
    <article className="flex h-full min-w-0 flex-col rounded-[20px] border border-border bg-white p-5 shadow-[0_1px_1px_rgba(14,42,72,0.04)]">
      <div className="flex min-w-0 items-start gap-3">
        <ProfileAvatar name={profile.display_name} url={profile.avatar_url} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <h3 className="min-w-0 break-words font-heading text-base font-bold text-text-dark">{profile.display_name}</h3>
            {profile.verified ? <VerifiedBadge size="sm" className="mt-1" /> : null}
          </div>
          <p className="mt-0.5 break-words text-sm text-text-body">{roleLine}</p>
        </div>
      </div>
      <p className="mt-4 flex min-w-0 items-start gap-1.5 text-sm text-text-body">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 size-4 shrink-0" aria-hidden>
          <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
          <circle cx="12" cy="9.5" r="2.5" />
        </svg>
        <span className="min-w-0 break-words">{profile.areas.length ? profile.areas.join(' · ') : 'Area not listed'}</span>
      </p>
      <div className="mt-2">
        <RatingBadge average={profile.rating_avg} count={profile.review_count} />
      </div>
      {profile.role === 'tenant' ? (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Weekly budget" value={budgetLabel(profile.budget_min, profile.budget_max) ?? 'Not shared'} />
          <Stat label="Move-in" value={moveInLabel(profile.move_in_month) ?? 'Not shared'} />
        </dl>
      ) : null}
      {profile.role === 'provider' ? (
        <>
          {profile.categories.length ? (
            <ul aria-label="Services" className="mt-3 flex flex-wrap gap-1.5">
              {profile.categories.map((category) => (
                <li key={category} className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-primary-strong">{category}</li>
              ))}
            </ul>
          ) : null}
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="Service area" value={profile.service_area ?? 'Not listed'} />
            <Stat label="Pricing" value={profile.pricing_summary ?? 'Not listed'} />
          </dl>
        </>
      ) : null}
      {profile.about ? <p className="mt-3 truncate text-sm text-text-body">{profile.about}</p> : null}
      <div className="mt-auto pt-4">
        <Link
          href={publicProfileHref(profile)}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-control-border bg-white px-4 text-sm font-semibold text-text-dark transition-colors hover:border-primary-strong hover:text-primary-strong"
        >
          View profile<span className="sr-only">: {profile.display_name}</span>
        </Link>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-background px-3 py-2">
      <dt className="text-xs text-text-body">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-bold text-text-dark">{value}</dd>
    </div>
  );
}
