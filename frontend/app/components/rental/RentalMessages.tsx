'use client';

import ConversationsView from '@/app/components/messaging/ConversationsView';

export default function RentalMessages() {
  return (
    <ConversationsView
      title="Messages"
      subtitle="Chat with owners, providers, and people in your network"
      emptyMessage="No conversations yet. Message someone from Network, or open a property and use “Message owner”."
    />
  );
}
