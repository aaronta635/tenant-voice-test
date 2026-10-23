import Link from 'next/link';
import { notFound } from 'next/navigation';
import CategoryFiltersPanel from '@/app/components/providers/CategoryFiltersPanel';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { api, ApiError } from '@/app/lib/api';
import { deriveCategoryFilters } from '@/app/lib/provider-view';
import { getRoleHomeHref } from '@/app/lib/session-role';
import { listAllPublicProviders } from '../public-providers';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  try { return { title: (await api.categories.get((await params).slug)).name }; }
  catch { return { title: 'Provider category' }; }
}

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function CategoryListingPage({ params }: Props) {
  const { slug } = await params;

  let category;
  try {
    category = await api.categories.get(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <div className="mx-auto max-w-[1200px] p-6">
        <Link href="/categories" className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">All categories</Link>
        <h1 className="mt-4 mb-5 font-heading text-3xl font-bold">Provider category</h1>
        <LoadErrorCard
          title="Couldn't load this category"
          message="The category list is unavailable right now. Please try again."
        />
      </div>
    );
  }

  let providers;
  try { providers = await listAllPublicProviders({ category: slug }); }
  catch { return <div className="mx-auto max-w-[1200px] p-6"><h1 className="mb-5 font-heading text-3xl font-bold">{category.name}</h1><LoadErrorCard title="Couldn't load providers" message="Please try again to see providers in this category." /></div>; }
  const homeHref = await getRoleHomeHref();
  const filters = deriveCategoryFilters(providers);

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 lg:px-14">
      <nav className="text-sm text-text-body">
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
        {...filters}
      />
    </div>
  );
}
