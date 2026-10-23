import Link from 'next/link';
import InformationUse from '@/app/components/onboarding/InformationUse';
import LandlordCompletion from '@/app/components/onboarding/LandlordCompletion';

export const metadata = { title: 'Profile completion' };

/** A landlord's setup checklist and where to finish each item (R19). */
export default function OwnerProfileCompletionPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <div>
        <Link href="/owner/profile" className="text-sm font-medium text-primary-strong hover:underline">
          ← Back to profile
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-bold text-text-dark">Profile completion</h1>
        <p className="mt-1 text-sm text-text-body">What your profile and verification still need, and where to add it.</p>
      </div>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <LandlordCompletion />
        <aside className="min-w-0">
          <InformationUse role="landlord" />
        </aside>
      </div>
    </div>
  );
}
