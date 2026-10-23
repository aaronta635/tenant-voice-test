import { cleanup, click, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeHistory } from '@/app/test-utils/fake-history';
import MobileNav from './MobileNav';

const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/messages' }));
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => router.navigate(href)),
}));

afterEach(cleanup);

describe('MobileNav', () => {
  it('keeps the active item and its badge at AA contrast', async () => {
    const view = await render(
      <MobileNav items={[{ href: '/messages', label: 'Messages', badge: 3 }, { href: '/network', label: 'Network' }]} />,
    );
    await click(getByName(view, 'button', 'Open menu'));

    const menu = getByName(document.body as unknown as FakeElement, 'nav', 'Navigation menu');
    expect(textOf(getByName(menu, 'a', /^Messages/))).toBe('Messages3');
    expect(lowContrastText(menu)).toEqual([]);
  });
});

describe('MobileNav items that can point at the open page', () => {
  it('opens one marked withinPage through the History API there, and leaves the others to the router', async () => {
    const page = createFakeHistory('/search?type=profiles&role=tenant&q=jane');
    const leavePage = page.install(window);
    try {
      const items = [{ href: '/search?type=profiles&role=all', label: 'Find profiles', withinPage: true }, { href: '/properties', label: 'Rentals' }];
      const view = await render(<MobileNav items={items} />);
      const menu = () => getByName(document.body as unknown as FakeElement, 'nav', 'Navigation menu');

      await click(getByName(view, 'button', 'Open menu'));
      await click(getByName(menu(), 'a', 'Find profiles'));
      expect(page.stack()).toEqual(['/search?type=profiles&role=tenant&q=jane', '>/search?type=profiles&role=all']);
      expect(router.navigate).not.toHaveBeenCalled();

      await click(getByName(view, 'button', 'Open menu'));
      await click(getByName(menu(), 'a', 'Rentals'));
      expect(router.navigate).toHaveBeenCalledWith('/properties');
    } finally {
      leavePage();
    }
  });
});
