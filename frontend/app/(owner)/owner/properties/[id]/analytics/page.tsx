import Link from 'next/link';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function PropertyAnalyticsPage({ params }: Props) {
  const { id } = await params;

  return (
    <div>
      <h1>Property Analytics</h1>
      <p>Property: {id}</p>
      <Link href={`/owner/properties/${id}/qr-code`}>Get QR Code</Link>
      <Link href={`/owner/properties/${id}`}>Property Details</Link>
    </div>
  );
}
