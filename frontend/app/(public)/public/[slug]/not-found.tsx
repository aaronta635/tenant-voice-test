import Link from 'next/link';

/** One answer for a hidden member and a wrong link: it never says which. */
export default function ProfileNotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6">
      <h1 className="font-heading text-3xl font-bold text-text-dark sm:text-h1">Profile not found</h1>
      <p className="mt-4 text-text-body">This profile is not public, or the link is wrong.</p>
      <div className="mt-6 flex flex-wrap gap-4">
        <Link href="/search?type=profiles&role=all" className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
          Find profiles
        </Link>
        <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
          Go to home
        </Link>
      </div>
    </div>
  );
}
