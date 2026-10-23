'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PlusIcon } from '@/app/components/owner/icons';
import OwnerListingCard from '@/app/components/rental/OwnerListingCard';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import FilterChip from '@/app/components/ui/FilterChip';
import Input from '@/app/components/ui/Input';
import { api, ApiError, type ListingStatus, type Property } from '@/app/lib/api';
import { LISTING_STATUS_LABELS, listingStatusOf } from '@/app/lib/listings';
import { setSearchParams } from '@/app/lib/page-url';

// The status tabs, the ones tenants can find first. "all" shows every listing.
const FILTERS: (ListingStatus | 'all')[] = ['all', 'published', 'applications_closed', 'paused', 'draft', 'leased'];

function isFilter(value: string | null): value is ListingStatus | 'all' {
  return FILTERS.includes(value as ListingStatus | 'all');
}

function emptyMessage(search: string, status: ListingStatus | 'all'): string {
  const among = status === 'all' ? '' : ` among your ${LISTING_STATUS_LABELS[status].toLowerCase()} listings`;
  if (search) return `No properties match “${search}”${among}.`;
  return status === 'all' ? 'No properties to show.' : `You have no ${LISTING_STATUS_LABELS[status].toLowerCase()} listings.`;
}

export default function PropertyListingsPage() {
  return (
    <Suspense fallback={<p role="status" className="text-text-body">Loading your properties…</p>}>
      <PropertyListings />
    </Suspense>
  );
}

function PropertyListings() {
  const searchParams = useSearchParams();
  const statusParam = searchParams.get('status');
  const status = isFilter(statusParam) ? statusParam : 'all';
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [searchInput, setSearchInput] = useState<string | null>(null);
  const search = searchInput ?? searchParams.get('q') ?? '';

  useEffect(() => {
    let active = true;
    api.properties
      .listMine()
      .then((data) => {
        if (!active) return;
        setProperties(data);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load your properties. Please try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const counts = useMemo(() => {
    const tally = new Map<ListingStatus | 'all', number>([['all', properties.length]]);
    for (const property of properties) {
      const key = listingStatusOf(property);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    return tally;
  }, [properties]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return properties.filter((property) => (
      (status === 'all' || listingStatusOf(property) === status)
      && (!q || property.title.toLowerCase().includes(q) || property.address.toLowerCase().includes(q))
    ));
  }, [properties, search, status]);

  function retry() {
    setLoading(true);
    setError(null);
    setAttempt((value) => value + 1);
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-dark sm:text-[30px]">Properties</h1>
          <p className="mt-1 text-text-body">Your listings, where each one stands, and the applications they have.</p>
        </div>
        <ButtonLink href="/owner/properties/create" className="gap-2 self-start">
          <PlusIcon size={16} />
          Add Property
        </ButtonLink>
      </div>

      <Input
        label="Search your properties"
        placeholder="Search by name or address"
        value={search}
        onChange={(e) => setSearchInput(e.target.value)}
      />

      {loading ? (
        <p role="status" className="text-text-body">Loading your properties…</p>
      ) : error ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-danger bg-white p-5 text-sm text-danger">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>
        </div>
      ) : properties.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-control-border p-10 text-center">
          <p className="font-heading text-lg font-semibold text-text-dark">No properties yet</p>
          <p className="mt-1 text-text-body">Create your first listing to start receiving applications.</p>
          <ButtonLink href="/owner/properties/create" className="mt-4 gap-2">
            <PlusIcon size={16} />
            Add your first property
          </ButtonLink>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Show listings that are" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {FILTERS.map((filter) => (
              <FilterChip
                key={filter}
                selected={status === filter}
                onClick={() => setSearchParams({ status: filter === 'all' ? null : filter })}
              >
                {filter === 'all' ? 'All' : LISTING_STATUS_LABELS[filter]} ({counts.get(filter) ?? 0})
              </FilterChip>
            ))}
          </div>
          {visible.length === 0 ? (
            <p role="status" className="text-text-body">{emptyMessage(search.trim(), status)}</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((property) => <OwnerListingCard key={property.id} property={property} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
