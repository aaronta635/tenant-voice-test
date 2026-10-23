import Image from 'next/image';
import Link from 'next/link';
import RatingBadge from '@/app/components/trust/RatingBadge';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import type { PublicProvider } from '@/app/lib/api';
import {
  providerHref,
  providerBadge,
  providerImage,
  providerLocation,
  providerName,
  providerPriceLabel,
} from '@/app/lib/provider-view';

type Props = {
  /** verified: the owner's account is approved (badges.is_verified), once the listing sends it. */
  provider: PublicProvider & { verified?: boolean };
  layout?: 'grid' | 'list';
  /** The listing the card is on, so the profile's "← Providers" returns to it. */
  listingHref?: string;
};

export default function ProviderCard({ provider, layout = 'grid', listingHref }: Props) {
  const name = providerName(provider);

  return (
    <article className={`flex ${layout === 'list' ? 'flex-col sm:flex-row' : 'flex-col'} overflow-hidden rounded-[20px] border border-[#efeff2] bg-white shadow-[0_1px_1px_rgba(14,42,72,0.04)] print:break-inside-avoid`}>
      <div className={`relative shrink-0 bg-[#f1ece5] ${layout === 'list' ? 'aspect-[4/3] sm:aspect-auto sm:w-40' : 'aspect-[4/3]'}`}>
        <Image
          src={providerImage(provider)}
          alt={provider.profiles?.avatar_url ? name : 'No provider photo yet'}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 25vw"
        />
        {providerBadge(provider) ? (
          <span className="absolute top-3 left-3 rounded-full bg-[#0e2a48] px-2.5 py-1 text-[10px] font-bold tracking-wide text-white">
            {providerBadge(provider)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex min-w-0 items-start gap-1.5">
          <h3 className="min-w-0 break-words text-base font-bold text-[#1b1b1f]">{name}</h3>
          {provider.verified ? <VerifiedBadge size="sm" className="mt-1" /> : null}
        </div>
        <p className="text-sm text-[#5f6b76]">{provider.category_name ?? 'Property services'}</p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#5f6b76]">
          <RatingBadge average={provider.rating_avg} count={provider.review_count} />
          <span className="min-w-0 break-words">{providerLocation(provider)}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {provider.verifications.map((v) => (
            <span
              key={v}
              className="rounded-full bg-[#eeeffd] px-2 py-0.5 text-[11px] font-semibold text-[#0e2a48]"
            >
              ✓ {v}
            </span>
          ))}
        </div>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">
          <div>
            {provider.from_price == null ? (
              <p className="text-sm font-semibold text-[#5f6b76]">No services listed yet</p>
            ) : (
              <>
                <p className="text-lg font-extrabold text-[#1b1b1f]">{providerPriceLabel(provider)}</p>
                {provider.price_unit ? <p className="text-xs text-[#5f6b76]">{provider.price_unit}</p> : null}
              </>
            )}
            {provider.availability_note ? (
              <p className="mt-1 text-xs font-semibold text-[#1b7c4f]">
                ● {provider.availability_note}
              </p>
            ) : null}
          </div>
          <Link
            href={listingHref ? `${providerHref(provider)}?from=${encodeURIComponent(listingHref)}` : providerHref(provider)}
            className="inline-flex h-11 shrink-0 items-center rounded-full border border-[#efeff2] bg-white px-4 text-sm font-semibold text-[#1b1b1f] transition-colors hover:border-primary hover:text-primary-strong"
          >
            View profile
          </Link>
        </div>
      </div>
    </article>
  );
}
