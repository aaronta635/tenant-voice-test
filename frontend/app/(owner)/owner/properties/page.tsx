'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import PropertyCard from '@/app/components/owner/PropertyCard';
import { PlusIcon } from '@/app/components/owner/icons';
import { api, ApiError, type Property } from '@/app/lib/api';

export default function PropertyListingsPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.properties
      .listMine()
      .then((data) => {
        if (active) setProperties(data);
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'Could not load your properties. Is the API running?',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter(
      (p) =>
        p.title.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
    );
  }, [properties, search]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-dark sm:text-[30px]">
            Properties
          </h1>
          <p className="mt-1 text-text-body">Manage and view your property portfolio.</p>
        </div>
        <Link href="/owner/properties/create">
          <Button variant="primary" className="gap-2">
            <PlusIcon size={16} />
            Add Property
          </Button>
        </Link>
      </div>

      <Input
        placeholder="Search properties by name or address..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <p className="text-text-body">Loading your properties…</p>
      ) : error ? (
        <p className="rounded-xl border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </p>
      ) : properties.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="font-heading text-lg font-semibold text-text-dark">No properties yet</p>
          <p className="mt-1 text-text-body">
            Create your first listing to start receiving applications.
          </p>
          <Link href="/owner/properties/create" className="mt-4 inline-block">
            <Button variant="primary" className="gap-2">
              <PlusIcon size={16} />
              Add Property
            </Button>
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-text-body">No properties match “{search}”.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((property) => (
            <PropertyCard key={property.id} property={property} />
          ))}
        </div>
      )}
    </div>
  );
}
