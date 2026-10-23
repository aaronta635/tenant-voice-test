import Image from 'next/image';
import Link from 'next/link';
import { Suspense } from 'react';
import Card from '@/app/components/ui/Card';
import ButtonLink from '@/app/components/ui/ButtonLink';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import CategoryCard from '@/app/components/providers/CategoryCard';
import HomeSearch from '@/app/components/public/HomeSearch';
import { formatMoney, formatRating } from '@/app/lib/format';
import { api, safe, type Category, type PlatformStats, type Property, type PropertyStatus, type PublicProvider } from '@/app/lib/api';
import { PROVIDER_MARKETPLACE_HREF } from '@/app/lib/home-search';
import { getSessionRole } from '@/app/lib/session-role';
import {
  providerImage,
  providerLocation,
  providerName,
  providerPriceLabel,
} from '@/app/lib/provider-view';

export const metadata = {
  title: { absolute: 'TenantVoice — Rent, list and maintain property with confidence' },
  description:
    'Find a rental, list a property or offer property services. TenantVoice connects tenants, landlords and service providers through reviews and transparent profiles.',
};

export const dynamic = 'force-dynamic';

const ROLES = [
  {
    title: 'Tenants',
    body: 'Find a rental, apply with one profile and review your tenancy.',
    cta: 'Join as a tenant',
    href: '/register?role=tenant',
    icon: 'tenant',
  },
  {
    title: 'Landlords',
    body: 'List properties, review applications and message applicants.',
    cta: 'Join as a landlord',
    href: '/register?role=landlord',
    icon: 'landlord',
  },
  {
    title: 'Service providers',
    body: 'Offer inspections, trades, cleaning and more at upfront prices.',
    cta: 'Join as a provider',
    href: '/register?role=service_provider',
    icon: 'provider',
  },
] as const;

const NETWORK_FEATURES = [
  'Message tenants, landlords and providers in one inbox',
  'Connect with the people you rent and work with',
  'Read reviews before you apply or book',
  'Compare upfront prices for property services',
];

const STATUS_LABELS: Record<PropertyStatus, string> = {
  available: 'Available',
  rented: 'Rented',
  off_market: 'Off market',
};

