'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import NoPhotoYet from '@/app/components/rental/NoPhotoYet';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import { api, ApiError, type Property, type PropertyStatus } from '@/app/lib/api';
import { listingPhoto } from '@/app/lib/listing-photo';
import { localityOf } from '@/app/lib/listings';
import { isRemoteImage } from '@/app/lib/remote-image';

const featureOptions = ['Pet friendly', 'Parking', 'Furnished', 'Garden', 'Bills included', 'Close to train'];
const statusOptions = ['Any status', 'Available', 'Rented', 'Off market'];
const availabilityOptions = ['Any time', 'This month', 'Next month'];
const sortOptions = ['Best match', 'Lowest rent', 'Highest rent', 'Most bedrooms'];

/** "1 bed", "2 beds", "— beds" when the listing does not say. */
const rooms = (count: number | null | undefined, room: string) => `${count ?? '—'} ${count === 1 ? room : `${room}s`}`;

const STATUS_FILTER_MAP: Record<string, PropertyStatus> = {
  Available: 'available',
  Rented: 'rented',
  'Off market': 'off_market',
};

const STATUS_LABEL_MAP: Record<PropertyStatus, string> = {
  available: 'Available',
  rented: 'Rented',
  off_market: 'Off market',
};

function formatAvailableDate(dateStr: string | null): string {
  if (!dateStr) return 'Contact landlord';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isInRelativeMonth(dateStr: string | null, monthOffset: number): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  return date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth();
}

/** Where a card's address comes from: the street for a signed-in member, else only the suburb. */
function addressLine(property: Property): string {
  return property.address_hidden === false ? property.address : localityOf(property) || property.address;
}

