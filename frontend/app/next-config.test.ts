import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '@/next.config';

afterEach(() => { vi.unstubAllEnvs(); });

describe('next.config headers', () => {
  it('tells browsers to use HTTPS for a year on every production page', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(await nextConfig.headers?.()).toEqual([
      { source: '/:path*', headers: [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] },
    ]);
  });

  it('sends no HSTS from the development server', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(await nextConfig.headers?.()).toEqual([]);
  });
});
