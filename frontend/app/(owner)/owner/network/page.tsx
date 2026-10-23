'use client';

import NetworkView from '@/app/components/network/NetworkView';

export default function OwnerNetworkPage() {
  return (
    <NetworkView
      title="My Network"
      subtitle="Manage tenant, provider, and peer connections for your properties."
      messagesHref="/owner/messages"
      searchHref="/owner/search-profiles"
      recommendationsHref="/owner/recommendations"
      signInHint="as an owner to load your connections and requests."
    />
  );
}
