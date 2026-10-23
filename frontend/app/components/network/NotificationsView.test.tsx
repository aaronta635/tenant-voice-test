import { cleanup, click, descendants, getByName, render, settle, surfaceStyle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { act, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Card from '@/app/components/ui/Card';
import type { NotificationItem } from '@/app/lib/api';
import NotificationsView from './NotificationsView';

const mockApi = vi.hoisted(() => ({
  notifications: { list: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
const router = vi.hoisted(() => ({ push: vi.fn(), pathname: '/tenant/notifications' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: router.push, refresh: vi.fn() }),
  usePathname: () => router.pathname,
}));
vi.mock('@/app/components/ui/Card', async (importOriginal) => {
  const { default: RealCard } = await importOriginal<typeof import('@/app/components/ui/Card')>();
  return { default: (props: ComponentProps<typeof RealCard>) => <RealCard data-card="" {...props} /> };
});

afterEach(cleanup);

describe('NotificationsView', () => {
  it('shows the feed in the shared card style', async () => {
    mockApi.notifications.list.mockResolvedValue([{
      id: 'n1', user_id: 'me', category: 'message', title: 'New message from Cleo Client', body: null,
      link_href: null, is_read: false, created_at: '2026-10-21T01:00:00Z',
    }]);
    const view = await render(<NotificationsView />);
    const plain = surfaceStyle((await render(<Card />)).children[0]);
    const cards = descendants(view).filter((element) => element.hasAttribute('data-card'));

    expect(textOf(view)).toContain('New message from Cleo Client');
    expect(cards).toHaveLength(1);
    expect(surfaceStyle(cards[0])).toEqual(plain);
  });
});

function notification(overrides: Partial<NotificationItem>): NotificationItem {
  return {
    id: 'n1', user_id: 'me', category: 'account', title: 'Lease signed', body: null,
    link_href: null, is_read: false, created_at: '2026-10-21T01:00:00Z',
    ...overrides,
  };
}

function article(view: FakeElement, title: string) {
  const found = descendants(view).find((element) => element.tagName === 'ARTICLE' && textOf(element).includes(title));
  if (!found) throw new Error(`No notification titled ${title}`);
  return found;
}

/** The message area under the header, for page-wide actions. */
function pageFeedback(view: FakeElement) {
  return descendants(view).find((element) => element.id === 'notification-feedback-page') as FakeElement;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('NotificationsView action feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.notifications.list.mockResolvedValue([
      notification({ id: 'n1', title: 'Lease signed' }),
      notification({ id: 'n2', title: 'Rent reminder' }),
    ]);
  });

  it('shows that a notification was marked read beside it and moves focus there', async () => {
    mockApi.notifications.markRead.mockResolvedValue(notification({ id: 'n2', title: 'Rent reminder', is_read: true }));
    const view = await render(<NotificationsView />);
    await click(getByName(view, 'button', 'Mark as read: Rent reminder'));

    expect(mockApi.notifications.markRead).toHaveBeenCalledWith('n2');
    const result = descendants(article(view, 'Rent reminder')).find((element) => element.id === 'notification-feedback-n2');
    expect(result && textOf(result)).toBe('Notification marked as read.');
    expect(document.activeElement).toBe(result);
    expect(textOf(article(view, 'Lease signed'))).not.toContain('marked as read');
    expect(textOf(pageFeedback(view))).toBe('');
  });

  it('keeps a failed mark-as-read beside the notification, with its button, and focuses the error', async () => {
    mockApi.notifications.markRead.mockRejectedValue(new Error('offline'));
    const view = await render(<NotificationsView />);
    await click(getByName(view, 'button', 'Mark as read: Rent reminder'));

    const result = descendants(article(view, 'Rent reminder')).find((element) => element.id === 'notification-feedback-n2');
    const alert = result && descendants(result).find((element) => element.getAttribute('role') === 'alert');
    expect(alert && textOf(alert)).toBe('Could not mark this notification as read. Please try again.');
    expect(document.activeElement).toBe(result);
    expect(getByName(article(view, 'Rent reminder'), 'button', 'Mark as read: Rent reminder')).toBeDefined();
    expect(textOf(pageFeedback(view))).toBe('');
  });

  it('reports Mark all as read under the header, not beside a notification', async () => {
    mockApi.notifications.markAllRead.mockResolvedValue([]);
    const view = await render(<NotificationsView />);
    await click(getByName(view, 'button', 'Mark all as read'));

    expect(textOf(pageFeedback(view))).toBe('All notifications marked as read.');
    expect(document.activeElement).toBe(pageFeedback(view));
    for (const title of ['Lease signed', 'Rent reminder']) expect(textOf(article(view, title))).not.toContain('marked as read');
  });

  it('still opens a linked notification when marking it read fails, without a message left behind', async () => {
    mockApi.notifications.list.mockResolvedValue([
      notification({ id: 'n3', category: 'message', title: 'New message from Cleo Client', link_href: '/dashboard/messages?thread=t1' }),
    ]);
    mockApi.notifications.markRead.mockRejectedValue(new Error('offline'));
    const view = await render(<NotificationsView />);
    await click(getByName(view, 'button', 'View notification: New message from Cleo Client'));

    expect(router.push).toHaveBeenCalledWith('/dashboard/messages?thread=t1');
    expect(descendants(view).filter((element) => element.getAttribute('role') === 'alert').map(textOf).join('')).toBe('');
  });

  it('leaves focus where the person moved it while a notification was marked read', async () => {
    const marked = deferred<NotificationItem>();
    mockApi.notifications.markRead.mockReturnValue(marked.promise);
    // The shell's header search sits outside the page.
    const view = await render(<><input aria-label="Search" /><NotificationsView /></>);
    await click(getByName(view, 'button', 'Mark as read: Rent reminder'));
    const search = getByName(view, 'input', 'Search');
    search.focus();

    await act(async () => marked.resolve(notification({ id: 'n2', title: 'Rent reminder', is_read: true })));
    await settle();
    expect(document.activeElement).toBe(search);
    expect(textOf(article(view, 'Rent reminder'))).toContain('Notification marked as read.');
  });

  it('leaves focus where the person moved it while Mark all as read saved', async () => {
    const marked = deferred<NotificationItem[]>();
    mockApi.notifications.markAllRead.mockReturnValue(marked.promise);
    const view = await render(<><input aria-label="Search" /><NotificationsView /></>);
    await click(getByName(view, 'button', 'Mark all as read'));
    const search = getByName(view, 'input', 'Search');
    search.focus();

    await act(async () => marked.resolve([]));
    await settle();
    expect(document.activeElement).toBe(search);
    expect(textOf(pageFeedback(view))).toBe('All notifications marked as read.');
  });
});

