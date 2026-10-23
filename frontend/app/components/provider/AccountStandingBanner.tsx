import Link from 'next/link';
import { outOfWork, type AccountStanding } from '@/app/lib/account-standing';

const HEADINGS = { suspended: 'Your account is suspended', inactive: "Your account isn't active" };

/**
 * What a provider whose account is suspended (or otherwise not active) can
 * still do in the workspace, and how to reach support (tracker assumption
 * #14): they finish the jobs in progress and read their past work, but the
 * gates refuse new work. Nothing shows for any other standing, or before
 * it loads. It sits above each page's own heading, so its title is not a
 * heading of its own: it names the region instead.
 */
export default function AccountStandingBanner({ state }: { state: AccountStanding | null }) {
  if (!outOfWork(state)) return null;
  return (
    <section aria-labelledby="account-standing-title" className="mb-6 rounded-xl border border-warning bg-white p-4 text-sm print:hidden">
      <p id="account-standing-title" className="font-heading text-base font-semibold text-text-dark">{HEADINGS[state]}</p>
      <p className="mt-1 text-text-body">
        Your profile is hidden from the marketplace. You can finish the jobs in progress, and read your past
        bookings, messages and invoices. Until it is restored you can&apos;t confirm or start bookings, take on
        repairs or go live, and you can message only the people of a job in progress.
      </p>
      <Link href="/contact" className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
        Contact TenantVoice support
      </Link>
    </section>
  );
}
