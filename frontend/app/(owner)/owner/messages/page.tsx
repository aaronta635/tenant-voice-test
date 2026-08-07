'use client';

import { useCallback, useEffect, useState } from 'react';
import Card from '@/app/components/ui/Card';
import {
  api,
  ApiError,
  safe,
  type Conversation,
  type Message,
  type Profile,
} from '@/app/lib/api';
import { initialsOf, messageTimestamp, ROLE_LABELS } from '@/app/lib/format';

export default function MessagesPage() {
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    const [list, me] = await Promise.all([
      safe(api.conversations.list(), []),
      safe<Profile | null>(api.profiles.me(), null),
    ]);
    setThreads(list);
    setProfile(me);
    setActiveId((current) => current ?? list[0]?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Poll the open thread while the tab is focused (docs/messaging-plan.md phase 1).
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    async function pull() {
      const list = await safe(api.conversations.messages(activeId as string), []);
      if (!cancelled) setMessages(list);
    }

    pull();
    api.conversations.markRead(activeId).then(loadThreads).catch(() => undefined);

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') pull();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeId, loadThreads]);

  const active = threads.find((t) => t.id === activeId) ?? null;

  async function handleSend() {
    const body = draft.trim();
    if (!body || !active) return;
    setError(null);
    try {
      const message = await api.conversations.send(active.id, body);
      setMessages((prev) => [...prev, message]);
      setDraft('');
      loadThreads();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that message.');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <h1 className="font-heading text-lg font-semibold text-text-dark">Messages</h1>
          <p className="text-sm text-text-body">Conversations with tenants and providers</p>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-text-body">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-body">
            No conversations yet. Tenants can start one from a property listing.
          </p>
        ) : (
          threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => setActiveId(thread.id)}
              className={`flex w-full gap-3 border-b border-border px-4 py-4 text-left last:border-b-0 ${
                thread.id === activeId ? 'bg-primary/5' : 'bg-white hover:bg-background'
              }`}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-bold text-navy">
                {initialsOf(thread.counterpart_name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold text-text-dark">
                    {thread.counterpart_name ?? 'Conversation'}
                  </span>
                  <span className="text-xs text-text-body">
                    {messageTimestamp(thread.last_message_at)}
                  </span>
                </span>
                <span className="block truncate text-xs text-text-body">
                  {thread.context ??
                    (thread.counterpart_role
                      ? (ROLE_LABELS[thread.counterpart_role] ?? thread.counterpart_role)
                      : '')}
                </span>
                <span className="mt-0.5 block truncate text-xs text-text-body">
                  {thread.last_message ?? 'No messages yet'}
                </span>
              </span>
              {thread.unread_count > 0 ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">
                  {thread.unread_count}
                </span>
              ) : null}
            </button>
          ))
        )}
      </Card>

      <Card className="flex h-[calc(100vh-220px)] min-h-[480px] flex-col overflow-hidden p-0">
        {active ? (
          <>
            <div className="flex items-center gap-3 border-b border-border px-6 py-4">
              <div className="flex size-11 items-center justify-center rounded-full bg-surface text-sm font-bold text-navy">
                {initialsOf(active.counterpart_name)}
              </div>
              <div>
                <p className="font-heading text-lg font-semibold text-text-dark">
                  {active.counterpart_name ?? 'Conversation'}
                </p>
                <p className="text-sm text-text-body">
                  {[
                    active.counterpart_role
                      ? (ROLE_LABELS[active.counterpart_role] ?? active.counterpart_role)
                      : null,
                    active.context,
                  ]
                    .filter(Boolean)
                    .join(' • ')}
                </p>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-background/40 px-6 py-6">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-text-body">No messages yet.</p>
              ) : (
                messages.map((message) => {
                  const mine = message.sender_id === profile?.id;
                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm ${
                          mine
                            ? 'rounded-br-md bg-primary text-white'
                            : 'rounded-bl-md border border-border bg-white text-text-dark'
                        }`}
                      >
                        {message.body}
                      </div>
                      <span className="mt-1 text-xs text-text-body">
                        {messageTimestamp(message.created_at)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {error ? (
              <p className="px-6 pb-2 text-sm text-[#de3b40]">{error}</p>
            ) : null}

            <div className="flex items-center gap-3 border-t border-border px-6 py-4">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSend();
                }}
                placeholder="Type a message..."
                aria-label="Message"
                className="flex-1 rounded-2xl bg-background px-4 py-3 text-sm text-text-dark placeholder:text-text-body focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSend}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-opacity hover:opacity-90"
                aria-label="Send message"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m3 3 18 9-18 9 4-9Z" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-text-body">
            {loading ? 'Loading…' : 'Select a conversation'}
          </div>
        )}
      </Card>
    </div>
  );
}