describe('NotificationsView live regions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.notifications.list.mockResolvedValue([
      notification({ id: 'n1', title: 'Lease signed' }),
      notification({ id: 'n2', title: 'Rent reminder' }),
    ]);
  });

  it('has a notification’s live region in place before its result arrives, and writes the result into it', async () => {
    const marked = deferred<NotificationItem>();
    mockApi.notifications.markRead.mockReturnValue(marked.promise);
    const view = await render(<NotificationsView />);
    const status = () => descendants(article(view, 'Rent reminder')).find((element) => element.getAttribute('role') === 'status');
    const idle = status();
    await click(getByName(view, 'button', 'Mark as read: Rent reminder'));

    // A live region added along with its text is often not read out.
    expect(idle).toBeDefined();
    expect(status()).toBe(idle);
    await act(async () => marked.resolve(notification({ id: 'n2', title: 'Rent reminder', is_read: true })));
    await settle();
    expect(status()).toBe(idle);
    expect(textOf(idle as FakeElement)).toBe('Notification marked as read.');
  });

  it('gives the empty region of a notification without a result no height', async () => {
    mockApi.notifications.markRead.mockResolvedValue(notification({ id: 'n2', title: 'Rent reminder', is_read: true }));
    const view = await render(<NotificationsView />);
    const region = (title: string, id: string) => descendants(article(view, title)).find((element) => element.id === `notification-feedback-${id}`) as FakeElement;
    await click(getByName(view, 'button', 'Mark as read: Rent reminder'));

    // Zero height in its own formatting context (overflow hidden), or the
    // empty message's paragraph margin would add 8px under the notification.
    expect(region('Lease signed', 'n1').className.split(' ').sort()).toEqual(['h-0', 'overflow-hidden']);
    expect(region('Rent reminder', 'n2').className).toBe('mt-2 scroll-mt-24');
  });
});

describe('NotificationsView links the mobile app wrote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    router.pathname = '/tenant/notifications';
  });

  it.each([
    ['/owner/notifications', '/admin/applications', '/owner/applications'],
    ['/tenant/notifications', '/admin/applications', '/tenant/applications'],
    ['/dashboard/notifications', '/admin/maintenance', '/dashboard/repairs'],
    ['/tenant/notifications', '/matches/property/b2000000-0000-4000-8000-000000000001',
      '/tenant/properties/b2000000-0000-4000-8000-000000000001'],
  ])('on %s opens %s at %s', async (pathname, link, page) => {
    router.pathname = pathname;
    mockApi.notifications.list.mockResolvedValue([notification({ id: 'n4', title: 'Update', link_href: link, is_read: true })]);
    const view = await render(<NotificationsView />);
    await click(getByName(view, 'button', 'View notification: Update'));

    expect(router.push).toHaveBeenCalledWith(page);
  });

  it('takes the reader from its role when given one', async () => {
    mockApi.notifications.list.mockResolvedValue([notification({ id: 'n5', title: 'Hi', link_href: '/messages', is_read: true })]);
    const view = await render(<NotificationsView role="service_provider" />);
    await click(getByName(view, 'button', 'View notification: Hi'));

    expect(router.push).toHaveBeenCalledWith('/dashboard/messages');
  });

  it('offers no page for a link it cannot place, which would open this page again', async () => {
    mockApi.notifications.list.mockResolvedValue([
      notification({ id: 'n6', title: 'Officer update', link_href: '/housing/red-flags' }),
    ]);
    mockApi.notifications.markRead.mockResolvedValue(notification({ id: 'n6', title: 'Officer update', is_read: true }));
    const view = await render(<NotificationsView />);

    expect(textOf(article(view, 'Officer update'))).not.toContain('View details');
    await click(getByName(view, 'button', 'Mark as read: Officer update'));
    expect(router.push).not.toHaveBeenCalled();
    expect(textOf(article(view, 'Officer update'))).toContain('Notification marked as read.');
  });
});
