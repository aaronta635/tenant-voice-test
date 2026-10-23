'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import EmptyState from '@/app/components/ui/EmptyState';
import FilterChip from '@/app/components/ui/FilterChip';
import {
  api,
  ApiError,
  type Conversation,
  type Message,
  type Profile,
} from '@/app/lib/api';
import { setSearchParams } from '@/app/lib/page-url';
import FormMessage from '@/app/components/ui/FormMessage';
import PageHeader from '@/app/components/ui/PageHeader';
import { initialsOf, messageTimestamp, ROLE_LABELS } from '@/app/lib/format';
import { conversationPreview } from '@/app/lib/conversation-preview';

const FILTERS = ['All', 'Unread', 'Booking'] as const;
export type ThreadFilter = (typeof FILTERS)[number];

/** How often an open thread is re-fetched while the tab is visible (ms). */
const POLL_MS = 5000;

export type ConversationsViewProps = {
  title: string;
  subtitle?: string;
  emptyMessage: string;
  /** Provider inbox only: All / Unread / Booking tabs. */
  showFilters?: boolean;
  /** Provider inbox only: booking summary rail beside the thread. */
  renderAside?: (active: Conversation) => React.ReactNode;
};

function isImage(url: string) {
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
}

/** Upload statuses that reject the file itself: empty, too large, wrong type. */
const REJECTED_FILE = [400, 413, 415, 422];

/**
 * A 4xx reason is permanent, so show it; asking for a retry only makes sense
 * when the network or the server failed.
 */
function sendFailure(err: unknown, uploading: boolean) {
  if (!(err instanceof ApiError) || err.status < 400 || err.status >= 500) {
    return 'Could not send your message. Your draft is saved here. Please try again.';
  }
  const reason = /[.!?]$/.test(err.message) ? err.message : `${err.message}.`;
  if (err.status === 401) return reason;
  if (uploading && REJECTED_FILE.includes(err.status)) {
    return `Your attachment was not accepted. ${reason} Remove it or choose a different file; your message is saved here.`;
  }
  return `${reason} Your draft is saved here.`;
}

/**
 * The single messaging surface, shared by the tenant, owner and provider
 * inboxes (rules.md: use the shared component, don't build one-offs).
 *
 * Delivery is short polling, not sockets — see docs/messaging-plan.md for why,
 * and for the Phase 2 real-time options if that ever changes.
 */
/**
 * useSearchParams forces a client bailout, which Next requires be contained by a
 * Suspense boundary. Owning that here means no consumer can forget it.
 */
export default function ConversationsView(props: ConversationsViewProps) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-text-body">Loading…</p>}>
      <ConversationsViewInner {...props} />
    </Suspense>
  );
}

