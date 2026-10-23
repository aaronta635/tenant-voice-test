import { Suspense } from 'react';
import Link from 'next/link';
import BrandLogo from '@/app/components/BrandLogo';
import { api, safe } from '@/app/lib/api';
import { getRoleHomeHref } from '@/app/lib/session-role';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const homeHref = await getRoleHomeHref();
  // Real marketplace figures (the same ones the landing page shows); hidden
  // rather than invented if the API can't be reached. They stream in after
  // the form, so a slow API never holds up signing in or out.
  const platformStats = safe(api.content.platformStats(), null);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#fafafe]">
      {/* Same soft atmosphere as the public landing hero */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(ellipse 50% 45% at 15% 20%, rgba(238,239,253,1), transparent 55%), radial-gradient(ellipse 40% 50% at 90% 80%, rgba(240,241,254,0.95), transparent 60%)',
        }}
      />

      <header className="relative z-10 border-b border-[#efeff2]/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-[1120px] items-center justify-between px-6">
          <BrandLogo href={homeHref} size="md" />
          <Link
            href={homeHref}
            className="text-sm font-semibold text-[#5f6b76] transition-colors hover:text-[#1b1b1f]"
          >
            {homeHref === '/' ? '← Back to marketplace' : '← Back to workspace'}
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-72px)] max-w-[1120px] items-center gap-10 px-6 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-16">
        <aside className="hidden lg:block">
          <p className="inline-flex items-center rounded-full border border-[#efeff2] bg-white px-3 py-1 text-xs font-semibold text-[#5f6b76] shadow-[0_1px_1px_rgba(14,42,72,0.04)]">
            Property services, finally on your terms
          </p>
          <p
            className="mt-5 max-w-md text-[40px] leading-[1.1] font-extrabold tracking-[-1px] text-[#1b1b1f]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            One account for verified providers, bookings, and reviews.
          </p>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[#5f6b76]">
            Book property services, manage your properties, or build your service provider profile with a TenantVoice account.
          </p>

          <ul className="mt-8 space-y-3">
            {/* What the verification gates check (backend services/gates.py): an ABN is optional, so none is promised. */}
            {[
              'Owners verify their ID and ownership before a listing is published',
              'Providers verify their ID and insurance before going live',
              'Clear upfront pricing',
              'Reviews only from completed TenantVoice jobs',
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-[#5f6b76]">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#eeeffd] text-[11px] font-bold text-primary">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>

          <Suspense fallback={null}>
            {platformStats.then((stats) => stats ? (
              <div className="mt-10 flex flex-wrap gap-6 text-[#0e2a48]">
                <div>
                  <p className="text-2xl font-extrabold">{stats.verified_providers.toLocaleString('en-AU')}</p>
                  <p className="text-xs text-[#5f6b76]">verified providers</p>
                </div>
                {stats.review_count > 0 ? (
                  <div>
                    <p className="text-2xl font-extrabold">{stats.average_rating.toFixed(1)} ★</p>
                    <p className="text-xs text-[#5f6b76]">average rating</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-2xl font-extrabold">{stats.jobs_completed.toLocaleString('en-AU')}</p>
                  <p className="text-xs text-[#5f6b76]">jobs completed</p>
                </div>
              </div>
            ) : null)}
          </Suspense>
        </aside>

        <div className="w-full max-w-[460px] justify-self-center lg:justify-self-end">
          {children}
        </div>
      </main>

      <footer className="relative z-10 border-t border-[#efeff2] bg-white/70 py-4 text-center text-xs text-text-body">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-center gap-3 px-6">
          <span>© 2026 TenantVoice</span>
          <span className="opacity-40">·</span>
          <Link href="/privacy" className="hover:text-[#5f6b76]">
            Privacy
          </Link>
          <span className="opacity-40">·</span>
          <Link href="/terms" className="hover:text-[#5f6b76]">
            Terms
          </Link>
          <span className="opacity-40">·</span>
          <Link href="/contact" className="hover:text-[#5f6b76]">
            Support
          </Link>
        </div>
      </footer>
    </div>
  );
}
