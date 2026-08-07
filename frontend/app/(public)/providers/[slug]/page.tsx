import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import BookingCard from '@/app/components/providers/BookingCard';
import { api, ApiError, safe } from '@/app/lib/api';
import { formatDate, formatMoney } from '@/app/lib/format';
import {
  providerContactName,
  providerFirstName,
  providerImage,
  providerLocation,
  providerName,
  providerServiceAreaLabel,
  providerYearsLabel,
} from '@/app/lib/provider-view';
import { getRoleHomeHref } from '@/app/lib/session-role';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function ProviderProfilePage({ params }: Props) {
  const { slug } = await params;

  let provider;
  try {
    provider = await api.providers.getPublic(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [services, reviews, availability, portfolio, homeHref] = await Promise.all([
    safe(api.providers.services(provider.id), []),
    safe(api.providers.reviews(provider.id), []),
    safe(api.providers.availability(provider.id), []),
    safe(api.providers.portfolio(provider.id), []),
    getRoleHomeHref(),
  ]);

  const name = providerName(provider);
  const gallery = [
    ...(provider.gallery_urls ?? []),
    ...portfolio.map((item) => item.image_url),
  ].filter((src, index, all) => all.indexOf(src) === index);

  const facts: [string, string][] = [
    ['Experience', providerYearsLabel(provider)],
    ['Service area', providerServiceAreaLabel(provider)],
    ['Response time', provider.response_time ?? '—'],
    ['Languages', provider.languages?.join(', ') ?? '—'],
  ];

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 lg:px-14">
      <nav className="text-sm text-[#8c97a2]">
        <Link href={homeHref} className="hover:text-[#1b1b1f]">
          Home
        </Link>
        <span className="mx-2">/</span>
        {provider.category_slug ? (
          <Link href={`/categories/${provider.category_slug}`} className="hover:text-[#1b1b1f]">
            {provider.category_name}
          </Link>
        ) : (
          <span>Providers</span>
        )}
        <span className="mx-2">/</span>
        <span className="font-medium text-[#1b1b1f]">{name}</span>
      </nav>

      {/* Photo collage */}
      {gallery.length > 0 ? (
        <div className="relative mt-6 grid h-[360px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-[24px] sm:h-[420px]">
          <div className="relative col-span-2 row-span-2">
            <Image src={gallery[0]} alt="" fill className="object-cover" sizes="50vw" priority />
          </div>
          {gallery.slice(1, 5).map((src, i) => (
            <div key={`${src}-${i}`} className="relative">
              <Image src={src} alt="" fill className="object-cover" sizes="25vw" />
              {i === 3 && gallery.length > 5 ? (
                <span className="absolute right-3 bottom-3 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#1b1b1f] shadow">
                  ⊞ {gallery.length} photos
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_360px]">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="max-w-xl text-[36px] leading-tight font-extrabold tracking-tight text-[#1b1b1f]">
                {name}
                {provider.headline ? ` — ${provider.headline}` : ''}
              </h1>
              <p className="mt-3 text-sm text-[#5f6b76]">
                <span className="font-bold text-[#0e2a48]">
                  ★ {provider.rating_avg.toFixed(2)}
                </span>
                <span className="mx-1.5">·</span>
                {provider.review_count} reviews
                <span className="mx-1.5">·</span>
                {providerLocation(provider)}
                <span className="mx-1.5">·</span>
                member since {formatDate(provider.created_at)}
              </p>
              {provider.is_online ? (
                <p className="mt-2 text-sm font-semibold text-[#1b7c4f]">● Online now</p>
              ) : null}
            </div>
          </div>

          {provider.verifications.length > 0 ? (
            <div className="mt-6 rounded-[18px] border border-[#efeff2] bg-white p-5">
              <p className="text-sm font-bold text-[#0e2a48]">Verified by TenantVoice</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {provider.verifications.map((v) => (
                  <span
                    key={v}
                    className="rounded-full bg-[#eeeffd] px-3 py-1 text-xs font-semibold text-[#0e2a48]"
                  >
                    ✓ {v}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <section className="mt-10">
            <h2 className="text-xl font-extrabold text-[#1b1b1f]">
              About {providerFirstName(provider)}
            </h2>
            <div className="mt-4 flex gap-4">
              <div className="relative size-14 shrink-0 overflow-hidden rounded-full bg-[#eeeffd]">
                <Image
                  src={providerImage(provider)}
                  alt={providerContactName(provider)}
                  fill
                  className="object-cover"
                  sizes="56px"
                />
              </div>
              <div className="space-y-3 text-sm leading-relaxed text-[#5f6b76]">
                {provider.tagline ? (
                  <p className="font-semibold text-[#1b1b1f]">{provider.tagline}</p>
                ) : null}
                <p>{provider.bio ?? 'This provider has not written a bio yet.'}</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {facts.map(([label, value]) => (
                <div key={label} className="rounded-[14px] border border-[#efeff2] bg-white p-3">
                  <p className="text-xs text-[#8c97a2]">{label}</p>
                  <p className="mt-1 text-sm font-bold text-[#1b1b1f]">{value}</p>
                </div>
              ))}
            </div>

            {provider.specialties && provider.specialties.length > 0 ? (
              <div className="mt-6">
                <p className="text-sm font-bold text-[#1b1b1f]">Specialties</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {provider.specialties.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-[#f4f4f8] px-3 py-1 text-xs font-semibold text-[#5f6b76]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="mt-12">
            <div className="flex items-end justify-between gap-4">
              <h2 className="text-xl font-extrabold text-[#1b1b1f]">Services offered</h2>
              <span className="text-sm font-semibold text-[#8c97a2]">
                {services.length} listed
              </span>
            </div>
            {services.length === 0 ? (
              <p className="mt-5 rounded-[20px] border border-dashed border-[#c5cad3] bg-white p-8 text-center text-sm text-[#5f6b76]">
                No fixed-price services published yet.
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                {services.map((service) => (
                  <article
                    key={service.id}
                    className="rounded-[20px] border border-[#efeff2] bg-white p-5 shadow-[0_1px_1px_rgba(14,42,72,0.04)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-xl">
                        <h3 className="text-lg font-bold text-[#1b1b1f]">{service.title}</h3>
                        {service.description ? (
                          <p className="mt-2 text-sm leading-relaxed text-[#5f6b76]">
                            {service.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold tracking-wide text-[#8c97a2] uppercase">
                          {service.pricing_type === 'hourly' ? 'Hourly rate' : 'Fixed price'}
                        </p>
                        <p className="text-2xl font-extrabold text-[#1b1b1f]">
                          {formatMoney(service.price)}
                        </p>
                        {service.duration_minutes ? (
                          <p className="text-xs text-[#8c97a2]">
                            approx. {service.duration_minutes} min
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {service.inclusions || service.exclusions ? (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        {service.inclusions ? (
                          <div>
                            <p className="text-xs font-bold text-[#1b1b1f]">Inclusions</p>
                            <ul className="mt-1 space-y-1 text-sm text-[#5f6b76]">
                              {service.inclusions.split(',').map((item) => (
                                <li key={item}>✓ {item.trim()}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {service.exclusions ? (
                          <div>
                            <p className="text-xs font-bold text-[#1b1b1f]">Exclusions</p>
                            <ul className="mt-1 space-y-1 text-sm text-[#5f6b76]">
                              {service.exclusions.split(',').map((item) => (
                                <li key={item}>– {item.trim()}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {service.cancellation_policy ? (
                      <p className="mt-4 text-xs text-[#8c97a2]">{service.cancellation_policy}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          {reviews.length > 0 ? (
            <section className="mt-12">
              <h2 className="text-xl font-extrabold text-[#1b1b1f]">
                Reviews ({provider.review_count})
              </h2>
              <div className="mt-5 space-y-4">
                {reviews.slice(0, 6).map((review) => (
                  <article
                    key={review.id}
                    className="rounded-[18px] border border-[#efeff2] bg-white p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold text-[#1b1b1f]">
                        {review.client_name ?? 'Verified client'}
                      </p>
                      <p className="text-sm font-semibold text-[#0e2a48]">
                        {'★'.repeat(review.rating)}
                        {'☆'.repeat(5 - review.rating)}
                      </p>
                    </div>
                    <p className="text-xs text-[#8c97a2]">
                      {[review.service_title, review.location, formatDate(review.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {review.comment ? (
                      <p className="mt-3 text-sm leading-relaxed text-[#5f6b76]">
                        {review.comment}
                      </p>
                    ) : null}
                    {review.provider_reply ? (
                      <div className="mt-3 rounded-[14px] bg-[#fafafe] p-3">
                        <p className="text-xs font-bold text-[#0e2a48]">
                          Reply from {providerFirstName(provider)}
                        </p>
                        <p className="mt-1 text-sm text-[#5f6b76]">{review.provider_reply}</p>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* Sticky booking card */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <BookingCard
            providerId={provider.id}
            providerFirstName={providerFirstName(provider)}
            services={services}
            availability={availability}
            availabilityNote={provider.availability_note}
          />
        </aside>
      </div>
    </div>
  );
}
