'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Card from '@/app/components/ui/Card';

export default function PropertyQrCodePage() {
  const { id } = useParams<{ id: string }>();
  const [listingUrl, setListingUrl] = useState(`/properties/${id}`);

  useEffect(() => {
    // Absolute origin is only known in the browser; hydrate after mount so SSR
    // and the first client paint stay aligned.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListingUrl(`${window.location.origin}/properties/${id}`);
  }, [id]);

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(listingUrl)}`;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <Link href={`/owner/properties/${id}`} className="text-sm font-medium text-primary">
          ← Property details
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-bold text-text-dark">Property QR Code</h1>
        <p className="mt-1 text-sm text-text-body">
          Share this code so tenants can open the public listing.
        </p>
      </div>
      <Card className="flex flex-col items-center gap-4 p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrSrc} alt="QR code for this listing" width={240} height={240} />
        <p className="break-all text-center text-sm text-text-body">{listingUrl}</p>
      </Card>
    </div>
  );
}
