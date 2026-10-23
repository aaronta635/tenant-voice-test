import { cleanup, descendants, dispatch, getByName, render, settle, surfaceStyle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Card from '@/app/components/ui/Card';
import { ApiError, type Conversation, type Message } from '@/app/lib/api';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import ConversationsView from './ConversationsView';

const mockApi = vi.hoisted(() => ({
  conversations: { list: vi.fn(), get: vi.fn(), messages: vi.fn(), send: vi.fn(), markRead: vi.fn() },
  profiles: { me: vi.fn() },
  uploads: { messageAttachment: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
/** The query a test renders with; tests that change it open a fake history `page` instead. */
const navigation = vi.hoisted(() => ({ search: 'thread=t1', page: null as FakeHistory | null, push: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
    usePathname: () => '/dashboard/messages',
    useSearchParams: () => {
      const search = useSyncExternalStore(
        (listener) => navigation.page?.subscribe(listener) ?? (() => {}),
        () => navigation.page?.search ?? navigation.search,
      );
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('@/app/components/ui/Card', async (importOriginal) => {
  const { default: RealCard } = await importOriginal<typeof import('@/app/components/ui/Card')>();
  return { default: (props: ComponentProps<typeof RealCard>) => <RealCard data-card="" {...props} /> };
});

const thread: Conversation = {
  id: 't1', kind: 'marketplace', client_id: 'cleo', provider_id: 'prov', owner_id: null, tenant_id: null,
  property_id: null, booking_id: null, subject: null, last_message_at: '2026-10-21T01:00:00Z',
  created_at: '2026-10-20T01:00:00Z', counterpart_id: 'cleo', counterpart_name: 'Cleo Client',
  counterpart_role: 'tenant', counterpart_avatar_url: null, context: null, last_message: 'Can you quote?',
  last_message_sender_id: 'cleo', unread_count: 1, booking: null,
};
const incoming: Message = {
  id: 'm1', conversation_id: 't1', sender_id: 'cleo', sender_name: 'Cleo Client', body: 'Can you quote?',
  attachment_url: null, is_read: false, created_at: '2026-10-21T01:00:00Z',
};

function renderInbox() {
  return render(<ConversationsView title="Messages" emptyMessage="No conversations yet." />);
}

function composer(view: FakeElement) {
  return getByName(view, 'input', 'Message');
}

function alerts(view: FakeElement) {
  return descendants(view).filter((element) => element.getAttribute('role') === 'alert').map(textOf).join(' ');
}

async function send(view: FakeElement, body: string, file?: File) {
  await typeInto(composer(view), body);
  if (file) {
    const input = descendants(view).find((element) => element.id === 'message-attachment') as FakeElement;
    input.files = [file];
    await dispatch(input, 'change');
  }
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.search = 'thread=t1';
  mockApi.conversations.list.mockResolvedValue([thread]);
  mockApi.conversations.get.mockResolvedValue(thread);
  mockApi.conversations.messages.mockResolvedValue([incoming]);
  mockApi.conversations.markRead.mockResolvedValue(undefined);
  mockApi.profiles.me.mockResolvedValue({ id: 'prov', role: 'service_provider', full_name: 'Pat Provider' });
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ConversationsView send failures', () => {
  it('says why an attachment was rejected instead of asking for a retry', async () => {
    mockApi.uploads.messageAttachment.mockRejectedValue(
      new ApiError(415, 'Unsupported file type. Allowed: application/pdf, image/gif, image/jpeg, image/png, image/webp'),
    );
    const view = await renderInbox();
    await send(view, 'Quote attached', new File(['not a pdf'], 'quote.pdf', { type: 'application/pdf' }));

    expect(alerts(view)).toContain('Your attachment was not accepted. Unsupported file type.');
    expect(alerts(view)).toContain('Remove it or choose a different file');
    expect(alerts(view)).not.toContain('Please try again');
    expect(composer(view).value).toBe('Quote attached');
    expect(mockApi.conversations.send).not.toHaveBeenCalled();
  });

  it('shows the server reason for a refused message', async () => {
    mockApi.conversations.send.mockRejectedValue(new ApiError(403, 'You do not have access to this conversation'));
    const view = await renderInbox();
    await send(view, 'Hello');

    expect(alerts(view)).toContain('You do not have access to this conversation. Your draft is saved here.');
  });

  it('keeps the retry advice for server and network failures', async () => {
    mockApi.conversations.send.mockRejectedValue(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await renderInbox();
    await send(view, 'Hello');

    expect(alerts(view)).toContain('Could not send your message. Your draft is saved here. Please try again.');
  });
});

describe('ConversationsView read receipts', () => {
  it('keeps a loaded thread usable when marking it read fails, and retries', async () => {
    mockApi.conversations.markRead.mockRejectedValueOnce(new ApiError(502, 'The service is temporarily unavailable. Please try again.'));
    const countsChanged = vi.fn();
    window.addEventListener('tenantvoice:counts-changed', countsChanged);
    const view = await renderInbox();

    expect(textOf(view)).toContain('Can you quote?');
    expect(alerts(view)).not.toContain('Could not refresh this conversation');
    expect(composer(view).hasAttribute('disabled')).toBe(false);
    await typeInto(composer(view), 'On my way');
    expect(getByName(view, 'button', 'Send').hasAttribute('disabled')).toBe(false);
    expect(countsChanged).not.toHaveBeenCalled();

    await dispatch(document, 'visibilitychange');
    expect(mockApi.conversations.markRead).toHaveBeenCalledTimes(2);
    expect(countsChanged).toHaveBeenCalled();
    window.removeEventListener('tenantvoice:counts-changed', countsChanged);
  });
});

describe('ConversationsView attachments', () => {
  it('uses an svg icon, not an emoji, so the attach and open labels read cleanly', async () => {
    mockApi.conversations.messages.mockResolvedValue([{ ...incoming, attachment_url: 'https://files.example/quote.pdf?token=abc' }]);
    const view = await renderInbox();
    const attach = descendants(view).find((element) => element.tagName === 'LABEL' && element.getAttribute('for') === 'message-attachment') as FakeElement;
    const open = getByName(view, 'a', /attachment/);

    for (const control of [attach, open]) {
      const icons = descendants(control).filter((element) => element.tagName === 'svg');
      expect(icons).toHaveLength(1);
      expect(icons[0].getAttribute('aria-hidden')).toBe('true');
    }
    expect(textOf(attach)).toBe('Attach a file');
    expect(textOf(open)).toBe('Open attachment');
  });

  it('offers only the file types the attachment bucket takes', async () => {
    const view = await renderInbox();
    const input = descendants(view).find((element) => element.id === 'message-attachment') as FakeElement;

    // Chat files go to the message-attachments bucket, which takes GIF too (backend uploads.BUCKETS).
    expect(input.getAttribute('accept')).toBe('image/png,image/jpeg,image/gif,image/webp,application/pdf');
  });
});

describe('ConversationsView contrast', () => {
  it('keeps sent messages, unread badges and the active filter at AA contrast', async () => {
    const sent: Message = { ...incoming, id: 'm2', sender_id: 'prov', sender_name: 'Pat Provider', body: 'Happy to quote', is_read: true };
    mockApi.conversations.messages.mockResolvedValue([incoming, sent]);
    const view = await render(<ConversationsView title="Messages" emptyMessage="No conversations yet." showFilters />);

    expect(textOf(view)).toContain('Happy to quote');
    expect(getByName(view, 'button', 'All').getAttribute('aria-pressed')).toBe('true');
    expect(textOf(view)).toContain('1 unread messages');
    expect(lowContrastText(view)).toEqual([]);
  });
});

describe('ConversationsView cards', () => {
  it('shows the thread list and thread in the shared card style', async () => {
    const view = await renderInbox();
    const plain = surfaceStyle((await render(<Card />)).children[0]);
    const cards = descendants(view).filter((element) => element.hasAttribute('data-card'));

    expect(cards).toHaveLength(2);
    expect(cards.map(surfaceStyle)).toEqual([plain, plain]);
  });
});

describe('ConversationsView thread previews', () => {
  it("names a message sent with only an attachment and marks the viewer's own, as the Overview does", async () => {
    navigation.search = '';
    mockApi.conversations.list.mockResolvedValue([
      { ...thread, id: 't1', last_message: '', last_message_sender_id: 'cleo' },
      { ...thread, id: 't2', counterpart_name: 'Dana Owner', last_message: '', last_message_sender_id: 'prov' },
      { ...thread, id: 't3', counterpart_name: 'Eli Tenant', last_message: 'On my way', last_message_sender_id: 'prov' },
      { ...thread, id: 't4', counterpart_name: 'Fay New', last_message: null, last_message_sender_id: null, last_message_at: null },
    ]);
    const view = await renderInbox();
    const row = (name: string) => textOf(getByName(view, 'button', new RegExp(name)));

    expect(row('Cleo Client')).toContain('Sent an attachment');
    expect(row('Dana Owner')).toContain('You sent an attachment');
    expect(row('Eli Tenant')).toContain('You: On my way');
    expect(row('Fay New')).not.toMatch(/attachment|You:/);
  });
});

describe('ConversationsView empty inbox', () => {
  it('shows the shared empty state instead of two empty panes, then the inbox once a thread arrives', async () => {
    navigation.search = '';
    mockApi.conversations.list.mockResolvedValue([]);
    const view = await render(<ConversationsView title="Messages" emptyMessage="No conversations yet. Clients can message you from your public profile." showFilters />);
    const heading = getByName(view, 'h2', 'Your inbox is empty');

    expect(heading.parentElement?.hasAttribute('data-card')).toBe(true);
    expect(textOf(heading.parentElement as FakeElement)).toContain('Clients can message you from your public profile.');
    expect(textOf(view)).not.toContain('Select a conversation');
    expect(descendants(view).some((element) => element.getAttribute('aria-label') === 'Filter conversations')).toBe(false);

    mockApi.conversations.list.mockResolvedValue([thread]);
    await dispatch(window, 'focus');
    expect(getByName(view, 'button', /Cleo Client/).getAttribute('aria-pressed')).toBe('false');
    expect(textOf(view)).not.toContain('Your inbox is empty');
  });
});

/** A ResizeObserver whose callbacks a test fires for the element that changed size. */
const observers: { callback: () => void; targets: Set<unknown> }[] = [];
class TestResizeObserver {
  targets = new Set<unknown>();
  constructor(readonly callback: () => void) { observers.push(this); }
  observe(target: unknown) { this.targets.add(target); }
  unobserve(target: unknown) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
}

async function resize(element: FakeElement) {
  await act(async () => { for (const observer of observers) if (observer.targets.has(element)) observer.callback(); });
}

/** Puts the pane's top `top` px down the page, as content above it would. */
function placeGrid(grid: FakeElement, top: number) {
  Object.assign(grid, { getBoundingClientRect: () => ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) });
}

/**
 * Gives the message log a browser-like scroll box: 100px per message, a
 * visible height of the pane less 200px for the header and composer, and a
 * scrollTop kept between 0 and the end.
 */
function scrollableLog() {
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const element = createElement(tag) as unknown as FakeElement;
    const isLog = () => element.getAttribute('role') === 'log';
    const pane = () => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        const height = node.style.getPropertyValue('--conversation-height') as string;
        if (height) return parseFloat(height);
      }
      return 560;
    };
    let top = 0;
    const end = () => Math.max(0, element.scrollHeight - element.clientHeight);
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, get: () => (isLog() ? element.children.length * 100 : 0) },
      clientHeight: { configurable: true, get: () => (isLog() ? pane() - 200 : 0) },
      scrollTop: { configurable: true, get: () => Math.min(top, end()), set: (value: number) => { top = Math.max(0, Math.min(value, end())); } },
    });
    return element;
  }) as unknown as typeof document.createElement);
}

