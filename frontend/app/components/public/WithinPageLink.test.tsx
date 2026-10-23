import { cleanup, click, getByName, render } from '@/app/components/ui/test-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeHistory } from '@/app/test-utils/fake-history';
import WithinPageLink from './WithinPageLink';

const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => router.navigate(href)),
}));

let leavePage = () => {};
afterEach(async () => {
  await cleanup();
  leavePage();
  router.navigate.mockClear();
});

async function clickFrom(loaded: string) {
  const page = createFakeHistory(loaded);
  leavePage = page.install(window);
  const view = await render(<WithinPageLink href="/search?type=profiles&role=all" className="nav">Find profiles</WithinPageLink>);
  await click(getByName(view, 'a', 'Find profiles'));
  return page;
}

describe('WithinPageLink', () => {
  // After a full load with a query, next 16.2's router sends a link to that page back to the loaded URL.
  it('opens its href through the History API when that page is open', async () => {
    const page = await clickFrom('/search?type=profiles&role=tenant&q=jane');

    expect(page.stack()).toEqual(['/search?type=profiles&role=tenant&q=jane', '>/search?type=profiles&role=all']);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('leaves a link to another page to the router', async () => {
    const page = await clickFrom('/properties?q=Newtown');

    expect(router.navigate).toHaveBeenCalledWith('/search?type=profiles&role=all');
    expect(page.history.pushState).not.toHaveBeenCalled();
  });
});
