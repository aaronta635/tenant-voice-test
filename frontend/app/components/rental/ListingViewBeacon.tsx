'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { recordListingView } from '@/app/lib/listing-views';

/**
 * Counts a view of the listing the page shows, for its owner's analytics
 * (lib/listing-views). It renders nothing, and the page never waits for it.
 */
export default function ListingViewBeacon() {
  const params = useParams<{ propertyId: string }>();
  const listingId = (Array.isArray(params.propertyId) ? params.propertyId[0] : params.propertyId) ?? '';

  useEffect(() => {
    void recordListingView(listingId);
  }, [listingId]);

  return null;
}