export default async function LandingPage() {
  // Each request starts now and each section waits only for its own, so the
  // search renders at once and one failing source empties one section.
  const categories = safe<Category[] | null>(api.categories.list(), null);
  const providers = safe<PublicProvider[] | null>(api.providers.listPublic({ sort: 'rating', limit: 8 }), null);
  const stats = safe<PlatformStats | null>(api.content.platformStats(), null);
  const listings = safe<Property[] | null>(api.properties.listPublic({ sort: 'newest', limit: 4 }), null);
  // Members see this page inside their own workspace, so they are not asked to join.
  const signedIn = (await getSessionRole()) !== null;

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
        <div className="relative mx-auto grid max-w-[1440px] gap-10 px-6 pt-10 pb-16 xl:grid-cols-[1fr_480px] lg:gap-8 lg:px-14 lg:pt-16 lg:pb-20">
          <div className="flex min-w-0 flex-col justify-center">
            <h1 className="max-w-[780px] font-heading text-[40px] leading-[1.05] font-extrabold tracking-[-1.6px] text-[#1b1b1f] sm:text-[52px] lg:text-[60px] lg:leading-[64px]">
              Rent, list and maintain{' '}
              <span className="text-primary-strong sm:block">property with confidence.</span>
            </h1>
            <p className="mt-5 max-w-[560px] text-lg leading-[1.55] text-[#5f6b76]">
              One platform for tenants, landlords and service providers. Find a rental, list a property or offer
              your services, with reviews and transparent profiles.
            </p>
            <HomeSearch />
            <div className="mt-5 flex flex-wrap gap-3">
              <ButtonLink href={PROVIDER_MARKETPLACE_HREF} variant="secondary">
                Find providers
              </ButtonLink>
              <ButtonLink href="/properties" variant="ghost">
                Browse rentals
              </ButtonLink>
            </div>
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
            {/* Real marketplace figures float over the photo once they load; the photo stands alone without them. */}
            <Suspense fallback={null}>
              {providers.then((list) => (list?.[0] ? <Spotlight provider={list[0]} /> : null))}
            </Suspense>
          </div>
        </div>
      </section>

      {/* The rental network */}
      <section id="network" className="mx-auto max-w-[1440px] px-6 py-16 lg:px-14">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold tracking-[0.12em] text-primary-strong uppercase">The rental network</p>
          <h2 className="mt-2 font-heading text-[32px] leading-tight font-extrabold tracking-tight text-[#1b1b1f]">
            Connect with everyone in your rental journey
          </h2>
          <p className="mt-3 text-[#5f6b76]">
            TenantVoice is more than listings. Tenants, landlords and service providers build a profile, connect
            and message each other in one place.
          </p>
        </div>
        <div className="mt-10 grid items-start gap-6 lg:grid-cols-2">
          <ul className="space-y-4">
            {ROLES.map((role) => (
              <li key={role.title}>
                <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-primary-strong">
                    <RoleIcon name={role.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-[#1b1b1f]">{role.title}</h3>
                    <p className="mt-1 text-sm text-[#5f6b76]">{role.body}</p>
                  </div>
                  {signedIn ? null : (
                    <ButtonLink href={role.href} variant="secondary" size="sm" className="shrink-0">
                      {role.cta}
                    </ButtonLink>
                  )}
                </Card>
              </li>
            ))}
          </ul>
          <Card className="p-6">
            <h3 className="font-heading text-lg font-bold text-[#1b1b1f]">What members do on TenantVoice</h3>
            <ul className="mt-4 space-y-3">
              {NETWORK_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm text-[#565d6d]">
                  <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#e6f4ed] text-[11px] font-bold text-success">
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {/* Categories */}
      <section id="categories" className="mx-auto max-w-[1440px] px-6 py-16 lg:px-14">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-primary-strong uppercase">Browse by category</p>
            <h2 className="mt-2 max-w-2xl font-heading text-[32px] leading-tight font-extrabold tracking-tight text-[#1b1b1f]">
              Whatever your property needs, there&apos;s a pro for it.
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-text-body">
              Inspectors, agents, tradies, cleaners and more, with upfront prices and clear scopes. Badges show
              the checks each provider has passed.
            </p>
          </div>
          <Link href={PROVIDER_MARKETPLACE_HREF} className="shrink-0 text-sm font-semibold text-primary-strong hover:underline">
            All categories →
          </Link>
        </div>
        <Suspense fallback={<SectionLoading label="Loading categories…" />}>
          {categories.then((list) => <CategoryGrid categories={list} />)}
        </Suspense>
      </section>

      {/* Rentals */}
      <section id="rentals" className="mx-auto max-w-[1440px] px-6 py-16 lg:px-14">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-heading text-[32px] leading-tight font-extrabold tracking-tight text-[#1b1b1f]">
              New rental listings
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-text-body">
              Every listing shows the weekly rent, bond and inspection times up front.
            </p>
          </div>
          <Link href="/properties" className="shrink-0 text-sm font-semibold text-primary-strong hover:underline">
            View all rentals →
          </Link>
        </div>
        <Suspense fallback={<SectionLoading label="Loading rentals…" />}>
          {listings.then((list) => <ListingGrid listings={list} />)}
        </Suspense>
      </section>

      {/* Trust */}
      <section id="trust" className="bg-primary-strong text-white">
        <div className="mx-auto max-w-[1440px] px-6 py-16 lg:px-14 lg:py-20">
          <div className="max-w-2xl">
            <h2 className="font-heading text-[36px] leading-tight font-extrabold tracking-tight">
              Verified rental reviews. Trusted connections.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-white">
              TenantVoice connects tenants, landlords and service providers through ratings, structured reviews
              and transparent profiles. Provider ratings come only from clients who booked through TenantVoice.
            </p>
          </div>
          {/* Figures are left out rather than invented when the API cannot be reached. */}
          <Suspense fallback={<p role="status" className="mt-8 text-sm text-white">Loading platform figures…</p>}>
            {Promise.all([categories, providers, stats]).then(([list, people, figures]) => (
              <TrustFigures categoryCount={list?.length ?? null} providers={people ?? []} stats={figures} />
            ))}
          </Suspense>
        </div>
      </section>

      {signedIn ? null : (
        <section className="mx-auto max-w-[1440px] px-6 py-20 text-center lg:px-14">
          <h2 className="font-heading text-[32px] leading-tight font-extrabold tracking-tight text-[#1b1b1f]">
            Join the rental network
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[#5f6b76]">
            Create an account as a tenant, landlord or service provider and set up your profile.
          </p>
          {/* A sign-up without an account type opens as a provider's, so each button names one. */}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {ROLES.map((role) => (
              <ButtonLink key={role.title} href={role.href} size="lg">
                {role.cta}
              </ButtonLink>
            ))}
          </div>
          <p className="mt-6 text-sm text-[#5f6b76]">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-primary-strong hover:underline">
              Sign in
            </Link>
          </p>
        </section>
      )}
    </>
  );
}

/** The top-rated provider over the hero photo, with its cheapest service. */
function Spotlight({ provider }: { provider: PublicProvider }) {
  return (
    <>
      <div className="absolute top-8 -left-2 w-[260px] rounded-[18px] border border-[#efeff2] bg-white p-[18px] shadow-[0_20px_20px_rgba(14,42,72,0.14)] sm:-left-10">
        <div className="flex items-start gap-3">
          <div className="relative size-11 shrink-0 overflow-hidden rounded-full bg-[#eeeffd]">
            <Image
              src={providerImage(provider)}
              alt={provider.profiles?.avatar_url ? providerName(provider) : 'No provider photo yet'}
              fill
              className="object-cover"
              sizes="44px"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[#1b1b1f]">{providerName(provider)}</p>
            <p className="text-xs text-text-body">{provider.category_name ?? 'Property services'}</p>
            <p className="mt-2 text-xs text-[#5f6b76]">
              ★ {formatRating(provider.rating_avg, provider.review_count)} · {provider.review_count}{' '}
              {provider.review_count === 1 ? 'review' : 'reviews'}
            </p>
            {provider.availability_note ? (
              <div className="mt-2 rounded-[10px] bg-[#eeeffd] px-2.5 py-2 text-xs font-semibold text-[#0e2a48]">
                Availability: <span className="font-bold">{provider.availability_note}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {provider.from_price !== null ? (
        <div className="absolute right-0 -bottom-4 w-[280px] rounded-[18px] border border-[#efeff2] bg-white p-4 shadow-[0_20px_20px_rgba(14,42,72,0.14)] sm:right-2">
          <div className="flex items-start gap-3">
            <div className="flex size-8 items-center justify-center rounded-[10px] bg-[#e6f4ed] text-base font-extrabold text-[#1b7c4f]">
              ✓
            </div>
            <div>
              <p className="text-xs text-text-body">Upfront price, no quote games</p>
              <p className="text-sm font-bold text-[#1b1b1f]">
                {provider.category_name} · {priceWithUnit(provider)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex justify-between border-t border-[#f4f4f8] pt-2 text-xs">
            <span className="text-[#5f6b76]">{provider.service_count} services listed</span>
            <span className="font-semibold text-[#0e2a48]">{providerLocation(provider)}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** "$85 per hour" / "from $85" / "$129": the cheapest service on its own pricing terms. */
function priceWithUnit(provider: PublicProvider): string {
  const price = providerPriceLabel(provider);
  if (provider.price_unit === 'per hour') return `${price} per hour`;
  if (provider.price_unit === 'from') return `from ${price}`;
  return price;
}

function CategoryGrid({ categories }: { categories: Category[] | null }) {
  if (!categories) {
    return <LoadErrorCard title="Couldn't load categories" message="Please try again to see the service categories." />;
  }
  if (categories.length === 0) {
    return <EmptyState title="No categories yet" body="No service categories are listed yet. Check back soon." />;
  }
  return (
    <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((category) => (
        <CategoryCard key={category.slug} category={category} />
      ))}
    </div>
  );
}

function ListingGrid({ listings }: { listings: Property[] | null }) {
  if (!listings) {
    return <LoadErrorCard title="Couldn't load rentals" message="Please try again to see the latest listings." />;
  }
  if (listings.length === 0) {
    return <EmptyState title="No rentals listed yet" body="New listings appear here as landlords publish them." />;
  }
  return (
    <ul className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {listings.map((property) => (
        <li key={property.id}>
          <ListingCard property={property} />
        </li>
      ))}
    </ul>
  );
}

/** A listing as signed-out visitors may see it: the suburb, never the street address. */
function ListingCard({ property }: { property: Property }) {
  const photo = property.photo_urls?.[0];
  const area = [property.suburb, property.state, property.postcode].filter(Boolean).join(' ');
  return (
    <Link
      href={`/properties/${property.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-[20px] border border-[#efeff2] bg-white shadow-[0_1px_1px_rgba(14,42,72,0.04)] transition-shadow hover:shadow-[0_8px_24px_rgba(14,42,72,0.08)]"
    >
      <div className="relative h-44 bg-surface">
        {photo ? (
          <Image src={photo} alt="" fill unoptimized sizes="(min-width: 1280px) 320px, (min-width: 640px) 50vw, 100vw" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-body">No photo yet</div>
        )}
        <span className="absolute top-3 left-3 rounded-full bg-white px-3 py-1 text-xs font-bold text-primary-strong">
          {STATUS_LABELS[property.status]}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="font-heading text-xl font-bold text-[#1b1b1f]">
          {formatMoney(property.price)} <span className="text-sm font-medium text-text-body">per week</span>
        </p>
        <h3 className="mt-1 font-semibold text-[#1b1b1f] group-hover:underline">{property.title}</h3>
        {area ? <p className="mt-1 text-sm text-text-body">{area}</p> : null}
        <p className="mt-auto pt-3 text-xs font-semibold text-text-body">
          {roomCount(property.bedrooms, 'bed')} · {roomCount(property.bathrooms, 'bath')} · {property.parking ?? 0} parking
        </p>
      </div>
    </Link>
  );
}

/** "1 bed", "3 beds", or "— beds" when the listing leaves it blank. */
function roomCount(value: number | null, room: string) {
  return value === null ? `— ${room}s` : `${value} ${room}${value === 1 ? '' : 's'}`;
}

function TrustFigures({ categoryCount, providers, stats }: {
  categoryCount: number | null;
  providers: PublicProvider[];
  stats: PlatformStats | null;
}) {
  // The verification stack advertised here is the set of checks providers have
  // actually cleared, not a fixed marketing list.
  const trustChecks = Array.from(new Set(providers.flatMap((provider) => provider.verifications))).sort();
  // Without reviews the API reports a 0.0 rating and 0% satisfaction, which
  // would read as bad scores rather than "not rated yet".
  const hasReviews = !!stats && stats.review_count > 0;
  const figures = stats
    ? [
        {
          value: stats.verified_providers.toLocaleString(),
          label: 'Verified providers',
          sub: categoryCount === null
            ? 'Listed on TenantVoice'
            : `Across ${categoryCount} service ${categoryCount === 1 ? 'category' : 'categories'}`,
        },
        { value: stats.jobs_completed.toLocaleString(), label: 'Jobs completed', sub: 'Bookings marked complete on TenantVoice' },
        ...(hasReviews
          ? [
              { value: `${stats.average_rating.toFixed(1)} ★`, label: 'Average rating', sub: `From ${stats.review_count.toLocaleString()} verified reviews` },
              { value: `${stats.satisfaction_pct}%`, label: 'Client satisfaction', sub: 'Reviews rated 4 stars or better' },
            ]
          : []),
      ]
    : [];

  return (
    <>
      {trustChecks.length > 0 ? (
        <ul className="mt-8 flex flex-wrap gap-2" aria-label="Checks providers have passed">
          {trustChecks.map((check) => (
            <li key={check} className="rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold text-primary-strong">
              ✓ {check}
            </li>
          ))}
        </ul>
      ) : null}
      {figures.length > 0 ? (
        <div className="mt-12 grid gap-8 sm:grid-cols-2 xl:grid-cols-4">
          {figures.map((figure) => (
            <div key={figure.label}>
              <p className="text-[40px] font-extrabold tracking-tight">{figure.value}</p>
              <p className="mt-1 font-semibold">{figure.label}</p>
              <p className="text-sm text-white">{figure.sub}</p>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

function SectionLoading({ label }: { label: string }) {
  return (
    <div className="mt-10">
      <p role="status" className="text-sm text-text-body">{label}</p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-40 rounded-[20px] border border-[#efeff2] bg-white" />
        ))}
      </div>
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

function RoleIcon({ name }: { name: (typeof ROLES)[number]['icon'] }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {name === 'tenant' ? (
        <>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
        </>
      ) : name === 'landlord' ? (
        <>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9v11h14V9M10 20v-6h4v6" />
        </>
      ) : (
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
      )}
    </svg>
  );
}
