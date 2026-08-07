import Link from 'next/link';
import { redirect } from 'next/navigation';
import CategoryCard from '@/app/components/providers/CategoryCard';
import { api, safe } from '@/app/lib/api';
import { getRoleHomeHref } from '@/app/lib/session-role';

export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<{ category?: string; location?: string; search?: string }>;
};

export default async function CategoriesIndexPage({ searchParams }: Props) {
  const { category, location, search } = await searchParams;

  // The landing-page search form posts here; hand off to the category listing.
  if (category) {
    const query = new URLSearchParams();
    if (location) query.set('location', location);
    if (search) query.set('search', search);
    const qs = query.toString();
    redirect(`/categories/${category}${qs ? `?${qs}` : ''}`);
  }

  const [categories, homeHref] = await Promise.all([
    safe(api.categories.list(), []),
    getRoleHomeHref(),
  ]);

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 lg:px-14">
      <nav className="text-sm text-[#8c97a2]">
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
        Fixed prices and verified reviews across every property service on TenantVoice.
      </p>

      {categories.length === 0 ? (
        <div className="mt-10 rounded-[20px] border border-dashed border-[#c5cad3] bg-white p-10 text-center">
          <p className="font-semibold text-[#1b1b1f]">No categories yet</p>
          <p className="mt-2 text-sm text-[#5f6b76]">
            Categories come from the service_categories table — run supabase/seed.sql to load them.
          </p>
        </div>
      ) : (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((item) => (
            <CategoryCard key={item.slug} category={item} />
          ))}
        </div>
      )}
    </div>
  );
}
