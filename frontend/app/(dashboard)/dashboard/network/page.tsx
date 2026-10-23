'use client';

import NetworkView from '@/app/components/network/NetworkView';

export default function ProviderNetworkPage() {
  return (
    <NetworkView
      title="Network"
      subtitle="Connect with landlords and tenants and discuss their service needs."
      messagesHref="/dashboard/messages"
      searchHref="/dashboard/search-profiles"
      recommendationsHref="/dashboard/recommendations"
      signInHint="as a service provider to load your connections and requests."
    />
  );
}
