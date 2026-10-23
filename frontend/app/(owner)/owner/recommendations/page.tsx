'use client';

import DemoLabel from '@/app/components/demo/DemoLabel';
import NetworkRecommendations from '@/app/components/tenant/NetworkRecommendations';
import OwnerProviderSuggestions from './OwnerProviderSuggestions';

export default function OwnerRecommendationsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-[30px] font-semibold leading-9 tracking-tight text-[#171a1f]">
          Recommendations for You
        </h1>
        <p className="mt-1 text-sm text-[#565d6d]">
          Service providers ranked for your properties, and tenants and providers you can filter and contact.
        </p>
      </div>
      <div className="mb-12">
        <OwnerProviderSuggestions />
      </div>
      <DemoLabel
        variant="notice"
        className="mb-8"
        reason="The people suggestions below are public profiles filtered on this page by the options you pick. They do not use your network activity yet."
      />
      <NetworkRecommendations
        signedIn
        messagesHref="/owner/messages"
        showProperties={false}
      />
    </div>
  );
}
