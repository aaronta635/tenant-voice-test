import { describe, expect, it, vi } from 'vitest';
import Layout from './layout';

const request = vi.hoisted(() => ({ connection: vi.fn(async () => {}) }));
vi.mock('next/server', () => ({ connection: request.connection }));

describe('provider workspace layout', () => {
  // A prerendered page carries an empty query, and next 16.2 caches its route
  // under it with the loaded URL as the address, so a later push to the same
  // path with another query (a "Message" button) lands on the loaded one.
  it('renders on request, so a full load carries the query it was opened with', async () => {
    const children = <p>Page</p>;

    expect(await Layout({ children })).toBe(children);
    expect(request.connection).toHaveBeenCalledTimes(1);
  });
});
