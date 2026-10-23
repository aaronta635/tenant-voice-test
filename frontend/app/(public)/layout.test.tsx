import { cleanup, descendants, render, textOf } from '@/app/components/ui/test-dom';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRole } from '@/app/lib/session-role';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import PublicLayout from './layout';

const session = vi.hoisted(() => ({ role: null as string | null }));
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (!session.role) return undefined;
      return { value: name === 'tv_token' ? 'live-access' : session.role };
    },
  }),
}));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePathname: () => useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.location.pathname),
    useRouter: () => ({ push: (href: string) => navigation.page.navigate(href), refresh: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    profiles: { me: async () => null },
    providers: { mine: async () => null },
    dashboard: { owner: async () => null, ownerBadges: async () => null },
    conversations: { list: async () => [] },
    notifications: { list: async () => [] },
    connections: { list: async () => [] },
    content: { siteStats: async () => null },
  },
}));

let leavePage = () => {};
beforeEach(() => {
  navigation.page = createFakeHistory('/properties/pr-1');
  leavePage = navigation.page.install(window);
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(async () => {
  await cleanup();
  leavePage();
  document.cookie = '';
  session.role = null;
});

describe('a public page', () => {
  it.each<[SessionRole | null]>([[null], ['Client'], ['Owner'], ['Provider']])(
    'sits in exactly one main landmark, signed in as %s',
    async (role) => {
      session.role = role;
      if (role) document.cookie = `tv_token=live-access; tv_role=${role}`;
      const view = await render((await PublicLayout({ children: <p>Listing page</p> })) as ReactElement);

      const mains = descendants(view).filter((element) => element.tagName === 'MAIN');
      expect(mains).toHaveLength(1);
      expect(textOf(mains[0])).toContain('Listing page');
    },
  );
});
