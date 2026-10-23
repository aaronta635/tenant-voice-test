import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRole } from '@/app/lib/session-role';
import { isPageRoute } from '@/app/test-utils/app-routes';
import InspectionsPage from './page';

const session = vi.hoisted(() => ({ role: null as SessionRole | null }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => { throw new Error(`redirect ${href}`); }),
}));

vi.mock('next/navigation', () => ({ redirect: navigation.redirect }));
vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getSessionRole: async () => session.role,
}));

beforeEach(() => {
  navigation.redirect.mockClear();
});

describe('the /inspections link of an inspection notice', () => {
  it.each([
    ['Owner', '/owner/inspections'],
    ['Client', '/tenant/inspections'],
    ['Provider', '/dashboard'],
    [null, '/login?next=%2Finspections'],
  ] as const)('sends %s to %s, a page that exists', async (role, target) => {
    session.role = role;

    await expect(InspectionsPage()).rejects.toThrow(`redirect ${target}`);
    expect(navigation.redirect).toHaveBeenCalledTimes(1);
    expect(isPageRoute(target.split('?')[0])).toBe(true);
  });
});
