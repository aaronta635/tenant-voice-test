import Image from 'next/image';
import Link from 'next/link';
import type { PublicProvider } from '@/app/lib/api';
import {
  providerHref,
  providerImage,
  providerLocation,
  providerName,
  providerPriceLabel,
} from '@/app/lib/provider-view';

type Props = {
  provider: PublicProvider;
};

export default function ProviderCard({ provider }: Props) {
  const name = providerName(provider);

  return (
    <article className="flex flex-col overflow-hidden rounded-[20px] border border-[#efeff2] bg-white shadow-[0_1px_1px_rgba(14,42,72,0.04)]">
      <div className="relative aspect-[4/3] bg-[#f1ece5]">
        <Image
          src={providerImage(provider)}
          alt={name}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 25vw"
        />
        {provider.badge_label ? (
          <span className="absolute top-3 left-3 rounded-full bg-[#0e2a48] px-2.5 py-1 text-[10px] font-bold tracking-wide text-white">
            {provider.badge_label}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-base font-bold text-[#1b1b1f]">{name}</h3>
        <p className="text-sm text-[#5f6b76]">{provider.category_name ?? 'Property services'}</p>
        <p className="mt-2 text-sm text-[#5f6b76]">
          <span className="font-semibold text-[#0e2a48]">★ {provider.rating_avg.toFixed(2)}</span>
          <span className="mx-1.5 text-[#c5cad3]">·</span>
          {providerLocation(provider)}
          <span className="mx-1.5 text-[#c5cad3]">·</span>
          {provider.review_count} reviews
        </p>
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
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div>
            <p className="text-lg font-extrabold text-[#1b1b1f]">{providerPriceLabel(provider)}</p>
            <p className="text-xs text-[#8c97a2]">{provider.price_unit ?? 'fixed price'}</p>
            {provider.availability_note ? (
              <p className="mt-1 text-xs font-semibold text-[#1b7c4f]">
                ● {provider.availability_note}
              </p>
            ) : null}
          </div>
          <Link
            href={providerHref(provider)}
            className="inline-flex h-9 shrink-0 items-center rounded-full border border-[#efeff2] bg-white px-4 text-sm font-semibold text-[#1b1b1f] transition-colors hover:border-primary hover:text-primary"
          >
            View profile
          </Link>
        </div>
      </div>
    </article>
  );
}
