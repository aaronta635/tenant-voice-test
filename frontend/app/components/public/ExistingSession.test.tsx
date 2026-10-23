import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { jwtExpiringIn, stubBrowser } from '@/app/lib/test-browser';

vi.mock('@/app/lib/use-client-ready', () => ({ useClientReady: () => true }));

let browser: ReturnType<typeof stubBrowser>;

beforeEach(() => {
  vi.resetModules();
  browser = stubBrowser({ pathname: '/login' });
});

afterEach(() => { vi.unstubAllGlobals(); });

async function render() {
  const { default: ExistingSession } = await import('./ExistingSession');
  return renderToStaticMarkup(<ExistingSession />);
}

describe('ExistingSession', () => {
  it('does not claim a session when only an expired localStorage token is left', async () => {
    browser.storage.set('tv_token', jwtExpiringIn(-8 * 24 * 60 * 60));
    browser.storage.set('tv_role', 'Client');
    expect(await render()).toBe('');
  });

  it('offers the workspace while the session cookie is live', async () => {
    browser.cookies.set('tv_token', 'live-access');
    browser.cookies.set('tv_role', 'Client');
    const html = await render();
    expect(html).toContain('You are already signed in.');
    expect(html).toContain('href="/tenant/dashboard"');
  });
});
