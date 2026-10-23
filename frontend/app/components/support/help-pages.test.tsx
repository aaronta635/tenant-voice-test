/**
 * The support chat on each role's help page: the tenant Help & Support
 * screen, /owner/help, and /faqs, the provider workspace's "Help and FAQs",
 * where it shows for a signed-in member only.
 */
import { cleanup, descendants, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OwnerHelpPage from '@/app/(owner)/owner/help/page';
import FaqsPage from '@/app/(public)/faqs/page';
import TenantScreenTemplates from '@/app/components/tenant/TenantScreenTemplates';
import { getTenantScreen } from '@/app/lib/tenant-data';
import MemberSupportChat from './MemberSupportChat';

const faqs = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/app/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/app/lib/api')>();
  return { ...original, api: { ...original.api, content: { ...original.api.content, faqs: faqs.list } } };
});
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const chatOf = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'H2' && textOf(element) === 'Support chat');

beforeEach(() => {
  vi.clearAllMocks();
  faqs.list.mockResolvedValue([]);
  // Every other request the pages make fails, and they show their fallbacks.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  document.cookie = '';
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  document.cookie = '';
});

describe('the support chat on the help pages', () => {
  it('opens the tenant Help & Support screen, with tenant questions', async () => {
    const view = await render(<TenantScreenTemplates screen={getTenantScreen('help-support')!} />);

    expect(chatOf(view)).toHaveLength(1);
    expect(getByName(view, 'button', 'How do I apply for a property?')).toBeDefined();
  });

  it('is on the owner help page, with landlord questions', async () => {
    const view = await render(<OwnerHelpPage />);

    expect(chatOf(view)).toHaveLength(1);
    expect(getByName(view, 'button', 'How do I list a property?')).toBeDefined();
  });

  it('is on the FAQs for a signed-in provider, and never for a visitor', async () => {
    const visitor = await render(await FaqsPage());
    expect(chatOf(visitor)).toEqual([]);
    await cleanup();

    document.cookie = 'tv_token=token-provider; tv_role=Provider';
    const provider = await render(await FaqsPage());

    expect(chatOf(provider)).toHaveLength(1);
    expect(getByName(provider, 'button', 'How do I go live?')).toBeDefined();
  });

  it('stays on the FAQs when their questions cannot be loaded', async () => {
    faqs.list.mockRejectedValue(new Error('offline'));
    document.cookie = 'tv_token=token-tenant; tv_role=Client';

    const view = await render(await FaqsPage());

    expect(textOf(view)).toContain('Could not load help topics');
    expect(chatOf(view)).toHaveLength(1);
    expect(getByName(view, 'button', 'How do I apply for a property?')).toBeDefined();
  });
});

describe('MemberSupportChat', () => {
  it('shows nothing to a visitor', async () => {
    expect(textOf(await render(<MemberSupportChat />))).toBe('');
  });

  it("offers an admin the admin console's questions", async () => {
    document.cookie = 'tv_token=token-admin; tv_role=Admin';

    const view = await render(<MemberSupportChat />);

    expect(getByName(view, 'button', 'How do I review verification documents?')).toBeDefined();
  });
});