const longThread = Array.from({ length: 12 }, (_, index) => ({ ...incoming, id: `m${index}`, body: `Message ${index}` }));

/** The inbox inside a stand-in for the shell's content wrapper, where the demo notice appears. */
function renderInShell() {
  return render(<div data-shell=""><ConversationsView title="Messages" emptyMessage="No conversations yet." /></div>);
}

function shellOf(view: FakeElement) {
  return descendants(view).find((element) => element.hasAttribute('data-shell')) as FakeElement;
}

function gridOf(view: FakeElement) {
  return descendants(view).find((element) => element.style.getPropertyValue('--conversation-height')) as FakeElement;
}

function logOf(view: FakeElement) {
  return descendants(view).find((element) => element.getAttribute('role') === 'log') as FakeElement;
}

describe('ConversationsView layout', () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });

  it('fits the pane to the window again when content above it changes, such as the late demo notice', async () => {
    const view = await renderInShell();
    const shell = shellOf(view);
    const grid = gridOf(view);

    placeGrid(grid, 181);
    await resize(shell);
    expect(grid.style.getPropertyValue('--conversation-height')).toBe('603px');

    placeGrid(grid, 255);
    await resize(shell);
    expect(grid.style.getPropertyValue('--conversation-height')).toBe('529px');

    // Measured from the top of the page, so measuring while it is scrolled changes nothing.
    vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue({ top: -100 } as DOMRect);
    placeGrid(grid, 155);
    await resize(shell);
    expect(grid.style.getPropertyValue('--conversation-height')).toBe('529px');
  });

  it('opens a long thread at its latest message, even when the next frame comes before React renders it', async () => {
    scrollableLog();
    // A browser can run a frame callback before React has rendered new state;
    // running each one at once makes that order certain here.
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    // The messages arrive after the pane is measured, as over a real network.
    let deliver: (messages: Message[]) => void = () => {};
    mockApi.conversations.messages.mockReturnValue(new Promise<Message[]>((resolve) => { deliver = resolve; }));
    const view = await renderInShell();
    await act(async () => { deliver(longThread); });
    await settle();
    const log = logOf(view);

    expect(textOf(log)).toContain('Message 11');
    expect(log.scrollTop).toBeGreaterThan(0);
    expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);
  });

  it('shows a sent message at the end of the thread, even when the next frame comes before React renders it', async () => {
    scrollableLog();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    mockApi.conversations.messages.mockResolvedValue(longThread);
    mockApi.conversations.send.mockResolvedValue({ ...incoming, id: 'sent', sender_id: 'prov', body: 'On my way' });
    const view = await renderInShell();
    await send(view, 'On my way');
    const log = logOf(view);

    expect(textOf(log)).toContain('On my way');
    expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);
  });

  it('keeps the latest message in view when the pane shrinks', async () => {
    scrollableLog();
    mockApi.conversations.messages.mockResolvedValue(longThread);
    const view = await renderInShell();
    const log = logOf(view);
    expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);

    placeGrid(gridOf(view), 255);
    await resize(shellOf(view));

    expect(log.clientHeight).toBe(329);
    expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);
  });
});

