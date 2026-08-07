import Image from 'next/image';
import Link from 'next/link';
import CityTabs from '@/app/components/public/CityTabs';
import CategoryCard from '@/app/components/providers/CategoryCard';
import ProviderCard from '@/app/components/providers/ProviderCard';
import { api, safe } from '@/app/lib/api';
import {
  providerImage,
  providerLocation,
  providerName,
  providerPriceLabel,
} from '@/app/lib/provider-view';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const [categories, providers, stats] = await Promise.all([
    safe(api.categories.list(), []),
    safe(api.providers.listPublic({ sort: 'rating', limit: 8 }), []),
    safe(api.content.platformStats(), null),
  ]);

  const featured = providers.slice(0, 4);
  const spotlight = providers[0] ?? null;
  const newestCategory = categories.find((category) => category.badge) ?? categories[0] ?? null;

  // The verification stack advertised here is the set of checks providers have
  // actually cleared, not a fixed marketing list.
  const trustChecks = Array.from(new Set(providers.flatMap((p) => p.verifications))).sort();

  // Location tabs come from where published providers actually operate.
  const cities = Array.from(
    new Set(providers.map((p) => p.profiles?.location).filter((c): c is string => !!c)),
  ).slice(0, 6);

  const trustStats = stats
    ? [
        {
          value: `${stats.verified_providers.toLocaleString()}`,
          label: 'Verified providers',
          sub: `Across ${stats.category_count} service categories`,
        },
        {
          value: stats.jobs_completed.toLocaleString(),
          label: 'Jobs completed',
          sub: 'Bookings marked complete on TenantVoice',
        },
        {
          value: `${stats.average_rating.toFixed(2)} ★`,
          label: 'Average rating',
          sub: `From ${stats.review_count.toLocaleString()} verified reviews`,
        },
        {
          value: `${stats.satisfaction_pct}%`,
          label: 'Customer satisfaction',
          sub: 'Reviews rated 4 stars or better',
        },
      ]
    : [];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            backgroundImage:
              'radial-gradient(ellipse 40% 50% at 85% 30%, rgba(238,239,253,1), transparent 60%), radial-gradient(ellipse 35% 45% at 10% 90%, rgba(240,241,254,0.9), transparent 70%)',
          }}
        />
        <div className="relative mx-auto grid max-w-[1440px] gap-10 px-6 pt-10 pb-16 lg:grid-cols-[1fr_480px] lg:gap-8 lg:px-14 lg:pt-16 lg:pb-20">
          <div className="flex flex-col justify-center">
            {newestCategory ? (
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#efeff2] bg-white px-3.5 py-1.5 shadow-[0_1px_1px_rgba(14,42,72,0.04)]">
                <span className="text-xs font-semibold text-[#5f6b76]">
                  {newestCategory.badge ? `${newestCategory.badge} — ` : ''}
                  {newestCategory.name} on TenantVoice
                </span>
                <span className="rounded-full bg-[#eeeffd] px-2.5 py-0.5 text-[11px] font-bold text-[#0e2a48]">
                  {newestCategory.provider_count} listed
                </span>
              </div>
            ) : null}

            <h1 className="mt-6 max-w-[620px] text-[40px] leading-[1.05] font-extrabold tracking-[-1.6px] text-[#1b1b1f] sm:text-[52px] lg:text-[60px] lg:leading-[62px]">
              Property services,
              <br />
              finally on your terms.
            </h1>

            <p className="mt-5 max-w-[520px] text-lg leading-[1.55] text-[#5f6b76]">
              Browse verified inspectors, agents, tradies and accountants near you. Fixed
              prices, instant booking, and reviews from real property owners — not anonymous
              strangers.
            </p>

            {stats ? (
              <div className="mt-8 flex flex-wrap gap-8">
                <HeroStat
                  value={stats.verified_providers.toLocaleString()}
                  label="verified providers"
                />
                <HeroStat value={stats.jobs_completed.toLocaleString()} label="jobs completed" />
                <HeroStat value={`${stats.average_rating.toFixed(2)} ★`} label="average rating" />
              </div>
            ) : null}
          </div>

          <div className="relative mx-auto w-full max-w-[480px] lg:mx-0">
            <div className="relative h-[320px] overflow-hidden rounded-[24px] bg-[#f1ece5] sm:h-[380px]">
              <Image
                src="/landing/hero.png"
                alt="Modern property at dusk"
                fill
                className="object-cover"
                priority
                sizes="480px"
              />
            </div>

            {spotlight ? (
              <div className="absolute top-8 -left-2 w-[260px] rounded-[18px] border border-[#efeff2] bg-white p-[18px] shadow-[0_20px_20px_rgba(14,42,72,0.14)] sm:-left-10">
                <div className="flex items-start gap-3">
                  <div className="relative size-11 shrink-0 overflow-hidden rounded-full bg-[#eeeffd]">
                    <Image
                      src={providerImage(spotlight)}
                      alt={providerName(spotlight)}
                      fill
                      className="object-cover"
                      sizes="44px"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-[#1b1b1f]">
                          {providerName(spotlight)}
                        </p>
                        <p className="text-xs text-[#8c97a2]">
                          {spotlight.category_name ?? 'Property services'}
                        </p>
                      </div>
                      {spotlight.is_online ? (
                        <span className="rounded-full bg-[#e6f4ed] px-2 py-0.5 text-[11px] font-bold text-[#1b7c4f]">
                          ● Online
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-[#5f6b76]">
                      ★ {spotlight.rating_avg.toFixed(2)} · {spotlight.review_count} reviews
                    </p>
                    {spotlight.availability_note ? (
                      <div className="mt-2 rounded-[10px] bg-[#eeeffd] px-2.5 py-2 text-xs font-semibold text-[#0e2a48]">
                        Availability:{' '}
                        <span className="font-bold">{spotlight.availability_note}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {spotlight && spotlight.from_price !== null ? (
              <div className="absolute right-0 -bottom-4 w-[280px] rounded-[18px] border border-[#efeff2] bg-white p-4 shadow-[0_20px_20px_rgba(14,42,72,0.14)] sm:right-2">
                <div className="flex items-start gap-3">
                  <div className="flex size-8 items-center justify-center rounded-[10px] bg-[#e6f4ed] text-base font-extrabold text-[#1b7c4f]">
                    ✓
                  </div>
                  <div>
                    <p className="text-xs text-[#8c97a2]">Fixed price, no quote games</p>
                    <p className="text-sm font-bold text-[#1b1b1f]">
                      {spotlight.category_name} · {providerPriceLabel(spotlight)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex justify-between border-t border-[#f4f4f8] pt-2 text-xs">
                  <span className="text-[#5f6b76]">{spotlight.service_count} services listed</span>
                  <span className="font-semibold text-[#0e2a48]">
                    {providerLocation(spotlight)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Search bar */}
        <div className="relative mx-auto max-w-[1440px] px-6 pb-16 lg:px-14">
          <form
            action="/categories"
            className="flex flex-col gap-3 rounded-[22px] border border-[#efeff2] bg-white p-3 shadow-[0_12px_16px_rgba(14,42,72,0.1)] lg:flex-row lg:items-center lg:gap-0 lg:p-3 lg:pl-7"
          >
            <SearchField
              label="LOCATION"
              name="location"
              defaultValue={spotlight ? providerLocation(spotlight) : ''}
              placeholder="Suburb or postcode"
              className="lg:min-w-[180px]"
            />
            <Divider />
            <SelectField
              label="CATEGORY"
              name="category"
              options={categories.map((category) => ({
                value: category.slug,
                label: category.name,
              }))}
              className="lg:min-w-[180px]"
            />
            <Divider />
            <SearchField
              label="KEYWORDS"
              name="search"
              defaultValue=""
              placeholder="What do you need done?"
              className="lg:min-w-[220px]"
            />
            <button
              type="submit"
              className="inline-flex h-[59px] shrink-0 items-center justify-center gap-2 rounded-[16px] bg-primary px-8 text-sm font-bold text-white shadow-[0_4px_6px_rgba(99,106,232,0.3)] transition-colors hover:bg-[#5258d4] lg:ml-3"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              Search providers
            </button>
          </form>
        </div>
      </section>

      {/* Categories */}
      <section id="categories" className="mx-auto max-w-[1440px] px-6 py-16 lg:px-14">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[32px] font-extrabold tracking-tight text-[#1b1b1f]">
              Browse by category
            </h2>
            <p className="mt-2 max-w-xl text-[#5f6b76]">
              Whatever your property needs — there&apos;s a verified pro for it.
            </p>
            <p className="mt-1 max-w-2xl text-sm text-[#8c97a2]">
              Every provider on TenantVoice is verified before they list. No bidding wars, no
              surprise quotes — just fixed prices and clear scopes.
            </p>
          </div>
          {newestCategory ? (
            <Link
              href={`/categories/${newestCategory.slug}`}
              className="text-sm font-semibold text-primary hover:underline"
            >
              All categories →
            </Link>
          ) : null}
        </div>

        {categories.length === 0 ? (
          <EmptyState
            title="No categories yet"
            body="Categories live in Supabase — run supabase/seed.sql (or add rows to service_categories) and they will appear here."
          />
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((category) => (
              <CategoryCard key={category.slug} category={category} />
            ))}
          </div>
        )}
      </section>

      {/* Featured */}
      <section className="mx-auto max-w-[1440px] px-6 py-16 lg:px-14">
        <p className="text-sm font-semibold text-primary">Featured this week</p>
        <h2 className="mt-1 text-[32px] font-extrabold tracking-tight text-[#1b1b1f]">
          Top-rated providers on TenantVoice.
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-[#8c97a2]">
          Ranked by verified customer rating across every completed booking.
        </p>

        <CityTabs cities={cities} />

        {featured.length === 0 ? (
          <EmptyState
            title="No published providers yet"
            body="Providers appear here once they publish a profile. Run supabase/seed.sql to load the demo marketplace."
          />
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        )}
      </section>

      {/* Trust */}
      <section id="how-it-works" className="bg-[#636ae8] text-white">
        <div className="mx-auto max-w-[1440px] px-6 py-16 lg:px-14 lg:py-20">
          <div className="max-w-2xl">
            <h2 className="text-[36px] leading-tight font-extrabold tracking-tight">
              Verification you can actually check.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-white/85">
              Providers clear identity, ABN, licence and insurance checks before they can list.
              Ratings come only from clients who booked through TenantVoice — no anonymous
              reviews, ever.
            </p>
          </div>

          {trustChecks.length > 0 ? (
            <div className="mt-8 flex flex-wrap gap-2">
              {trustChecks.map((check) => (
                <span
                  key={check}
                  className="rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-semibold backdrop-blur-sm"
                >
                  ✓ {check}
                </span>
              ))}
            </div>
          ) : null}

          {trustStats.length > 0 ? (
            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {trustStats.map((stat) => (
                <div key={stat.label}>
                  <p className="text-[40px] font-extrabold tracking-tight">{stat.value}</p>
                  <p className="mt-1 font-semibold">{stat.label}</p>
                  <p className="text-sm text-white/70">{stat.sub}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* CTA into category flow */}
      <section id="resources" className="mx-auto max-w-[1440px] px-6 py-20 text-center lg:px-14">
        <h2 className="text-[32px] font-extrabold tracking-tight text-[#1b1b1f]">
          Built for serious searches
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[#5f6b76]">
          Filter and sort the way you actually shop. Hover, refine, and book in minutes —
          without bouncing between five tabs.
        </p>
        {newestCategory ? (
          <Link
            href={`/categories/${newestCategory.slug}`}
            className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-8 text-sm font-bold text-white shadow-[0_4px_6px_rgba(99,106,232,0.3)] transition-colors hover:bg-[#5258d4]"
          >
            Browse {newestCategory.name}s
          </Link>
        ) : null}
      </section>
    </>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[26px] font-extrabold tracking-tight text-[#0e2a48]">{value}</p>
      <p className="text-[13px] text-[#8c97a2]">{label}</p>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-10 rounded-[20px] border border-dashed border-[#c5cad3] bg-white p-10 text-center">
      <p className="font-semibold text-[#1b1b1f]">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[#5f6b76]">{body}</p>
    </div>
  );
}

function SearchField({
  label,
  name,
  defaultValue,
  placeholder,
  className = '',
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col justify-center px-1 py-1 ${className}`}>
      <label
        htmlFor={`search-${name}`}
        className="text-[10px] font-bold tracking-[1px] text-[#8c97a2]"
      >
        {label}
      </label>
      <input
        id={`search-${name}`}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="truncate border-0 bg-transparent text-sm font-semibold text-[#1b1b1f] outline-none placeholder:font-normal placeholder:text-[#c5cad3]"
      />
    </div>
  );
}

function SelectField({
  label,
  name,
  options,
  className = '',
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col justify-center px-1 py-1 ${className}`}>
      <label
        htmlFor={`search-${name}`}
        className="text-[10px] font-bold tracking-[1px] text-[#8c97a2]"
      >
        {label}
      </label>
      <select
        id={`search-${name}`}
        name={name}
        className="truncate border-0 bg-transparent text-sm font-semibold text-[#1b1b1f] outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Divider() {
  return <div className="hidden h-9 w-px shrink-0 bg-[#f4f4f8] lg:block" aria-hidden />;
}
