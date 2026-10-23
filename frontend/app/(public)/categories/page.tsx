import Link from 'next/link';
import { redirect } from 'next/navigation';
import CategoryFiltersPanel from '@/app/components/providers/CategoryFiltersPanel';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { deriveCategoryFilters } from '@/app/lib/provider-view';
import CategoryCard from '@/app/components/providers/CategoryCard';
import { api } from '@/app/lib/api';
import { getRoleHomeHref } from '@/app/lib/session-role';
import { listAllPublicProviders } from './public-providers';

export const metadata = { title: 'Find providers' };

export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<{ category?: string; location?: string; search?: string; all?: string }>;
};

export default async function CategoriesIndexPage({ searchParams }: Props) {
  const { category, location, search, all } = await searchParams;

  // The landing-page search form posts here; hand off to the category listing.
  if (category) {
    const query = new URLSearchParams();
    if (location) query.set('location', location);
    if (search) query.set('search', search);
    const qs = query.toString();
    redirect(`/categories/${encodeURIComponent(category)}${qs ? `?${qs}` : ''}`);
  }

  const homeHref = await getRoleHomeHref();
  let categories;
  try { categories = await api.categories.list(); }
  catch { return <div className="mx-auto max-w-[1200px] p-6"><h1 className="mb-5 font-heading text-3xl font-bold">Find providers</h1><LoadErrorCard title="Couldn't load categories" message="Please try again." /></div>; }
  if (location || search || all === '1') {
    let providers;
    try { providers = await listAllPublicProviders(); }
    catch { return <div className="mx-auto max-w-[1200px] p-6"><Link href="/categories" className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">All categories</Link><h1 className="mt-4 mb-5 font-heading text-3xl font-bold">Find providers</h1><LoadErrorCard title="Couldn't load providers" message="Please try your search again." /></div>; }
    return <div className="mx-auto max-w-[1440px] px-6 py-8 lg:px-14"><Link href="/categories" className="font-semibold text-primary-strong underline">All categories</Link><CategoryFiltersPanel category={{ slug: 'all', category: 'all', name: 'all categories', description: 'Search across property services.', provider_count: providers.length, from_price: null, icon_bg: null, badge: null, sort_order: 0 }} providers={providers} {...deriveCategoryFilters(providers)} /></div>;
  }

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 lg:px-14">
      <nav className="text-sm text-text-body">
        <Link href={homeHref} className="hover:text-[#1b1b1f]">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="font-medium text-[#1b1b1f]">Categories</span>
      </nav>

      <h1 className="mt-6 text-[36px] font-extrabold tracking-tight text-[#1b1b1f]">
        Every service category
      </h1>
      <p className="mt-2 max-w-2xl text-[#5f6b76]">
        Upfront prices and verified reviews across every property service on TenantVoice.
      </p>

      {categories.length === 0 ? (
        <div className="mt-10 rounded-[20px] border border-dashed border-[#c5cad3] bg-white p-10 text-center">
          <p className="font-semibold text-[#1b1b1f]">No categories yet</p>
          <p className="mt-2 text-sm text-[#5f6b76]">
            Categories aren’t available right now. Check back soon.
          </p>
        </div>
      ) : (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((item) => (
            <CategoryCard key={item.slug} category={item} headingLevel="h2" />
          ))}
        </div>
      )}
    </div>
  );
}