describe('ConversationsView thread selection', () => {
  const dana: Conversation = { ...thread, id: 't2', client_id: 'dana', counterpart_id: 'dana', counterpart_name: 'Dana Owner', unread_count: 0 };
  let leavePage = () => {};
  /** A full load of the inbox with this query. */
  function openPage(search: string) {
    navigation.page = createFakeHistory(`/dashboard/messages${search}`);
    leavePage = navigation.page.install(window);
    return navigation.page;
  }
  /** Lets the view see the URL, as Next does once its history sync commits. */
  async function land(page: FakeHistory) {
    await act(async () => { page.land(); });
    await settle();
  }
  const openThread = (view: FakeElement) => logOf(view)?.getAttribute('aria-label') ?? null;

  beforeEach(() => {
    mockApi.conversations.list.mockResolvedValue([thread, dana]);
    mockApi.conversations.get.mockImplementation(async (id: string) => (id === 't2' ? dana : thread));
  });
  afterEach(async () => {
    await cleanup();
    leavePage();
    navigation.page = null;
  });

  // After a full load of a prerendered page with a query, next 16.2's router
  // sends every push or replace to that pathname back to the loaded URL.
  it('opens another thread through the History API, and Back returns to the first', async () => {
    const page = openPage('?thread=t1');
    const view = await renderInbox();
    expect(openThread(view)).toBe('Messages with Cleo Client');

    await dispatch(getByName(view, 'button', /Dana Owner/), 'click');
    expect(page.stack()).toEqual(['/dashboard/messages?thread=t1', '>/dashboard/messages?thread=t2']);
    await land(page);
    expect(openThread(view)).toBe('Messages with Dana Owner');
    expect(mockApi.conversations.get).toHaveBeenLastCalledWith('t2');

    page.history.back();
    await land(page);
    expect(openThread(view)).toBe('Messages with Cleo Client');
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('adds no entry for the thread already open', async () => {
    const page = openPage('?thread=t1');
    const view = await renderInbox();
    await dispatch(getByName(view, 'button', /Cleo Client/), 'click');
    expect(page.stack()).toEqual(['>/dashboard/messages?thread=t1']);
  });

  it('returns to the list as its own entry from All conversations', async () => {
    const page = openPage('?thread=t1');
    const view = await renderInbox();
    await dispatch(getByName(view, 'button', '← All conversations'), 'click');
    await land(page);

    expect(page.stack()).toEqual(['/dashboard/messages?thread=t1', '>/dashboard/messages']);
    expect(openThread(view)).toBeNull();
    expect(textOf(view)).toContain('Select a conversation to read and reply.');
  });
});
