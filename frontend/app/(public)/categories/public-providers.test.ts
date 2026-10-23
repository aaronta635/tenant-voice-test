import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderFilters, PublicProvider } from '@/app/lib/api';
import { listAllPublicProviders } from './public-providers';

const backend = vi.hoisted(() => ({ providers: [] as PublicProvider[], ignoresOffset: false, calls: [] as unknown[] }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    providers: {
      // Like GET /providers: at most 100 rows a request, from `offset`.
      listPublic: async (filters: ProviderFilters = {}) => {
        backend.calls.push(filters);
        const limit = Math.min(filters.limit ?? 20, 100);
        const offset = backend.ignoresOffset ? 0 : filters.offset ?? 0;
        return backend.providers.slice(offset, offset + limit);
      },
    },
  },
}));

const providers = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}` }) as PublicProvider);

beforeEach(() => {
  backend.providers = [];
  backend.ignoresOffset = false;
  backend.calls = [];
});

describe('listAllPublicProviders', () => {
  it('loads every page instead of stopping at the first 100 providers', async () => {
    backend.providers = providers(250);
    expect((await listAllPublicProviders({ category: 'tradies' })).map((provider) => provider.id)).toEqual(backend.providers.map((provider) => provider.id));
    expect(backend.calls).toEqual([0, 100, 200].map((offset) => ({ category: 'tradies', limit: 100, offset })));
  });

  it('stops after a full last page once the next page is empty', async () => {
    backend.providers = providers(100);
    expect(await listAllPublicProviders()).toHaveLength(100);
    expect(backend.calls).toHaveLength(2);
  });

  it('stops when a page brings no new providers, so an ignored offset cannot loop forever', async () => {
    backend.providers = providers(150);
    backend.ignoresOffset = true;
    expect(await listAllPublicProviders()).toHaveLength(100);
    expect(backend.calls).toHaveLength(2);
  });
});
