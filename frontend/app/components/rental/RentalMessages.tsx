'use client';

import { useCallback, useEffect, useState } from 'react';
import Button from '@/app/components/ui/Button';
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

export default function RentalMessages() {
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

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  async function send(event: React.FormEvent) {
    event.preventDefault();
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
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="overflow-hidden rounded-[16px] border border-[#dee1e6]">
        <div className="border-b border-[#f1f5f9] px-5 py-5">
          <h1 className="font-heading text-xl font-semibold">Messages</h1>
          <p className="mt-1 text-sm text-[#565d6d]">Tenant ↔ owner communication</p>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-[#565d6d]">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[#565d6d]">
            No conversations yet. Open a property and use &ldquo;Message owner&rdquo; to start one.
          </p>
        ) : (
          threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => setActiveId(thread.id)}
              className={`flex w-full gap-3 border-b border-[#f1f5f9] px-4 py-4 text-left last:border-b-0 ${
                thread.id === activeId ? 'bg-primary/5' : 'bg-white hover:bg-[#fafafb]'
              }`}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#f0f1ff] text-sm font-bold text-primary">
                {initialsOf(thread.counterpart_name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  {thread.counterpart_name ?? 'Conversation'}
                </span>
                <span className="block truncate text-xs text-[#565d6d]">
                  {thread.context ??
                    (thread.counterpart_role
                      ? (ROLE_LABELS[thread.counterpart_role] ?? thread.counterpart_role)
                      : '')}
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

      <Card className="flex min-h-[720px] flex-col overflow-hidden rounded-[16px] border border-[#dee1e6]">
        {active ? (
          <>
            <div className="flex items-center justify-between border-b border-[#f1f5f9] px-6 py-5">
              <div>
                <h2 className="font-heading text-xl font-semibold">
                  {active.counterpart_name ?? 'Conversation'}
                </h2>
                <p className="text-sm text-[#565d6d]">
                  {active.context ??
                    (active.counterpart_role
                      ? (ROLE_LABELS[active.counterpart_role] ?? active.counterpart_role)
                      : '')}
                </p>
              </div>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-[#565d6d]">No messages yet.</p>
              ) : (
                messages.map((message) => {
                  const mine = message.sender_id === profile?.id;
                  return (
                    <div
                      key={message.id}
                      className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[72%] rounded-[14px] px-5 py-3 text-sm shadow-[0_2px_5px_rgba(23,26,31,0.09)] ${
                          mine ? 'bg-primary text-white' : 'bg-white text-[#171a1f]'
                        }`}
                      >
                        <p>{message.body}</p>
                        <p
                          className={`mt-2 text-xs ${mine ? 'text-white/75' : 'text-[#8c97a2]'}`}
                        >
                          {messageTimestamp(message.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {error ? <p className="px-6 pb-2 text-sm text-[#de3b40]">{error}</p> : null}
            <form className="flex gap-3 border-t border-[#f1f5f9] p-5" onSubmit={send}>
              <input
                aria-label="Message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type a message..."
                className="h-11 flex-1 rounded-full border border-[#dee1e6] bg-[#fafafb] px-4 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <Button className="h-11 rounded-full">Send</Button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-[#565d6d]">
            {loading ? 'Loading…' : 'Select a conversation'}
          </div>
        )}
      </Card>
    </div>
  );
}
