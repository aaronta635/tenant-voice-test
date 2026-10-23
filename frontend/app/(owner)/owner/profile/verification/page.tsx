import Link from 'next/link';
import DocumentsPanel from '@/app/components/documents/DocumentsPanel';

export const metadata = { title: 'Verification documents' };

/** A landlord's private documents: photo ID and proof of ownership or authority (R15). */
export default function OwnerVerificationPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <div>
        <Link href="/owner/profile" className="text-sm font-medium text-primary-strong hover:underline">
          ← Back to profile
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-bold text-text-dark">Verification documents</h1>
        <p className="mt-1 text-sm text-text-body">
          Upload a photo ID and proof that you own or manage your properties. A TenantVoice admin reviews each
          document before it counts.
        </p>
      </div>
      <DocumentsPanel legacyPicks="landlord" />
    </div>
  );
}
