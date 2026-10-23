'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConnectButton from '@/app/components/trust/ConnectButton';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import { api } from '@/app/lib/api';
import type { ConnectionStateName } from '@/app/lib/connections';
import { getClientSessionRole, messagesHrefForRole } from '@/app/lib/session-role';

type Props = {
  /** The member's users.id. */
  userId: string;
  name: string;
  /** Their profile page, should the session have ended. */
  path: string;
};

/** The panel's heading and line for each state the Connect button shows; anything else reads as none. */
function copy(state: ConnectionStateName | null, name: string): { heading: string; line: string } {
  switch (state) {
    case 'sent':
      return { heading: `Your request to ${name}`, line: `Once ${name} accepts, you can message each other.` };
    case 'received':
      return { heading: `A request from ${name}`, line: 'Accept it to message each other.' };
    case 'connected':
      return { heading: `You and ${name} are connected`, line: 'You can message each other.' };
    case 'declined':
      return { heading: `Connecting with ${name}`, line: `Only ${name} can send a new request now.` };
    default:
      return { heading: `Connect with ${name}`, line: `Once ${name} accepts, you can message each other.` };
  }
}

/**
 * The spot on a public profile for connecting with its member, for a
 * signed-in viewer. It follows the Connect button's state: on the viewer's
 * own profile it says so instead, for staff or a blocked pair it is gone,
 * and once connected it opens a conversation.
 */
export default function ConnectPanel({ userId, name, path }: Props) {
  const router = useRouter();
  const [state, setState] = useState<ConnectionStateName | null>(null);
  const [opening, setOpening] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  async function message() {
    if (opening) return;
    setOpening(true);
    setMessageError(null);
    try {
      const thread = await api.conversations.startRental({ peer_id: userId, subject: `Chat with ${name}` });
      router.push(`${messagesHrefForRole(getClientSessionRole())}?thread=${thread.id}`);
    } catch {
      setMessageError('Could not open the conversation. Please try again.');
    } finally {
      setOpening(false);
    }
  }

  if (state === 'unavailable') return null;
  if (state === 'self') {
    return (
      <div data-connect-slot="" className="mt-5 rounded-xl bg-surface p-4">
        <p className="font-semibold text-text-dark">This is your public profile</p>
        <p className="mt-1 text-sm text-text-body">Members and visitors see it like this. Your private details stay private.</p>
      </div>
    );
  }
  const { heading, line } = copy(state, name);
  return (
    <div data-connect-slot="" className="mt-5 rounded-xl border border-border p-4">
      <p className="font-semibold text-text-dark">{heading}</p>
      <p className="mt-1 text-sm text-text-body">{line} These details stay private.</p>
      <ConnectButton
        userId={userId}
        name={name}
        signedIn
        returnTo={path}
        onState={setState}
        className="mt-3"
        connectedAction={
          <Button variant="secondary" size="sm" disabled={opening} aria-label={`Message ${name}`} onClick={() => void message()}>
            {opening ? 'Opening…' : 'Message'}
          </Button>
        }
      />
      <FormMessage error={messageError} className="mt-2" />
    </div>
  );
}