export default function PropertyMarketplace({
  initialQuery = '',
  basePath = '/tenant/properties',
}: {
  initialQuery?: string;
  /** Where a card opens its listing: the tenant workspace's page, or the public one. */
  basePath?: string;
}) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [queryInput, setQueryInput] = useState<string | null>(null);
  const query = queryInput ?? initialQuery;
  // null = no cap chosen yet, so nothing is hidden before the user touches the
  // slider. A fixed default silently hid every listing priced above it.
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [minBeds, setMinBeds] = useState('Any');
  const [minBaths, setMinBaths] = useState('Any');
  const [parking, setParking] = useState(false);
  const [status, setStatus] = useState('Any status');
  const [availability, setAvailability] = useState('Any time');
  const [sortBy, setSortBy] = useState('Best match');
  const [searchSaved, setSearchSaved] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const results = await api.properties.listPublic({ limit: 100 });
        if (!cancelled) {
          setProperties(results);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Unable to load properties right now.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // The slider has to reach the most expensive listing, otherwise that listing
  // can never be shown no matter where the user drags it.
  const priceCeiling = useMemo(() => {
    const highest = properties.reduce((max, p) => Math.max(max, p.price), 0);
    return Math.max(1000, Math.ceil(highest / 50) * 50);
  }, [properties]);

  const filtered = useMemo(() => {
    const normalised = query.trim().toLowerCase();
    const results = properties.filter((property) => {
      const amenities = property.amenities ?? [];
      const matchesText =
        !normalised ||
        `${property.title} ${addressLine(property)} ${property.suburb ?? ''} ${amenities.join(' ')}`
          .toLowerCase()
          .includes(normalised);

      const matchesBeds = minBeds === 'Any' || (property.bedrooms ?? 0) >= Number(minBeds);
      const matchesBaths = minBaths === 'Any' || (property.bathrooms ?? 0) >= Number(minBaths);
      const matchesParking = !parking || (property.parking ?? 0) > 0;
      const matchesStatus = status === 'Any status' || property.status === STATUS_FILTER_MAP[status];
      const matchesAvailability =
        availability === 'Any time' ||
        (availability === 'This month' && isInRelativeMonth(property.available_from, 0)) ||
        (availability === 'Next month' && isInRelativeMonth(property.available_from, 1));
      const matchesFeatures =
        selectedFeatures.length === 0 ||
        selectedFeatures.every((feature) =>
          feature === 'Parking'
            ? (property.parking ?? 0) > 0
            : amenities.some((item) => item.toLowerCase() === feature.toLowerCase()),
        );

      return (
        matchesText &&
        (maxPrice === null || property.price <= maxPrice) &&
        matchesBeds &&
        matchesBaths &&
        matchesParking &&
        matchesStatus &&
        matchesAvailability &&
        matchesFeatures
      );
    });

    return [...results].sort((a, b) => {
      if (sortBy === 'Lowest rent') return a.price - b.price;
      if (sortBy === 'Highest rent') return b.price - a.price;
      if (sortBy === 'Most bedrooms') return (b.bedrooms ?? 0) - (a.bedrooms ?? 0);
      return 0;
    });
  }, [availability, maxPrice, minBaths, minBeds, parking, properties, query, selectedFeatures, sortBy, status]);

  function toggleFeature(feature: string) {
    setSelectedFeatures((current) =>
      current.includes(feature)
        ? current.filter((item) => item !== feature)
        : [...current, feature],
    );
  }

  function resetFilters() {
    setQueryInput('');
    setMaxPrice(null);
    setMinBeds('Any');
    setMinBaths('Any');
    setParking(false);
    setStatus('Any status');
    setAvailability('Any time');
    setSortBy('Best match');
    setSelectedFeatures([]);
    setSearchSaved(false);
  }

  function saveSearch() {
    const payload = { query, maxPrice, minBeds, minBaths, parking, status, availability, sortBy, selectedFeatures };
    localStorage.setItem('tv_saved_property_search', JSON.stringify(payload));
    setSearchSaved(true);
    window.setTimeout(() => setSearchSaved(false), 2500);
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-[16px] border border-[#dee1e6] p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_180px] lg:items-end">
          <Input
            label="Search properties"
            placeholder="Suburb, street, or property name"
            value={query}
            onChange={(event) => setQueryInput(event.target.value)}
          />
          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.8px] text-[#565d6d]">
              <span>Max weekly rent</span>
              <span>{maxPrice === null ? 'Any' : `$${maxPrice}`}</span>
            </div>
            <input
              type="range"
              min="200"
              max={priceCeiling}
              step="10"
              value={maxPrice ?? priceCeiling}
              onChange={(event) => setMaxPrice(Number(event.target.value))}
              className="mt-4 w-full accent-[#636ae8]"
              aria-label="Maximum weekly rent"
            />
          </div>
          <SelectControl label="Sort by" value={sortBy} options={sortOptions} onChange={setSortBy} />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SelectControl label="Bedrooms" value={minBeds} options={['Any', '1', '2', '3', '4']} onChange={setMinBeds} />
          <SelectControl label="Bathrooms" value={minBaths} options={['Any', '1', '2']} onChange={setMinBaths} />
          <SelectControl label="Listing status" value={status} options={statusOptions} onChange={setStatus} />
          <SelectControl label="Availability" value={availability} options={availabilityOptions} onChange={setAvailability} />
          <label className="flex h-[46px] items-center gap-3 self-end rounded-[8px] border border-[#dee1e6] bg-white px-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={parking}
              onChange={(event) => setParking(event.target.checked)}
              className="accent-primary"
            />
            Parking required
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {featureOptions.map((feature) => {
            const active = selectedFeatures.includes(feature);
            return (
              <button
                key={feature}
                type="button"
                onClick={() => toggleFeature(feature)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'border-primary bg-[#f0f1ff] text-primary'
                    : 'border-[#dee1e6] bg-white text-[#565d6d] hover:border-primary/40'
                }`}
              >
                {feature}
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#eef0f4] pt-4">
          <p className="text-sm text-[#565d6d]">
            Showing <span className="font-semibold text-[#171a1f]">{filtered.length}</span> matching properties
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" className="h-10 rounded-[8px]" onClick={resetFilters}>
              Reset Filters
            </Button>
            <Button className="h-10 rounded-[8px]" onClick={saveSearch}>
              {searchSaved ? 'Search saved' : 'Save Search'}
            </Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center">
          <h2 className="font-heading text-xl font-semibold">Loading properties…</h2>
          <p className="mt-2 text-sm text-[#565d6d]">Fetching the latest listings from the marketplace.</p>
        </Card>
      ) : error ? (
        <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center">
          <h2 className="font-heading text-xl font-semibold">Couldn&apos;t load properties</h2>
          <p className="mt-2 text-sm text-[#565d6d]">{error}</p>
          <Button variant="secondary" className="mt-5 h-10 rounded-[8px]" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </Card>
      ) : properties.length === 0 ? (
        <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center">
          <h2 className="font-heading text-xl font-semibold">No properties available yet</h2>
          <p className="mt-2 text-sm text-[#565d6d]">Check back soon — new listings are added regularly.</p>
        </Card>
      ) : filtered.length > 0 ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {filtered.map((property) => {
            const photo = listingPhoto(property.photo_urls);
            return (
              <Link key={property.id} href={`${basePath}/${property.id}`}>
                <Card className="h-full overflow-hidden rounded-[16px] border border-[#dee1e6] transition hover:border-primary/40 hover:shadow-[0_12px_28px_rgba(23,26,31,0.10)]">
                  <div className="relative h-56 bg-[#f3f4f6]">
                    {photo ? (
                      <Image
                        src={photo}
                        alt=""
                        fill
                        sizes="(min-width: 1280px) 520px, 100vw"
                        className="object-cover"
                        unoptimized={isRemoteImage(photo)}
                      />
                    ) : (
                      <NoPhotoYet />
                    )}
                    <span className="absolute left-4 top-4 rounded-full bg-white px-3 py-1 text-xs font-bold text-primary shadow">
                      {STATUS_LABEL_MAP[property.status]}
                    </span>
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="font-heading text-xl font-bold">{property.title}</h2>
                        <p className="mt-1 text-sm text-[#565d6d]">{addressLine(property)}</p>
                      </div>
                      <p className="text-right font-heading text-2xl font-bold text-primary">
                        ${property.price}
                        <span className="block text-xs font-medium text-[#565d6d]">/week</span>
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-[#565d6d]">
                      <span>{rooms(property.bedrooms, 'bed')}</span>
                      <span>·</span>
                      <span>{rooms(property.bathrooms, 'bath')}</span>
                      <span>·</span>
                      <span>{property.parking ?? 0} parking</span>
                      <span>·</span>
                      <span>Available {formatAvailableDate(property.available_from)}</span>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center">
          <h2 className="font-heading text-xl font-semibold">No properties match these filters</h2>
          <p className="mt-2 text-sm text-[#565d6d]">Try widening the rent, features, or availability options.</p>
          <Button variant="secondary" className="mt-5 h-10 rounded-[8px]" onClick={resetFilters}>
            Reset Filters
          </Button>
        </Card>
      )}
    </div>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#565d6d]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-[6px] h-[46px] w-full rounded-[8px] border border-[#dee1e6] bg-white px-3 text-sm text-[#171a1f] outline-none focus:border-transparent focus:ring-2 focus:ring-primary"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