function ConversationsViewInner({
  title,
  subtitle,
  emptyMessage,
  showFilters = false,
  renderAside,
}: ConversationsViewProps) {
  const searchParams = useSearchParams();
  // A thread becomes read only after an explicit selection (including deep links).
  const activeId = searchParams.get('thread');
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Record<string, File | null>>({});
  const [filter, setFilter] = useState<ThreadFilter>('All');
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendErrors, setSendErrors] = useState<Record<string, string | null>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [threadState, setThreadState] = useState<{
    id: string; thread: Conversation | null; messages: Message[];
    ready: boolean; error: string | null;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const nearLatestRef = useRef(true);
  const pinLatestRef = useRef(false);
  const [panelHeight, setPanelHeight] = useState(560);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const threadHeadingRef = useRef<HTMLHeadingElement>(null);
  const messagesPullGen = useRef(0);
  const listPullGen = useRef(0);
  const activeIdRef = useRef(activeId);
  const sendLock = useRef(false);
  const inboxEmpty = !loading && !loadError && threads.length === 0 && !activeId;

  // Runs again when inboxEmpty changes, so the grid is measured after it remounts.
  // The pane ends 16px above the bottom of the window with the page scrolled to
  // the top. It is measured from the top of the page, so a measurement taken
  // while the page is scrolled gives the same height.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const top = grid.getBoundingClientRect().top - document.documentElement.getBoundingClientRect().top;
      setPanelHeight(Math.max(320, Math.floor(viewportHeight - top - 16)));
    };
    const initial = window.requestAnimationFrame(measure);
    // Content above the pane can change after it mounts, such as the demo
    // notice that appears once the profile loads; every ancestor grows then.
    const observer = new ResizeObserver(measure);
    for (let node = grid.parentElement; node && node !== document.documentElement; node = node.parentElement) observer.observe(node);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => { window.cancelAnimationFrame(initial); observer.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [inboxEmpty]);

  const loadThreads = useCallback(async () => {
    const generation = ++listPullGen.current;
    try {
      const [list, me] = await Promise.all([api.conversations.list(), api.profiles.me()]);
      if (generation !== listPullGen.current) return;
      setThreads(list);
      setProfile(me);
      setLoadError(null);
    } catch {
      if (generation === listPullGen.current) setLoadError('Could not refresh your inbox. Please try again.');
    } finally {
      if (generation === listPullGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadThreads(), 0);
    const refresh = () => { if (document.visibilityState === 'visible') void loadThreads(); };
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener('focus', refresh);
    return () => { window.clearTimeout(initial); listPullGen.current += 1; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [loadThreads]);

  useEffect(() => {
    activeIdRef.current = activeId;
    if (!activeId) return;
    let cancelled = false;
    let pulling = false;
    let firstLoad = true;
    let readThrough: string | undefined;
    async function pull() {
      if (pulling || document.visibilityState !== 'visible') return;
      pulling = true;
      const generation = ++messagesPullGen.current;
      try {
        const [thread, list] = await Promise.all([
          api.conversations.get(activeId as string),
          api.conversations.messages(activeId as string),
        ]);
        if (cancelled || generation !== messagesPullGen.current) return;
        if (firstLoad || nearLatestRef.current) pinLatestRef.current = true;
        setThreadState({ id: activeId as string, thread, messages: list, ready: true, error: null });
        if (firstLoad) requestAnimationFrame(() => { if (!cancelled) { threadHeadingRef.current?.focus(); threadHeadingRef.current?.scrollIntoView({ block: 'nearest' }); } });
        firstLoad = false;
        const latest = list.at(-1)?.id ?? 'empty';
        if (readThrough !== latest && document.visibilityState === 'visible') {
          // The thread already loaded, so a failed read receipt must not mark it
          // unavailable. readThrough stays put and the next poll retries.
          const marked = await api.conversations.markRead(activeId as string).then(() => true, () => false);
          if (cancelled || !marked) return;
          readThrough = latest;
          window.dispatchEvent(new Event('tenantvoice:counts-changed'));
          void loadThreads();
        }
      } catch {
        if (!cancelled && generation === messagesPullGen.current) {
          setThreadState(previous => ({
            id: activeId as string,
            thread: previous?.id === activeId ? previous.thread : null,
            messages: previous?.id === activeId ? previous.messages : [],
            ready: !firstLoad,
            error: firstLoad ? 'Could not load this conversation. It may be unavailable, or you may need to try again.' : 'Could not refresh this conversation. Your messages are still shown. Try again before sending.',
          }));
        }
      } finally { pulling = false; }
    }
    void pull();
    const timer = window.setInterval(() => void pull(), POLL_MS);
    const refresh = () => void pull();
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; messagesPullGen.current += 1; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [activeId, loadThreads, reload]);

  // Scrolls once React has rendered the messages. A frame callback could run
  // before they were in the list, so long threads opened at the oldest one.
  useLayoutEffect(() => {
    const list = messageListRef.current;
    if (!list || !pinLatestRef.current) return;
    pinLatestRef.current = false;
    list.scrollTop = list.scrollHeight;
  }, [threadState]);

  // A reader at the latest message keeps it in view when the pane is resized.
  useLayoutEffect(() => {
    const list = messageListRef.current;
    if (list && nearLatestRef.current) list.scrollTop = list.scrollHeight;
  }, [panelHeight]);

  const current = threadState?.id === activeId ? threadState : null;
  const active = current?.thread ?? threads.find(thread => thread.id === activeId) ?? null;
  const messages = current?.messages ?? [];
  const draft = activeId ? drafts[activeId] ?? '' : '';
  const attachment = activeId ? attachments[activeId] ?? null : null;
  const error = activeId ? sendErrors[activeId] : null;
  const sending = sendingId !== null;
  const unavailable = !current?.ready || !!current.error || !profile;
  const visibleThreads = useMemo(() => {
    if (filter === 'Unread') return threads.filter(t => t.unread_count > 0);
    if (filter === 'Booking') return threads.filter(t => t.booking);
    return threads;
  }, [threads, filter]);

  // Each thread opened is its own history entry, so Back returns to the
  // previous thread, or to the list on a phone.
  function selectThread(id: string | null) {
    setSearchParams({ thread: id }, 'push');
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if ((!body && !attachment) || !activeId || !active || unavailable || sendLock.current) return;
    const id = activeId;
    const sendControl = document.activeElement;
    sendLock.current = true;
    setSendErrors(previous => ({ ...previous, [id]: null }));
    setSendingId(id);
    let uploading = !!attachment;
    try {
      const uploaded = attachment ? await api.uploads.messageAttachment(attachment) : null;
      uploading = false;
      const message = await api.conversations.send(id, body, uploaded?.url);
      if (activeIdRef.current === id) { messagesPullGen.current += 1; pinLatestRef.current = true; }
      setThreadState(previous => previous?.id === id ? {
        ...previous, messages: previous.messages.some(row => row.id === message.id) ? previous.messages : [...previous.messages, message],
      } : previous);
      setDrafts(previous => ({ ...previous, [id]: previous[id] === draft ? '' : previous[id] }));
      setAttachments(previous => ({ ...previous, [id]: previous[id] === attachment ? null : previous[id] }));
      if (fileRef.current && activeIdRef.current === id) fileRef.current.value = '';
      window.dispatchEvent(new Event('tenantvoice:counts-changed'));
      void loadThreads();
    } catch (err) {
      setSendErrors(previous => ({ ...previous, [id]: sendFailure(err, uploading) }));
    } finally {
      setSendingId(null); sendLock.current = false;
      requestAnimationFrame(() => {
        if (activeIdRef.current === id) {
          if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
          if (document.activeElement === sendControl || document.activeElement === document.body) composerRef.current?.focus({ preventScroll: true });
        }
      });
    }
  }

  const aside = active && renderAside ? renderAside(active) : null;

  return (
    <div className="space-y-5">
      <PageHeader title={title} description={subtitle} />
      {inboxEmpty ? <EmptyState title="Your inbox is empty" description={emptyMessage} /> : (
    <div
      ref={gridRef}
      style={{ '--conversation-height': `${panelHeight}px` } as React.CSSProperties}
      className={`grid min-w-0 grid-cols-1 gap-4 ${
        aside
          ? 'lg:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_260px]'
          : 'lg:grid-cols-[240px_minmax(0,1fr)]'
      }`}
    >
      {/* Thread list */}
      <Card className={`${activeId ? 'hidden lg:block' : 'block'} min-w-0 self-start overflow-hidden lg:h-[var(--conversation-height)] lg:overflow-y-auto`}>
        <div className="border-b border-border px-5 py-5">
          <h2 className="font-heading text-lg font-semibold text-text-dark">Conversations</h2>
          {showFilters ? (
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter conversations">
              {FILTERS.map((item) => (
                <FilterChip key={item} selected={filter === item} onClick={() => setFilter(item)}>
                  {item}
                </FilterChip>
              ))}
            </div>
          ) : null}
        </div>

        {loadError ? (
          <div className="border-b border-border px-5 py-4 text-sm text-text-body" role="alert">
            <p>{loadError}</p>
            <Button variant="secondary" className="mt-3" onClick={() => {
              setLoading(true);
              void loadThreads();
            }} disabled={loading}>
              {loading ? 'Loading…' : 'Try again'}
            </Button>
          </div>
        ) : null}
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-text-body">Loading…</p>
        ) : visibleThreads.length === 0 ? (loadError ? null : (
          <p className="px-5 py-8 text-center text-sm text-text-body">
            {threads.length === 0 ? emptyMessage : 'No conversations match this filter.'}
          </p>
        )) : (
          visibleThreads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => selectThread(thread.id)}
              aria-current={thread.id === activeId ? true : undefined}
              aria-pressed={thread.id === activeId}
              className={`flex w-full gap-3 border-b border-l-4 border-l-transparent border-border px-4 py-4 text-left last:border-b-0 ${
                thread.id === activeId ? 'border-l-primary bg-primary/5' : 'bg-white hover:bg-background'
              }`}
            >
              <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-bold text-primary-strong">
                {initialsOf(thread.counterpart_name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-text-dark">
                  {thread.counterpart_name ?? 'Conversation'}
                </span>
                <span className="block truncate text-xs text-text-body">
                  {thread.context ??
                    (thread.counterpart_role
                      ? (ROLE_LABELS[thread.counterpart_role] ?? thread.counterpart_role)
                      : '')}
                </span>
                {conversationPreview(thread, profile?.id) ? (
                  <span className="mt-0.5 block truncate text-xs text-text-subtle">
                    {conversationPreview(thread, profile?.id)}
                  </span>
                ) : null}
                {thread.last_message_at ? <time dateTime={thread.last_message_at} className="mt-1 block text-[11px] text-text-body">{messageTimestamp(thread.last_message_at)}</time> : null}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-2">
              {thread.unread_count > 0 ? (
                <span className="h-fit rounded-full bg-primary-strong px-2 py-0.5 text-xs font-bold text-white">
                  {thread.unread_count}<span className="sr-only"> unread messages</span>
                </span>
              ) : null}
              </span>
            </button>
          ))
        )}
      </Card>

      {/* Thread */}
      <Card className={`${activeId ? 'flex' : 'hidden lg:flex'} h-[var(--conversation-height)] min-w-0 self-start flex-col overflow-hidden`}>
        {activeId ? <div className="shrink-0 border-b border-border px-4 py-2 lg:hidden"><Button variant="ghost" onClick={() => selectThread(null)}>← All conversations</Button></div> : null}
        {active ? (
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-4 sm:px-6">
              <div>
                <h2 ref={threadHeadingRef} tabIndex={-1} className="scroll-mt-24 break-words font-heading text-xl font-semibold text-text-dark">
                  {active.counterpart_name ?? 'Conversation'}
                </h2>
                <p className="text-sm text-text-body">
                  {active.context ??
                    (active.counterpart_role
                      ? (ROLE_LABELS[active.counterpart_role] ?? active.counterpart_role)
                      : '')}
                </p>
              </div>
            </div>

            {aside ? <details className="max-h-[35%] shrink-0 overflow-y-auto border-b border-border p-4 2xl:hidden"><summary className="cursor-pointer text-sm font-semibold">Booking details</summary><div className="mt-3">{aside}</div></details> : null}
            <div ref={messageListRef} onScroll={event => { const list = event.currentTarget; nearLatestRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 64; }} tabIndex={0} role="log" aria-label={`Messages with ${active.counterpart_name ?? 'this person'}`} aria-live="polite" aria-relevant="additions text" aria-busy={!current} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              {!current ? <p role="status" className="text-sm text-text-body">Loading conversation…</p> : current.error ? <div role="alert" className="text-sm text-danger"><p>{current.error}</p><Button variant="secondary" className="mt-2" onClick={() => setReload(value => value + 1)}>Retry conversation</Button></div> : null}
              {current?.ready && messages.length === 0 ? (
                <p className="text-center text-sm text-text-body">No messages yet.</p>
              ) : (
                messages.map((message) => {
                  const mine = message.sender_id === profile?.id;
                  return (
                    <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`min-w-0 max-w-[90%] rounded-[14px] border border-transparent sm:max-w-[80%] px-5 py-3 text-sm shadow-[0_2px_5px_rgba(23,26,31,0.09)] ${
                          mine ? 'bg-primary-strong text-white' : 'bg-white text-text-dark'
                        }`}
                      >
                        <span className="sr-only">{mine ? 'You' : message.sender_name ?? active.counterpart_name ?? 'Contact'} said: </span>
                        {message.body ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body.split(/(https?:\/\/[^\s]+)/g).map((part, index) => /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="noreferrer" className="underline">{part}</a> : part)}</p> : null}
                        {message.attachment_url ? (
                          isImage(message.attachment_url) ? (
                            <a
                              href={message.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 block"
                            >
                              {/* Signed Supabase Storage URL — not a known-size local asset. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={message.attachment_url}
                                alt="Attachment"
                                className="max-h-64 rounded-[10px]"
                              />
                            </a>
                          ) : (
                            <a
                              href={message.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold underline ${
                                mine ? 'text-white' : 'text-primary-strong'
                              }`}
                            >
                              <PaperclipIcon className="size-4 shrink-0" />
                              Open attachment
                            </a>
                          )
                        ) : null}
                        <time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()} className={`mt-2 block text-xs ${mine ? 'text-white' : 'text-text-body'}`}>
                          {messageTimestamp(message.created_at)}
                        </time>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <FormMessage error={error} className="px-4 pb-2" />
            <p className="sr-only" role="status">{sendingId === activeId ? 'Sending message…' : ''}</p>
            {attachment ? (
              <p className="flex min-w-0 items-center gap-2 px-4 pb-2 text-xs text-text-body">
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Attachment: {attachment.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setAttachments(previous => ({ ...previous, [activeId!]: null }));
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                  disabled={sending}
                  className="min-h-10 shrink-0 font-semibold text-primary-strong hover:underline"
                >
                  Remove
                </button>
              </p>
            ) : null}

            <form className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border p-3 sm:p-5" onSubmit={send}>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                key={activeId}
                disabled={unavailable || sending}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && file.size > 5 * 1024 * 1024) {
                    setSendErrors(previous => ({ ...previous, [activeId!]: 'Choose an image or PDF smaller than 5 MB.' }));
                    event.target.value = '';
                    return;
                  }
                  setSendErrors(previous => ({ ...previous, [activeId!]: null }));
                  setAttachments(previous => ({ ...previous, [activeId!]: file }));
                }}
                className="peer sr-only"
                id="message-attachment"
              />
              <label
                htmlFor="message-attachment"
                title="Attach a file"
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border text-text-body peer-focus-visible:ring-2 peer-focus-visible:ring-primary hover:text-text-dark"
              >
                <PaperclipIcon className="size-5" /><span className="sr-only">Attach a file</span>
              </label>
              <input
                ref={composerRef}
                aria-label="Message"
                value={draft}
                disabled={unavailable}
                readOnly={sending}
                maxLength={4000}
                onChange={(event) => setDrafts(previous => ({ ...previous, [activeId!]: event.target.value }))}
                placeholder="Type a message..."
                className="h-11 min-w-0 flex-1 rounded-full border border-border bg-background px-4 text-sm text-text-dark outline-none focus:ring-2 focus:ring-primary"
              />
              <Button className="h-11 rounded-lg" disabled={sending || unavailable || (!draft.trim() && !attachment)}>
                {sendingId === activeId ? 'Sending…' : 'Send'}
              </Button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-text-body">
            {activeId ? <div className="p-5 text-center"><p role={current?.error ? 'alert' : 'status'}>{current?.error ?? 'Loading conversation…'}</p>{current?.error ? <Button variant="secondary" className="mt-3" onClick={() => setReload(value => value + 1)}>Retry conversation</Button> : null}</div> : 'Select a conversation to read and reply.'}
          </div>
        )}
      </Card>

      {aside ? <div className="hidden min-w-0 2xl:block">{aside}</div> : null}
    </div>
      )}
    </div>
  );
}

/** Lucide's paperclip, drawn in currentColor so it follows the control's text colour. */
function PaperclipIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
