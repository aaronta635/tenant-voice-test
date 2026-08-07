import Link from 'next/link';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function PropertyQrCodePage({ params }: Props) {
  const { id } = await params;

  return (
    <div>
      <h1>Property QR Code</h1>
      <p>Property: {id}</p>
      <Link href={`/owner/properties/${id}`}>Property Details</Link>
    </div>
  );
}
