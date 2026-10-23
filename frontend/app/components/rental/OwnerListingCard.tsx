import Image from 'next/image';
import Link from 'next/link';
import ButtonLink from '@/app/components/ui/ButtonLink';
import type { Property } from '@/app/lib/api';
import { formatMoney } from '@/app/lib/format';
import { LISTING_STATUS_LABELS, LISTING_STATUS_STYLES, isPublicStatus, listingStatusOf } from '@/app/lib/listings';
import { isRemoteImage } from '@/app/lib/remote-image';

function applicationsLine(property: Property): string {
  const total = property.application_count ?? 0;
  if (!total) return 'No applications yet';
  const fresh = property.new_application_count ?? 0;
  return `${total} application${total === 1 ? '' : 's'}${fresh ? ` · ${fresh} new` : ''}`;
}

/** One listing on the owner's Properties page: its status, applications and where to manage it. */
export default function OwnerListingCard({ property }: { property: Property }) {
  const status = listingStatusOf(property);
  const photo = property.photo_urls?.[0];
  return (
    <article aria-labelledby={`listing-${property.id}`} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-white">
      {photo ? (
        <div className="relative h-44 w-full">
          <Image src={photo} alt="" fill sizes="(min-width: 1280px) 400px, (min-width: 768px) 50vw, 100vw" className="object-cover" unoptimized={isRemoteImage(photo)} />
        </div>
      ) : (
        <div className="flex h-44 items-center justify-center bg-surface text-sm text-text-body">No photo yet</div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${LISTING_STATUS_STYLES[status]}`}>
            {LISTING_STATUS_LABELS[status]}
          </span>
          {property.new_application_count ? (
            <span className="inline-flex items-center rounded-full bg-primary-strong px-2.5 py-0.5 text-xs font-semibold text-white">
              {property.new_application_count} new
            </span>
          ) : null}
        </div>
        <h2 id={`listing-${property.id}`} className="break-words font-heading text-h4 font-semibold text-text-dark">
          <Link href={`/owner/properties/${property.id}`} className="hover:underline">{property.title}</Link>
        </h2>
        <p className="break-words text-sm text-text-body">{property.address}</p>
        <p className="font-semibold text-text-dark">{formatMoney(property.price)}<span className="font-normal text-text-body"> a week</span></p>
        <p className="text-sm text-text-body">
          {property.bedrooms ?? '—'} bed · {property.bathrooms ?? '—'} bath · {property.parking ?? 0} car
        </p>
        <p className="text-sm font-medium text-text-dark">{applicationsLine(property)}</p>
        <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-4">
          <ButtonLink href={`/owner/properties/${property.id}`} size="sm" aria-label={`Manage ${property.title}`}>Manage</ButtonLink>
          <ButtonLink href={`/owner/properties/${property.id}/edit`} size="sm" variant="secondary" aria-label={`Edit ${property.title}`}>
            Edit
          </ButtonLink>
          {isPublicStatus(status) ? (
            <ButtonLink href={`/properties/${property.id}`} size="sm" variant="ghost" aria-label={`View the public page of ${property.title}`}>
              View public page
            </ButtonLink>
          ) : null}
        </div>
      </div>
    </article>
  );
}
