import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import PublicProfileView from '@/app/components/public-profiles/PublicProfileView';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { ApiError } from '@/app/lib/api';
import { getPublicProfile, isProfileId, publicProfileHref } from '@/app/lib/public-profiles';
import { getSessionRole } from '@/app/lib/session-role';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
};

// The metadata and the page share one request for the profile.
const loadProfile = cache((id: string) => getPublicProfile(id));

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  if (!isProfileId(slug)) return { title: 'Provider' };
  try {
    const profile = await loadProfile(slug);
    return { title: profile.display_name, description: profile.about ?? undefined };
  } catch {
    return { title: 'Profile' };
  }
}

/**
 * /public/<member id>: a tenant's or landlord's public profile. A provider's
 * id, or any other slug (the Taupe-style /public/<provider slug> links),
 * opens the provider's marketplace page as before.
 */
export default async function PublicProfilePage({ params }: Props) {
  const { slug } = await params;
  if (!isProfileId(slug)) redirect(`/providers/${encodeURIComponent(slug)}`);

  let profile;
  try {
    profile = await loadProfile(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
        <Link href="/search?type=profiles&role=all" className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
          Find profiles
        </Link>
        <h1 className="mt-4 mb-5 font-heading text-3xl font-bold">Public profile</h1>
        <LoadErrorCard title="Couldn't load this profile" message="This profile is unavailable right now. Please try again." />
      </div>
    );
  }
  if (profile.role === 'provider') redirect(publicProfileHref(profile));

  // Signed in or not, the API sends the same public fields; only the prompt differs.
  const signedIn = (await getSessionRole()) !== null;
  return <PublicProfileView profile={profile} signedIn={signedIn} />;
}
