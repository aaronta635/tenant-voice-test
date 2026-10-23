import Link from 'next/link';
import type { Category } from '@/app/lib/api';
import { formatMoney } from '@/app/lib/format';

type Props = {
  category: Category;
  /** h3 under a section heading (home page); h2 straight under the page's h1. */
  headingLevel?: 'h2' | 'h3';
};

export default function CategoryCard({ category, headingLevel: Heading = 'h3' }: Props) {
  const priceLabel =
    category.from_price === null
      ? 'no prices listed yet'
      : category.from_price === 0
        ? 'free consults'
        : `from ${formatMoney(category.from_price)}`;

  return (
    <Link
      href={`/categories/${category.slug}`}
      className="group relative flex h-full flex-col rounded-[20px] border border-[#efeff2] bg-white p-[22px] shadow-[0_1px_1px_rgba(14,42,72,0.04)] transition-shadow hover:shadow-[0_8px_24px_rgba(14,42,72,0.08)]"
    >
      {category.badge ? (
        <span className="absolute top-4 right-4 rounded-full bg-primary-strong px-2.5 py-0.5 text-[11px] font-bold text-white">
          {category.badge}
        </span>
      ) : null}
      <div
        className="flex size-[52px] items-center justify-center rounded-[14px]"
        style={{ backgroundColor: category.icon_bg ?? '#f4f4f8' }}
      >
        <span className="text-lg font-bold text-[#0e2a48]">
          {category.name.charAt(0)}
        </span>
      </div>
      <Heading className="mt-4 text-base font-bold text-[#1b1b1f]">{category.name}</Heading>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-[#5f6b76]">
        {category.description}
      </p>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#f4f4f8] pt-3 text-xs text-[#5f6b76]">
        <span className="min-w-0">
          {category.provider_count.toLocaleString()}{' '}
          {category.provider_count === 1 ? 'provider' : 'providers'} · {priceLabel}
        </span>
        <span className="shrink-0 whitespace-nowrap font-semibold text-primary-strong group-hover:underline">Browse →</span>
      </div>
    </Link>
  );
}
