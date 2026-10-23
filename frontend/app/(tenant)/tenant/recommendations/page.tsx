'use client';

import TenantShell from '@/app/components/tenant/TenantShell';
import DemoLabel from '@/app/components/demo/DemoLabel';
import NetworkRecommendations from '@/app/components/tenant/NetworkRecommendations';
import TenantProviderSuggestions from '@/app/components/tenant/TenantProviderSuggestions';

export default function TenantRecommendationsPage() {
  return (
    <TenantShell>
      <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
        <div className="mb-8">
          <h1 className="font-heading text-[30px] font-semibold leading-9 tracking-tight text-[#171a1f]">
            Recommendations for You
          </h1>
          <p className="mt-1 text-sm text-[#565d6d]">
            Homes and landlords matched to your saved preferences, service providers near you, and members you can connect with.
          </p>
        </div>
        <DemoLabel
          variant="notice"
          className="mb-8"
          reason="The people suggestions are public profiles filtered on this page by the options you pick. They do not use your saved preferences or activity yet."
        />
        <NetworkRecommendations signedIn />
        <div className="mt-12">
          <TenantProviderSuggestions />
        </div>
      </main>
    </TenantShell>
  );
}
