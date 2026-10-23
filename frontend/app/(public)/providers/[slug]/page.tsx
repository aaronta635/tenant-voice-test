import Link from 'next/link';
import { notFound } from 'next/navigation';
import PublicProviderProfileView from '@/app/components/providers/PublicProviderProfileView';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { api, ApiError } from '@/app/lib/api';
import { providerName } from '@/app/lib/provider-view';
import { getPublicProfile } from '@/app/lib/public-profiles';
import { listingHref } from './listing-href';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
};

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  try {
    const provider = await api.providers.getPublic(slug);
    const name = providerName(provider);
    return {
      title: name,
      description: provider.tagline ?? provider.bio ?? undefined,
    };
  } catch {
    return { title: 'Provider' };
  }
}

export default async function ProviderProfilePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { from } = await searchParams;

  let provider;
  try {
    provider = await api.providers.getPublic(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <div className="mx-auto max-w-[1200px] p-6">
        <Link href="/categories" className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">All categories</Link>
        <h1 className="mt-4 mb-5 font-heading text-3xl font-bold">Provider profile</h1>
        <LoadErrorCard
          title="Couldn't load this provider"
          message="This profile is unavailable right now. Please try again."
        />
      </div>
    );
  }

  // The verified badge is the account's, as the provider's public profile
  // gives it (R23); a provider without one, or a failed read, shows none.
  const verified = getPublicProfile(provider.profile_id).then((profile) => profile.verified, () => false);
  let details;
  try {
    details = await Promise.all([api.providers.services(provider.id), api.providers.reviews(provider.id), api.providers.availability(provider.id), api.providers.portfolio(provider.id)]);
  } catch {
    return <div className="mx-auto max-w-[1200px] p-6"><h1 className="mb-5 font-heading text-3xl font-bold">{providerName(provider)}</h1><LoadErrorCard title="Couldn't load profile details" message="Please try again to view services, reviews and availability." /></div>;
  }
  const [services, reviews, availability, portfolio] = details;

  return (
    <PublicProviderProfileView
      provider={{ ...provider, verified: await verified }}
      services={services}
      reviews={reviews}
      availability={availability}
      portfolio={portfolio}
      listingHref={listingHref(from) ?? undefined}
    />
  );
}
