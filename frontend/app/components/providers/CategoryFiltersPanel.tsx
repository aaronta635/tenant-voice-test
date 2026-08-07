'use client';

import { useMemo, useState } from 'react';
import ProviderCard from '@/app/components/providers/ProviderCard';
import type { Category, PublicProvider } from '@/app/lib/api';
import { providerLocation, providerName } from '@/app/lib/provider-view';

const SORT_OPTIONS = ['Recommended', 'Highest rated', 'Lowest price', 'Most reviews'] as const;
const VIEWS = ['Grid', 'List', 'Map'] as const;
const RATINGS = ['Any', '3.0+', '4.0+', '4.5+'] as const;

type Props = {
  category: Category;
  providers: PublicProvider[];
  /** Distinct service titles offered inside this category (from the database). */
  serviceTypes: string[];
  /** Distinct verification badges providers in this category actually hold. */
  verificationOptions: string[];
  /** Distinct availability notes providers in this category publish. */
  availabilityOptions: string[];
  priceCeiling: number;
  initialLocation?: string;
  initialSearch?: string;
};

export default function CategoryFiltersPanel({
  category,
  providers,
  serviceTypes,
  verificationOptions,
  availabilityOptions,
  priceCeiling,
  initialLocation = '',
  initialSearch = '',
}: Props) {
  const [serviceFilters, setServiceFilters] = useState<string[]>([]);
  const [rating, setRating] = useState<(typeof RATINGS)[number]>('Any');
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(priceCeiling);
  const [availability, setAvailability] = useState<string[]>([]);
  const [verifications, setVerifications] = useState<string[]>([]);
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number]>('Recommended');
  const [view, setView] = useState<(typeof VIEWS)[number]>('Grid');
  const [saved, setSaved] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [location, setLocation] = useState(initialLocation);
  const [search, setSearch] = useState(initialSearch);

  function clearAll() {
    setServiceFilters([]);
    setRating('Any');
    setPriceMin(0);
    setPriceMax(priceCeiling);
    setAvailability([]);
    setVerifications([]);
    setSort('Recommended');
    setSearch('');
  }

  function toggleInList(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  const filteredProviders = useMemo(() => {
    const minRating = rating === 'Any' ? 0 : Number.parseFloat(rating.replace('+', ''));
    const needle = search.trim().toLowerCase();
    const place = location.trim().toLowerCase();

    const next = providers.filter((provider) => {
      if (provider.rating_avg < minRating) return false;

      if (verifications.some((v) => !provider.verifications.includes(v))) return false;

      if (
        availability.length > 0 &&
        (!provider.availability_note || !availability.includes(provider.availability_note))
      ) {
        return false;
      }

      if (serviceFilters.length > 0) {
        const titles = provider.specialties ?? [];
        if (!serviceFilters.some((service) => titles.includes(service))) return false;
      }

      if (provider.from_price !== null) {
        if (provider.from_price < priceMin || provider.from_price > priceMax) return false;
      }

      if (place && !providerLocation(provider).toLowerCase().includes(place)) return false;

      if (needle) {
        const haystack = [
          providerName(provider),
          provider.tagline ?? '',
          provider.headline ?? '',
          ...(provider.specialties ?? []),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }

      return true;
    });

    return [...next].sort((a, b) => {
      switch (sort) {
        case 'Highest rated':
          return b.rating_avg - a.rating_avg;
        case 'Lowest price':
          return (a.from_price ?? Number.POSITIVE_INFINITY) - (b.from_price ?? Number.POSITIVE_INFINITY);
        case 'Most reviews':
          return b.review_count - a.review_count;
        default:
          return 0;
      }
    });
  }, [
    providers,
    rating,
    verifications,
    availability,
    serviceFilters,
    priceMin,
    priceMax,
    sort,
    search,
    location,
  ]);

  return (
    <>
      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[36px] font-extrabold tracking-tight text-[#1b1b1f]">
            {category.name}s near you
          </h1>
          <p className="mt-2 max-w-2xl text-[#5f6b76]">{category.description}</p>
        </div>
        <button
          type="button"
          onClick={() => setSaved((s) => !s)}
          aria-pressed={saved}
          className={`inline-flex h-10 w-fit items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
            saved
              ? 'border-primary bg-[#eeeffd] text-primary'
              : 'border-[#efeff2] bg-white text-[#1b1b1f] hover:border-primary'
          }`}
        >
          {saved ? '✓ Search saved' : 'Save this search'}
        </button>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="h-fit rounded-[20px] border border-[#efeff2] bg-white p-5 shadow-[0_1px_1px_rgba(14,42,72,0.04)]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#1b1b1f]">Filters</h2>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Clear all
            </button>
          </div>

          <FilterBlock title="Location">
            <label className="sr-only" htmlFor="filter-location">
              Location
            </label>
            <input
              id="filter-location"
              type="text"
              value={location}
              placeholder="Suburb or state"
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-[10px] border border-[#efeff2] bg-white px-3 py-2 text-sm font-semibold text-[#1b1b1f] outline-none focus:border-primary"
            />
          </FilterBlock>

          <FilterBlock title="Keywords">
            <label className="sr-only" htmlFor="filter-search">
              Keywords
            </label>
            <input
              id="filter-search"
              type="search"
              value={search}
              placeholder="What do you need done?"
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-[10px] border border-[#efeff2] bg-white px-3 py-2 text-sm text-[#1b1b1f] outline-none focus:border-primary"
            />
          </FilterBlock>

          {serviceTypes.length > 0 ? (
            <FilterBlock title="Service type">
              <div className="flex flex-wrap gap-1.5">
                {serviceTypes.map((type) => {
                  const selected = serviceFilters.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleInList(serviceFilters, type, setServiceFilters)}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                        selected
                          ? 'bg-[#eeeffd] text-[#0e2a48] ring-1 ring-primary/30'
                          : 'bg-[#f4f4f8] text-[#5f6b76] hover:bg-[#eeeffd]'
                      }`}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
            </FilterBlock>
          ) : null}

          <FilterBlock title="Rating">
            <div className="space-y-2" role="radiogroup" aria-label="Minimum rating">
              {RATINGS.map((r) => {
                const selected = rating === r;
                return (
                  <label
                    key={r}
                    className="flex cursor-pointer items-center gap-2 text-sm text-[#5f6b76]"
                  >
                    <input
                      type="radio"
                      name="rating"
                      value={r}
                      checked={selected}
                      onChange={() => setRating(r)}
                      className="peer sr-only"
                    />
                    <span
                      className={`flex size-4 items-center justify-center rounded-full border transition-colors ${
                        selected ? 'border-primary bg-primary' : 'border-[#c5cad3] bg-white'
                      }`}
                      aria-hidden
                    >
                      {selected ? <span className="size-1.5 rounded-full bg-white" /> : null}
                    </span>
                    {r === 'Any' ? 'Any' : `${r} stars`}
                  </label>
                );
              })}
            </div>
          </FilterBlock>

          <FilterBlock title="Price range">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-[#5f6b76]">
                <span>${priceMin}</span>
                <span>
                  ${priceMax}
                  {priceMax >= priceCeiling ? '+' : ''}
                </span>
              </div>
              <label className="block text-xs text-[#8c97a2]" htmlFor="price-min">
                Min
              </label>
              <input
                id="price-min"
                type="range"
                min={0}
                max={priceCeiling}
                step={10}
                value={priceMin}
                onChange={(e) => setPriceMin(Math.min(Number(e.target.value), priceMax))}
                className="w-full accent-primary"
              />
              <label className="block text-xs text-[#8c97a2]" htmlFor="price-max">
                Max
              </label>
              <input
                id="price-max"
                type="range"
                min={0}
                max={priceCeiling}
                step={10}
                value={priceMax}
                onChange={(e) => setPriceMax(Math.max(Number(e.target.value), priceMin))}
                className="w-full accent-primary"
              />
            </div>
          </FilterBlock>

          {availabilityOptions.length > 0 ? (
            <FilterBlock title="Availability">
              <div className="flex flex-wrap gap-1.5">
                {availabilityOptions.map((a) => {
                  const selected = availability.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleInList(availability, a, setAvailability)}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                        selected
                          ? 'bg-[#eeeffd] text-[#0e2a48] ring-1 ring-primary/30'
                          : 'bg-[#f4f4f8] text-[#5f6b76] hover:bg-[#eeeffd]'
                      }`}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
            </FilterBlock>
          ) : null}

          {verificationOptions.length > 0 ? (
            <FilterBlock title="Verification" last>
              {verificationOptions.map((v) => {
                const checked = verifications.includes(v);
                return (
                  <label
                    key={v}
                    className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-[#5f6b76] last:mb-0"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleInList(verifications, v, setVerifications)}
                      className="peer sr-only"
                    />
                    <span
                      className={`flex size-4 items-center justify-center rounded-[4px] border text-[10px] font-bold transition-colors ${
                        checked
                          ? 'border-primary bg-primary text-white'
                          : 'border-[#c5cad3] bg-white text-transparent'
                      }`}
                      aria-hidden
                    >
                      ✓
                    </span>
                    {v}
                  </label>
                );
              })}
            </FilterBlock>
          ) : null}
        </aside>

        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#5f6b76]">
              <span className="font-bold text-[#1b1b1f]">
                {filteredProviders.length} of {category.provider_count}
              </span>{' '}
              {category.name.toLowerCase()}s
              {location ? ` near ${location}` : ''}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={sortOpen}
                  onClick={() => setSortOpen((o) => !o)}
                  className="text-sm text-[#8c97a2]"
                >
                  Sort by{' '}
                  <span className="font-semibold text-[#1b1b1f]">
                    {sort} {sortOpen ? '▴' : '▾'}
                  </span>
                </button>
                {sortOpen ? (
                  <ul
                    role="listbox"
                    className="absolute right-0 z-20 mt-2 min-w-[180px] overflow-hidden rounded-[12px] border border-[#efeff2] bg-white py-1 shadow-[0_12px_24px_rgba(14,42,72,0.12)]"
                  >
                    {SORT_OPTIONS.map((option) => (
                      <li key={option}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={sort === option}
                          onClick={() => {
                            setSort(option);
                            setSortOpen(false);
                          }}
                          className={`flex w-full px-3 py-2 text-left text-sm ${
                            sort === option
                              ? 'bg-[#eeeffd] font-semibold text-primary'
                              : 'text-[#5f6b76] hover:bg-[#fafafe]'
                          }`}
                        >
                          {option}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div
                className="flex overflow-hidden rounded-[10px] border border-[#efeff2]"
                role="tablist"
                aria-label="Result view"
              >
                {VIEWS.map((v) => {
                  const selected = view === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setView(v)}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                        selected
                          ? 'bg-[#0e2a48] text-white'
                          : 'bg-white text-[#5f6b76] hover:bg-[#fafafe]'
                      }`}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {filteredProviders.length === 0 ? (
            <div className="mt-10 rounded-[20px] border border-dashed border-[#c5cad3] bg-white p-10 text-center">
              <p className="font-semibold text-[#1b1b1f]">No providers match these filters</p>
              <p className="mt-2 text-sm text-[#5f6b76]">
                Try clearing a few filters or widening the price range.
              </p>
              <button
                type="button"
                onClick={clearAll}
                className="mt-4 text-sm font-semibold text-primary hover:underline"
              >
                Clear all filters
              </button>
            </div>
          ) : view === 'List' ? (
            <div className="mt-6 space-y-3">
              {filteredProviders.map((provider) => (
                <div
                  key={provider.id}
                  className="overflow-hidden rounded-[16px] border border-[#efeff2] bg-white"
                >
                  <ProviderCard provider={provider} />
                </div>
              ))}
            </div>
          ) : view === 'Map' ? (
            <div className="mt-6 flex min-h-[420px] flex-col items-center justify-center rounded-[20px] border border-[#efeff2] bg-[#eef2f5] p-8 text-center">
              <p className="text-lg font-bold text-[#0e2a48]">Map view</p>
              <p className="mt-2 max-w-sm text-sm text-[#5f6b76]">
                Showing {filteredProviders.length} providers
                {location ? ` near ${location}` : ''}. Map tiles can be wired up later.
              </p>
              <div className="mt-6 grid w-full max-w-md gap-2">
                {filteredProviders.map((provider) => (
                  <div
                    key={provider.id}
                    className="rounded-[12px] border border-[#efeff2] bg-white px-3 py-2 text-left text-sm"
                  >
                    <span className="font-semibold text-[#1b1b1f]">{providerName(provider)}</span>
                    <span className="text-[#8c97a2]"> · {providerLocation(provider)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProviders.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FilterBlock({
  title,
  children,
  last = false,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`mt-5 pt-5 ${last ? '' : 'border-b border-[#f4f4f8]'} pb-5 last:pb-0`}>
      <h3 className="mb-3 text-sm font-bold text-[#1b1b1f]">{title}</h3>
      {children}
    </div>
  );
}
