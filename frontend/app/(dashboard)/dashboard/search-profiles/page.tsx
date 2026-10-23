'use client';

import { Suspense } from 'react';
import ProfileSearchView from '@/app/components/network/ProfileSearchView';

export default function ProviderSearchProfilesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[#565d6d]">Loading…</p>}>
      <ProfileSearchView
        title="Search profiles"
        subtitle="Find landlords and tenants to grow your client network."
        messagesHref="/dashboard/messages"
      />
    </Suspense>
  );
}
