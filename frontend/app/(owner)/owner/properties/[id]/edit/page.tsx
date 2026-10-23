'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import ListingEditor from '@/app/components/rental/ListingEditor';
import ListingStatusActions from '@/app/components/rental/ListingStatusActions';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import { api, ApiError, type Property } from '@/app/lib/api';
import { LISTING_STATUS_LABELS, LISTING_STATUS_STYLES, listingStatusOf } from '@/app/lib/listings';

/** Edit every field of a listing, its photos and its status (R25). */
export default function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loaded, setLoaded] = useState<{ id: string; property: Property } | null>(null);
  const [failure, setFailure] = useState<{ id: string; notFound: boolean; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api.properties.getMine(id).then(
      (property) => {
        if (!active) return;
        setLoaded({ id, property });
        setFailure(null);
      },
      (err) => {
        if (!active) return;
        setFailure({
          id,
          notFound: err instanceof ApiError && err.status === 404,
          message: err instanceof ApiError ? err.message : 'Could not load this listing. Please try again.',
        });
      },
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);

  const property = loaded && loaded.id === id ? loaded.property : null;
  const failed = failure && failure.id === id ? failure : null;
  const listingHref = `/owner/properties/${id}`;

  if (failed) {
    return (
      <div className="flex max-w-xl flex-col gap-4 rounded-2xl border border-border bg-white p-6">
        <h1 className="font-heading text-h3 font-semibold text-text-dark">{failed.notFound ? 'Listing not found' : "Couldn't load this listing"}</h1>
        <p className="text-sm text-text-body">
          {failed.notFound ? 'It may have been deleted, or it belongs to another landlord.' : failed.message}
        </p>
        <div className="flex flex-wrap gap-3">
          {failed.notFound ? null : (
            <Button variant="secondary" onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}>Try again</Button>
          )}
          <ButtonLink href="/owner/properties" variant="ghost">← Back to properties</ButtonLink>
        </div>
      </div>
    );
  }
  if (!property) return <p role="status" className="text-text-body">Loading listing…</p>;

  const status = listingStatusOf(property);
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-6">
      <div>
        <Link href={listingHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-strong underline">
          ← {property.title}
        </Link>
        <h1 className="mt-1 font-heading text-h2 font-bold text-text-dark">Edit listing</h1>
      </div>

      <section aria-labelledby="status-heading" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="status-heading" className="font-heading text-h4 font-semibold text-text-dark">Status</h2>
          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${LISTING_STATUS_STYLES[status]}`}>
            {LISTING_STATUS_LABELS[status]}
          </span>
        </div>
        <ListingStatusActions
          property={property}
          onChanged={(updated) => setLoaded({ id, property: updated })}
          onArchived={() => router.push('/owner/properties')}
        />
      </section>

      <ListingEditor
        key={property.id}
        property={property}
        onSaved={(updated) => setLoaded({ id, property: updated })}
        onCancel={() => router.push(listingHref)}
      />
    </div>
  );
}
