import Link from 'next/link';
import { notFound } from 'next/navigation';
import CategoryFiltersPanel from '@/app/components/providers/CategoryFiltersPanel';
import { api, ApiError, safe } from '@/app/lib/api';
import { deriveCategoryFilters } from '@/app/lib/provider-view';
import { getRoleHomeHref } from '@/app/lib/session-role';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ location?: string; search?: string }>;
};

export default async function CategoryListingPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { location, search } = await searchParams;

  let category;
  try {
    category = await api.categories.get(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const providers = await safe(
    api.providers.listPublic({ category: slug, limit: 100 }),
    [],
  );
  const homeHref = await getRoleHomeHref();
  const filters = deriveCategoryFilters(providers);

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 lg:px-14">
      <nav className="text-sm text-[#8c97a2]">
        <Link href={homeHref} className="hover:text-[#1b1b1f]">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link href="/categories" className="hover:text-[#1b1b1f]">
          Categories
        </Link>
        <span className="mx-2">/</span>
        <span className="font-medium text-[#1b1b1f]">{category.name}</span>
      </nav>

      <CategoryFiltersPanel
        category={category}
        providers={providers}
        initialLocation={location ?? ''}
        initialSearch={search ?? ''}
        {...filters}
      />
    </div>
  );
}
