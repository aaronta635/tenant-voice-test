import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server';
import type { PlatformStats } from '@/app/lib/api';

const backend = vi.hoisted(() => ({ platformStats: (): Promise<PlatformStats> => new Promise(() => {}) }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { content: { platformStats: () => backend.platformStats() } },
}));
vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getRoleHomeHref: async () => '/',
}));

const figures: PlatformStats = { verified_providers: 1280, jobs_completed: 5400, average_rating: 4.8, satisfaction_pct: 97, review_count: 950, category_count: 12 };

beforeEach(() => { vi.resetModules(); });

/** The layout around a stand-in form, failing if it waits for the stats request. */
async function renderLayout() {
  const { default: AuthLayout } = await import('./layout');
  const blocked = new Promise<'blocked'>((resolve) => { setTimeout(() => resolve('blocked'), 100); });
  const layout = await Promise.race([AuthLayout({ children: <p>Sign-in form</p> }), blocked]);
  if (layout === 'blocked') throw new Error('The auth layout waited for the marketplace stats');
  return layout;
}

async function streamToEnd(layout: Awaited<ReturnType<typeof renderLayout>>) {
  const stream = await renderToReadableStream(layout);
  await stream.allReady;
  return new Response(stream).text();
}

describe('auth layout', () => {
  it('renders the form at once while the stats request is still pending', async () => {
    backend.platformStats = () => new Promise(() => {});
    const html = renderToStaticMarkup(await renderLayout());
    expect(html).toContain('Sign-in form');
    expect(html).not.toContain('jobs completed');
  });

  it('streams the marketplace stats in once they arrive', async () => {
    backend.platformStats = async () => figures;
    const html = await streamToEnd(await renderLayout());
    expect(html).toContain('Sign-in form');
    expect(html).toContain('1,280');
    expect(html).toContain('jobs completed');
  });

  it('leaves the stats out when the API cannot be reached', async () => {
    backend.platformStats = () => Promise.reject(new Error('Could not connect.'));
    const html = await streamToEnd(await renderLayout());
    expect(html).toContain('Sign-in form');
    expect(html).not.toContain('jobs completed');
  });

  it('claims only the checks the verification gates make before a listing or provider goes up', async () => {
    const html = renderToStaticMarkup(await renderLayout());

    // Publishing a listing and going live need a verified account; an ABN is optional (tracker R18, assumption #5).
    expect(html).toContain('Owners verify their ID and ownership before a listing is published');
    expect(html).toContain('Providers verify their ID and insurance before going live');
    expect(html).not.toContain('ABN');
    expect(html).not.toContain('before anyone lists');
  });
});
