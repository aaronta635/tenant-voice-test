import type { Conversation } from './api';

/**
 * The line an inbox shows for a thread's newest message. The viewer's own
 * message starts "You: " so it never reads as the other person's words. A
 * message without text carried only an attachment: the API accepts no message
 * with neither. Null while the thread has no messages.
 */
export function conversationPreview(
  thread: Pick<Conversation, 'last_message' | 'last_message_sender_id'>,
  viewerId: string | null | undefined,
): string | null {
  const mine = !!viewerId && thread.last_message_sender_id === viewerId;
  const text = thread.last_message?.trim();
  if (text) return mine ? `You: ${text}` : text;
  if (thread.last_message == null && !thread.last_message_sender_id) return null;
  return mine ? 'You sent an attachment' : 'Sent an attachment';
}
