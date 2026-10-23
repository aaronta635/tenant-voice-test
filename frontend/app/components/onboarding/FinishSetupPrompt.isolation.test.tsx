import { cleanup, render, settle, textOf } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinishSetupPrompt from './FinishSetupPrompt';

// As a dashboard page's test mocks the API: the `api` object replaced, the rest kept.
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { dashboard: { tenant: vi.fn() } },
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const requests = vi.fn();

beforeEach(() => {
  requests.mockReset();
  vi.stubGlobal('fetch', requests);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the dashboard\'s "Finish setup" under a test that replaces the API', () => {
  it('asks no server for the setup progress, and shows nothing', async () => {
    const view = await render(<FinishSetupPrompt role="tenant" />);
    await settle();

    expect(requests).not.toHaveBeenCalled();
    expect(textOf(view)).toBe('');
  });
});
