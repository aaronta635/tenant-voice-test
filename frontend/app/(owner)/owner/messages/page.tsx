'use client';

import ConversationsView from '@/app/components/messaging/ConversationsView';

export default function OwnerMessagesPage() {
  return (
    <ConversationsView
      title="Messages"
      subtitle="Conversations with tenants, applicants, and your network."
      emptyMessage="No conversations yet. Message someone from Network or Applications to start one."
    />
  );
}
