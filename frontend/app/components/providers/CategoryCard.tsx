import Link from 'next/link';
import type { Category } from '@/app/lib/api';
import { formatMoney } from '@/app/lib/format';

type Props = {
  category: Category;
};

export default function CategoryCard({ category }: Props) {
  const priceLabel =
    category.from_price === null
      ? 'no fixed prices yet'
      : category.from_price === 0
        ? 'free consults'
        : `from ${formatMoney(category.from_price)}`;

  return (
    <Link
      href={`/categories/${category.slug}`}
      className="group relative flex h-full flex-col rounded-[20px] border border-[#efeff2] bg-white p-[22px] shadow-[0_1px_1px_rgba(14,42,72,0.04)] transition-shadow hover:shadow-[0_8px_24px_rgba(14,42,72,0.08)]"
    >
      {category.badge ? (
        <span className="absolute top-4 right-4 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-white">
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
      <h3 className="mt-4 text-base font-bold text-[#1b1b1f]">{category.name}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-[#5f6b76]">
        {category.description}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-[#f4f4f8] pt-3 text-xs text-[#8c97a2]">
        <span>
          {category.provider_count.toLocaleString()}{' '}
          {category.provider_count === 1 ? 'provider' : 'providers'} · {priceLabel}
        </span>
        <span className="font-semibold text-primary group-hover:underline">Browse →</span>
      </div>
    </Link>
  );
}
