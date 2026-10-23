import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./api', () => http);

import { providerJobs } from './provider-jobs';

beforeEach(() => http.apiFetch.mockReset().mockResolvedValue({}));

describe('the job requests API', () => {
  it('lists the provider\'s own and moves one on', async () => {
    await providerJobs.list();
    await providerJobs.move('j1', 'in_progress');

    expect(http.apiFetch.mock.calls).toEqual([
      ['/me/job-requests'],
      ['/me/job-requests/j1/status', { method: 'POST', body: { status: 'in_progress' } }],
    ]);
  });
});
