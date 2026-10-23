'use client';

import { Suspense } from 'react';
import ProfileSearchView from '@/app/components/network/ProfileSearchView';

export default function OwnerSearchProfilesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[#565d6d]">Loading…</p>}>
      <ProfileSearchView
        title="Search Profiles"
        subtitle="Find tenants and service providers to connect with or message. Use Find Providers in the sidebar to browse the marketplace."
        messagesHref="/owner/messages"
        defaultRole=""
      />
    </Suspense>
  );
}
