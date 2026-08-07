'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  safe,
  type Conversation,
  type Message,
  type Profile,
} from '@/app/lib/api';
import {
  BOOKING_STATUS_LABELS,
  formatMoney,
  formatSchedule,
  initialsOf,
  messageTimestamp,
} from '@/app/lib/format';

const FILTERS = ['All', 'Unread', 'Booking'] as const;

export default function MessagesPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
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
      safe(api.profiles.me(), null),
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

  const visible = useMemo(() => {
    if (filter === 'Unread') return threads.filter((t) => t.unread_count > 0);
    if (filter === 'Booking') return threads.filter((t) => t.booking);
    return threads;
  }, [threads, filter]);

  const active = threads.find((t) => t.id === activeId) ?? visible[0] ?? null;

  async function sendMessage() {
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
    <div>
      <div className="mb-6">
        <h1 className="text-[32px] font-extrabold tracking-tight text-[#1b1b1f]">Messages</h1>
        <p className="mt-1 text-[#5f6b76]">Client conversations tied to bookings.</p>
      </div>

      {error ? (
        <p className="mb-4 rounded-[12px] border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-[640px] overflow-hidden rounded-[20px] border border-[#efeff2] bg-white lg:grid-cols-[320px_1fr_280px]">
        {/* Thread list */}
        <div className="border-b border-[#efeff2] lg:border-r lg:border-b-0">
          <div className="flex flex-wrap gap-1.5 border-b border-[#efeff2] p-3">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  filter === f ? 'bg-[#0e2a48] text-white' : 'bg-[#f4f4f8] text-[#5f6b76]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <ul className="max-h-[560px] overflow-y-auto">
            {loading ? (
              <li className="p-6 text-center text-sm text-[#8c97a2]">Loading…</li>
            ) : visible.length === 0 ? (
              <li className="p-6 text-center text-sm text-[#8c97a2]">No conversations</li>
            ) : (
              visible.map((thread) => {
                const selected = thread.id === active?.id;
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(thread.id)}
                      className={`flex w-full gap-3 border-b border-[#f4f4f8] px-3 py-3 text-left ${
                        selected ? 'bg-[#eeeffd]' : 'hover:bg-[#fafafe]'
                      }`}
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-[#0e2a48] ring-1 ring-[#efeff2]">
                        {initialsOf(thread.counterpart_name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-bold text-[#1b1b1f]">
                            {thread.counterpart_name ?? 'Client'}
                          </p>
                          <span className="text-[11px] text-[#8c97a2]">
                            {messageTimestamp(thread.last_message_at)}
                          </span>
                        </div>
                        {thread.context ? (
                          <p className="truncate text-[11px] text-[#8c97a2]">{thread.context}</p>
                        ) : null}
                        <p className="mt-0.5 truncate text-xs text-[#5f6b76]">
                          {thread.last_message ?? 'No messages yet'}
                        </p>
                      </div>
                      {thread.unread_count > 0 ? (
                        <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                          {thread.unread_count}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {/* Chat */}
        <div className="flex min-h-[420px] flex-col">
          {active ? (
            <>
              <div className="border-b border-[#efeff2] px-4 py-3">
                <p className="font-bold text-[#1b1b1f]">
                  {active.counterpart_name ?? 'Conversation'}
                </p>
                {active.context ? (
                  <p className="text-xs text-[#8c97a2]">{active.context}</p>
                ) : null}
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((msg) => {
                  const mine = msg.sender_id === profile?.id;
                  return (
                    <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-[16px] px-3.5 py-2.5 text-sm ${
                          mine ? 'bg-primary text-white' : 'bg-[#f4f4f8] text-[#1b1b1f]'
                        }`}
                      >
                        <p>{msg.body}</p>
                        <p
                          className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-[#8c97a2]'}`}
                        >
                          {messageTimestamp(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 ? (
                  <p className="text-center text-sm text-[#8c97a2]">No messages yet.</p>
                ) : null}
              </div>
              <div className="border-t border-[#efeff2] p-3">
                <div className="flex gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') sendMessage();
                    }}
                    placeholder="Type a message..."
                    className="h-11 flex-1 rounded-[12px] border border-[#efeff2] px-3 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={sendMessage}
                    className="h-11 rounded-[12px] bg-primary px-4 text-sm font-bold text-white"
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[#8c97a2]">
              Select a conversation
            </div>
          )}
        </div>

        {/* Booking panel */}
        <aside className="hidden border-l border-[#efeff2] bg-[#fafafe] p-4 lg:block">
          {active?.booking ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold tracking-wide text-[#8c97a2] uppercase">Booking</p>
                <p className="mt-1 font-bold text-[#1b1b1f]">
                  {active.booking.service_title ?? 'Service'}
                </p>
                <p className="text-sm text-[#5f6b76]">
                  {BOOKING_STATUS_LABELS[active.booking.status] ?? active.booking.status}
                </p>
              </div>
              <div className="space-y-1 text-sm text-[#5f6b76]">
                <p>
                  📅{' '}
                  {formatSchedule(active.booking.scheduled_date, active.booking.scheduled_time)}
                </p>
                {active.booking.property_address ? (
                  <p>📍 {active.booking.property_address}</p>
                ) : null}
                <p>🔖 {active.booking.id.slice(0, 8).toUpperCase()}</p>
              </div>
              {active.booking.price !== null ? (
                <div className="rounded-[14px] border border-[#efeff2] bg-white p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#8c97a2]">Client fee</span>
                    <span className="font-semibold">{formatMoney(active.booking.price)}</span>
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-[#8c97a2]">Replying as {profile?.full_name}</p>
            </div>
          ) : (
            <p className="text-sm text-[#8c97a2]">No booking attached to this thread.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
