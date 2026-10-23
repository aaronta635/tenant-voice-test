'use client';

import TenantShell from '@/app/components/tenant/TenantShell';
import NetworkView from '@/app/components/network/NetworkView';

export default function TenantNetworkPage() {
  return (
    <TenantShell>
      <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
        <NetworkView
          title="My Network"
          subtitle="Manage your connections and grow your rental network."
          messagesHref="/tenant/messages"
          searchHref="/tenant/search-profile"
          recommendationsHref="/tenant/recommendations"
          signInHint="as a tenant to load your connections and requests."
        />
      </main>
    </TenantShell>
  );
}
