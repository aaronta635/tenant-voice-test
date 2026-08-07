'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Button from '@/app/components/ui/Button';
import PropertyDetailsTabs from '@/app/components/owner/PropertyDetailsTabs';
import { api, ApiError, type Application, type Property } from '@/app/lib/api';

const STATUS_LABEL: Record<Property['status'], string> = {
  available: 'Available',
  rented: 'Rented',
  off_market: 'Off-market',
};

export default function PropertyDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [property, setProperty] = useState<Property | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadApplications = useCallback(async () => {
    const data = await api.applications.listForProperty(id);
    setApplications(data);
  }, [id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([api.properties.getMine(id), api.applications.listForProperty(id)])
      .then(([prop, apps]) => {
        if (!active) return;
        setProperty(prop);
        setApplications(apps);
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof ApiError ? err.message : 'Could not load this property.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function toggleStatus() {
    if (!property || busy) return;
    const next = property.status === 'available' ? 'rented' : 'available';
    setBusy(true);
    try {
      const updated = await api.properties.update(property.id, { status: next });
      setProperty(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the listing.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteListing() {
    if (!property || busy) return;
    if (!window.confirm('Delete this listing? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.properties.remove(property.id);
      router.push('/owner/properties');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the listing.');
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-text-body">Loading property…</p>;
  }

  if (error || !property) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-xl border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error ?? 'Property not found.'}
        </p>
        <Link href="/owner/properties" className="text-sm font-medium text-primary">
          ← Back to properties
        </Link>
      </div>
    );
  }

  const photo = property.photo_urls?.[0];

  return (
    <div className="flex flex-col gap-6">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="h-[280px] w-full rounded-2xl object-cover" />
      ) : (
        <div className="flex h-[280px] items-center justify-center rounded-2xl bg-[#f3f4f6] text-text-subtle">
          <span>No photo yet</span>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-2xl font-bold text-text-dark">{property.title}</h1>
            <span className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-text-body">
              {STATUS_LABEL[property.status]}
            </span>
          </div>
          <p className="mt-1 text-text-body">{property.address}</p>
          <p className="mt-3 text-xl font-bold text-primary">
            ${property.price.toLocaleString()}/week
          </p>
        </div>

        <div className="flex gap-6 rounded-2xl border border-border p-6">
          <div className="text-center">
            <p className="text-lg font-bold text-text-dark">{property.rating_avg}</p>
            <p className="text-xs text-text-body">Rating</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-text-dark">{property.review_count}</p>
            <p className="text-xs text-text-body">Reviews</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-text-dark">{applications.length}</p>
            <p className="text-xs text-text-body">Applicants</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" className="w-fit" onClick={toggleStatus} disabled={busy}>
          {property.status === 'available' ? 'Mark as rented' : 'Mark as available'}
        </Button>
        <Button
          variant="ghost"
          className="w-fit text-[#de3b40] hover:bg-[#fee2e2]"
          onClick={deleteListing}
          disabled={busy}
        >
          Delete listing
        </Button>
      </div>

      <PropertyDetailsTabs
        property={property}
        applications={applications}
        onApplicationsChanged={loadApplications}
      />
    </div>
  );
}
