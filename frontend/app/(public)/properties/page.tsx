import PropertyMarketplace from '@/app/components/rental/PropertyMarketplace';

export const metadata = {
  title: 'Rental properties',
  description: 'Browse verified rental listings across NSW with transparent pricing and reviews.',
};

type Props = {
  // A link that repeats ?q gets an array.
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function PublicPropertiesPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q) ?? '';

  return (
    <div className="mx-auto w-full max-w-[1240px] px-6 py-10 lg:px-14">
      <div className="mb-8">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Rentals</p>
        <h1 className="mt-2 font-heading text-[34px] font-bold tracking-tight text-text-dark">
          Find your next rental
        </h1>
        <p className="mt-2 max-w-2xl text-text-body">
          Every listing shows the weekly rent, bond and inspection times up front. Sign in to
          apply or message the landlord.
        </p>
      </div>
      <PropertyMarketplace initialQuery={query} basePath="/properties" />
    </div>
  );
}
