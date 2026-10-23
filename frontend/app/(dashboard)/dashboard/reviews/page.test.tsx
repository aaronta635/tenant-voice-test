import { cleanup, click, descendants, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Review, ServiceProvider } from '@/app/lib/api';
import ReviewsPage from './page';

const mockApi = vi.hoisted(() => ({
  providers: { mine: vi.fn(), myReviews: vi.fn() },
  reviews: { reply: vi.fn(), flag: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

function review(overrides: Partial<Review>): Review {
  return {
    id: 'r1', booking_id: 'b1', provider_id: 'prov-1', client_id: 'mei', rating: 5, comment: 'Spotless bond clean.',
    provider_reply: null, replied_at: null, is_flagged: false, created_at: '2026-10-01T00:00:00Z',
    client_name: 'Mei Tanaka', client_avatar_url: null, service_title: 'Bond clean', location: 'Newtown',
    ...overrides,
  };
}

const mei = review({});
const sam = review({ id: 'r2', client_id: 'sam', client_name: 'Sam Lee', comment: 'On time.' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const focused = () => document.activeElement as unknown as FakeElement;

function card(view: FakeElement, name: string) {
  const found = descendants(view).find((element) => element.tagName === 'ARTICLE' && textOf(element).includes(name));
  if (!found) throw new Error(`No review card for ${name}`);
  return found;
}

/** Types a reply to Mei and posts it, with the Post reply button focused as a click leaves it. */
async function postReplyToMei(view: FakeElement) {
  await typeInto(descendants(view).find((element) => element.id === 'reply-r1') as FakeElement, 'Thanks, Mei!');
  const post = getByName(view, 'button', 'Post reply to Mei Tanaka');
  post.focus();
  await click(post);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.providers.mine.mockResolvedValue({ id: 'prov-1', is_published: true } as ServiceProvider);
  mockApi.providers.myReviews.mockResolvedValue([mei, sam]);
});
afterEach(cleanup);

describe('ReviewsPage cards', () => {
  it('hides the reviewer initials from screen readers, which read the name beside them', async () => {
    const view = await render(<ReviewsPage />);
    const initials = descendants(card(view, 'Mei Tanaka')).filter((element) => textOf(element) === 'MT');

    expect(getByName(view, 'h2', 'Mei Tanaka')).toBeTruthy();
    expect(initials).toHaveLength(1);
    expect(initials[0].getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ReviewsPage results', () => {
  it('moves focus to the card result once a reply posts', async () => {
    mockApi.reviews.reply.mockResolvedValue(review({ provider_reply: 'Thanks, Mei!', replied_at: '2026-10-02T00:00:00Z' }));
    const view = await render(<ReviewsPage />);
    await postReplyToMei(view);

    expect(mockApi.reviews.reply).toHaveBeenCalledWith('r1', 'Thanks, Mei!');
    expect(textOf(focused())).toBe('Reply posted.');
    expect(card(view, 'Mei Tanaka').contains(focused())).toBe(true);
  });

  it('leaves focus where the provider moved it while the reply posted', async () => {
    const posted = deferred<Review>();
    mockApi.reviews.reply.mockReturnValue(posted.promise);
    // The shell's header search sits outside the page.
    const view = await render(<><input aria-label="Search" /><ReviewsPage /></>);
    await postReplyToMei(view);
    const search = getByName(view, 'input', 'Search');
    search.focus();

    await act(async () => posted.resolve(review({ provider_reply: 'Thanks, Mei!', replied_at: '2026-10-02T00:00:00Z' })));
    await settle();
    expect(focused()).toBe(search);
    expect(textOf(card(view, 'Mei Tanaka'))).toContain('Reply posted.');
  });

  it('leaves focus in the next reply the provider started while the first one posted', async () => {
    const posted = deferred<Review>();
    mockApi.reviews.reply.mockReturnValue(posted.promise);
    const view = await render(<ReviewsPage />);
    await postReplyToMei(view);
    const nextReply = descendants(view).find((element) => element.id === 'reply-r2') as FakeElement;
    nextReply.focus();

    await act(async () => posted.resolve(review({ provider_reply: 'Thanks, Mei!', replied_at: '2026-10-02T00:00:00Z' })));
    await settle();
    expect(focused()).toBe(nextReply);
    expect(textOf(card(view, 'Mei Tanaka'))).toContain('Reply posted.');
  });
});
