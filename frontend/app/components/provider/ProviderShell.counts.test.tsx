import { cleanup, getByName, render, settle, textOf } from '@/app/components/ui/test-dom';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTS_POLL_MS } from '@/app/lib/provider-refresh';
import ProviderShell from './ProviderShell';

const mockApi = vi.hoisted(() => ({
  profiles: { me: vi.fn() },
  providers: { mine: vi.fn() },
  conversations: { list: vi.fn() },
  notifications: { list: vi.fn() },
  connections: { list: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/messages', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

// The shell checks the lg breakpoint, which the test DOM has no matchMedia for.
Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });

beforeEach(() => {
  // Only the header's poll is faked: render() settles on real timeouts.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  mockApi.profiles.me.mockResolvedValue(null);
  mockApi.providers.mine.mockResolvedValue(null);
  mockApi.notifications.list.mockResolvedValue([]);
  mockApi.connections.list.mockResolvedValue([]);
});
afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
});

describe('ProviderShell header on the inbox', () => {
  it('shows a message that arrives with no thread open on the next poll', async () => {
    mockApi.conversations.list.mockResolvedValue([{ unread_count: 0 }]);
    const view = await render(<ProviderShell><p>Inbox</p></ProviderShell>);
    const messages = () => getByName(view, 'a', /^Messages/);
    expect(messages().getAttribute('aria-label')).toBe('Messages');

    mockApi.conversations.list.mockResolvedValue([{ unread_count: 2 }]);
    await act(async () => { vi.advanceTimersByTime(COUNTS_POLL_MS); });
    await settle();
    expect(messages().getAttribute('aria-label')).toBe('Messages (2 unread)');
    expect(textOf(messages())).toBe('2');
  });
});
