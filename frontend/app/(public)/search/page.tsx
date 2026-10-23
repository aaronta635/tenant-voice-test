import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import ProfileSearch from '@/app/components/public-profiles/ProfileSearch';
import { searchTypeHref } from '@/app/lib/public-profiles';

export const metadata = {
  title: 'Find profiles',
  description: 'Browse tenants, landlords and service providers on TenantVoice before you sign in.',
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** /search?type=profiles&role=…&q=…: the profile search the homepage links to (R20, R22). */
export default async function SearchPage({ searchParams }: Props) {
  // Rentals and services have search pages of their own.
  const elsewhere = searchTypeHref(await searchParams);
  if (elsewhere) redirect(elsewhere);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 lg:px-10">
      <p className="text-xs font-semibold tracking-[0.12em] text-primary-strong uppercase">Profiles</p>
      <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-text-dark sm:text-h1">Find profiles</h1>
      <p className="mt-2 max-w-2xl text-text-body">
        Browse tenants, landlords and service providers. Anyone can see a public profile; contact
        details, documents and rental history stay private.
      </p>
      <Suspense fallback={<p role="status" className="mt-8 text-sm text-text-body">Loading profiles…</p>}>
        <ProfileSearch />
      </Suspense>
    </div>
  );
}
