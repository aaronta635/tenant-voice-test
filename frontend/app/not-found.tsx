import Link from 'next/link';

export default function NotFound() {
  return <main className="mx-auto w-full max-w-xl px-6 py-16">
    <h1 className="font-heading text-h1 font-bold">Page not found</h1>
    <p className="mt-4 text-text-body">This address may have changed, or the page is no longer available.</p>
    <div className="mt-6 flex flex-wrap gap-4">
      <Link href="/" className="text-primary-strong underline">Go to home</Link>
      <Link href="/categories" className="text-primary-strong underline">Browse providers</Link>
    </div>
  </main>;
}
