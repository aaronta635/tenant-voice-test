'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import type { RecommendationChatMessage, RecommendationChatResponse } from '@/app/lib/api';
import { CHAT_MESSAGE_LIMIT } from '@/app/lib/recommendation-chat';

const STATUS_COPY: Record<RecommendationChatResponse['ai_status'], string> = {
  applied: 'AI assistant',
  not_configured: 'Guided questions · AI is not connected',
  unavailable: 'Guided questions · AI is temporarily unavailable',
  cooldown: 'Guided questions · AI is busy, try again shortly',
  verification_required: 'Guided questions · AI needs a verified account',
};

type Props = {
  messages: RecommendationChatMessage[];
  quickReplies: string[];
  /** The assistant has confirmed complete criteria: offer the search here too. */
  canConfirm: boolean;
  /** Plain-words description of what Find matches will search, shown beside it. */
  summary: string | null;
  /** Whether AI answers are on; the page still passes it, the help line no longer depends on it. */
  aiConfigured: boolean;
  busy: boolean;
  searching: boolean;
  error: string | null;
  aiStatus: RecommendationChatResponse['ai_status'] | null;
  onSend: (text: string) => void;
  onRetry: () => void;
  onConfirm: () => void;
  onReset: () => void;
  onEditDetails: () => void;
};

export default function RecommendationChat({
  messages, quickReplies, canConfirm, summary, busy, searching, error, aiStatus,
  onSend, onRetry, onConfirm, onReset, onEditDetails,
}: Props) {
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages.length, busy, error]);

  function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    onSend(message);
  }

  function sendQuickReply(reply: string, event: MouseEvent<HTMLButtonElement>) {
    send(reply);
    // The chips disappear while the assistant answers. Keyboard users continue in the
    // message box; a tap keeps focus in the conversation so phones don't open the keyboard.
    if (event.detail === 0) input.current?.focus();
    else log.current?.focus({ preventScroll: true });
  }

  /** Start over / Try again remove or disable themselves; keep focus in the message box. */
  function keepFocus(action: () => void) {
    action();
    input.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    send(draft);
    setDraft('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Never send while an IME is composing; Safari reports the committing Enter as keyCode 229.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const remaining = CHAT_MESSAGE_LIMIT - draft.length;

  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold text-text-dark">Recommendation assistant</h2>
          <p className="text-xs text-text-body">{aiStatus ? STATUS_COPY[aiStatus] : 'Describe who you want to reach'}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => keepFocus(onReset)} disabled={busy || messages.length <= 1}>Start over</Button>
      </div>

      <div ref={log} role="log" tabIndex={-1} aria-label="Conversation with the recommendation assistant" aria-busy={busy} className="max-h-[26rem] min-h-56 space-y-3 overflow-y-auto px-5 py-4 focus:outline-none">
        {messages.map((message, index) => (
          <div key={index} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-6 ${message.role === 'user' ? 'bg-primary-strong text-white' : 'bg-surface text-text-dark'}`}>
              <span className="sr-only">{message.role === 'user' ? 'You said: ' : 'Assistant: '}</span>
              {message.content}
            </p>
          </div>
        ))}
        {busy ? <p className="text-sm text-text-body">Assistant is thinking…</p> : null}
      </div>

      {error ? (
        <div role="alert" className="mx-5 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger p-3 text-sm text-danger">
          <span>{error}</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => keepFocus(onRetry)} disabled={busy}>Try again</Button>
        </div>
      ) : null}

      {canConfirm && !busy ? (
        <div className="mx-5 mb-3 space-y-2">
          {summary ? <p className="text-sm text-text-dark">Ready to search for <span className="font-semibold">{summary}</span>.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onConfirm} aria-disabled={searching}>{searching ? 'Finding matches…' : 'Find matches'}</Button>
            <Button type="button" variant="secondary" onClick={onEditDetails}>Adjust details</Button>
          </div>
        </div>
      ) : quickReplies.length > 0 && !busy && !error ? (
        <div role="group" aria-label="Suggested answers" className="mx-5 mb-3 flex flex-wrap gap-2">
          {quickReplies.map((reply) => (
            <Button key={reply} type="button" size="sm" variant="secondary" className="rounded-full" onClick={(event) => sendQuickReply(reply, event)}>{reply}</Button>
          ))}
        </div>
      ) : null}

      <form onSubmit={submit} className="border-t border-border p-4">
        <label htmlFor="recommendation-chat-input" className="sr-only">Message the recommendation assistant</label>
        <div className="flex items-end gap-2">
          <textarea
            ref={input}
            id="recommendation-chat-input"
            rows={2}
            maxLength={CHAT_MESSAGE_LIMIT}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Landlords in Parramatta for my rental appraisals"
            aria-describedby="recommendation-chat-help"
            className="min-h-12 min-w-0 flex-1 resize-none rounded-lg border border-control-border bg-white px-3 py-2 text-base text-text-dark focus:outline-2 focus:outline-primary-strong sm:text-sm"
          />
          <Button type="submit" disabled={busy || !draft.trim()}>Send</Button>
        </div>
        <p id="recommendation-chat-help" className="mt-2 text-xs leading-5 text-text-body">
          Avoid personal details such as names, phone numbers or street addresses.
          {remaining <= 100 ? ` ${remaining} characters left.` : ''}
        </p>
      </form>
    </Card>
  );
}
