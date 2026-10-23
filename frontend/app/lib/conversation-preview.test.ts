import { describe, expect, it } from 'vitest';
import { conversationPreview } from './conversation-preview';

describe('conversationPreview', () => {
  it("marks the viewer's own last message and leaves the other person's as written", () => {
    expect(conversationPreview({ last_message: 'Yes, see you at 10am', last_message_sender_id: 'sam' }, 'sam'))
      .toBe('You: Yes, see you at 10am');
    expect(conversationPreview({ last_message: 'Can you come Tuesday?', last_message_sender_id: 'mei' }, 'sam'))
      .toBe('Can you come Tuesday?');
  });

  it('names an attachment sent without text', () => {
    expect(conversationPreview({ last_message: '', last_message_sender_id: 'sam' }, 'sam')).toBe('You sent an attachment');
    expect(conversationPreview({ last_message: '', last_message_sender_id: 'mei' }, 'sam')).toBe('Sent an attachment');
    // A shared-schema row may store no body at all.
    expect(conversationPreview({ last_message: null, last_message_sender_id: 'mei' }, 'sam')).toBe('Sent an attachment');
  });

  it('has nothing to show for a thread without messages', () => {
    expect(conversationPreview({ last_message: null, last_message_sender_id: null }, 'sam')).toBeNull();
    expect(conversationPreview({ last_message: null }, 'sam')).toBeNull();
  });

  it('never claims a message for a viewer it does not know yet', () => {
    expect(conversationPreview({ last_message: 'Hello', last_message_sender_id: undefined }, undefined)).toBe('Hello');
    expect(conversationPreview({ last_message: 'Hello', last_message_sender_id: null }, null)).toBe('Hello');
  });
});
