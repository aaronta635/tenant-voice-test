import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAdminPath, isHousingPath } from './auth-redirect';
import { jwtExpiringIn, stubBrowser } from './test-browser';

type Modules = { staff: typeof import('./staff-session'); session: typeof import('./session-role'); api: typeof import('./api') };
let modules: Modules;
let browser: ReturnType<typeof stubBrowser>;

beforeEach(async () => {
  vi.resetModules();
  browser = stubBrowser();
  modules = {
    staff: await import('./staff-session'),
    session: await import('./session-role'),
    api: await import('./api'),
  };
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('the staff session', () => {
  it('keeps the tokens and the Admin role, and clears a stale workspace role', () => {
    browser.cookies.set('tv_role', 'Owner');
    browser.storage.set('tv_role', 'Owner');
    browser.storage.set('tv_explicit_logout', '1');
    const restored = vi.fn();
    browser.window.addEventListener('tenantvoice:session-restored', restored);

    modules.staff.startStaffSession('access-token', 'refresh-token');

    expect(modules.api.getAuthToken()).toBe('access-token');
    expect(modules.api.getRefreshToken()).toBe('refresh-token');
    expect(browser.storage.get('tv_role')).toBe('Admin');
    expect(browser.cookies.get('tv_role')).toBe('Admin');
    expect(browser.storage.has('tv_explicit_logout')).toBe(false);
    expect(restored).toHaveBeenCalledTimes(1);
    // An admin is no workspace role: no shell or workspace redirect takes them for a member.
    expect(modules.session.getClientSessionRole()).toBeNull();
    expect(modules.session.getClientStaffRole()).toBe('Admin');
  });

  it('keeps the Officer role for a Housing Portal officer, who is no member either', () => {
    modules.staff.startStaffSession('access-token', 'refresh-token', 'Officer');

    expect(browser.storage.get('tv_role')).toBe('Officer');
    expect(browser.cookies.get('tv_role')).toBe('Officer');
    expect(modules.session.getClientSessionRole()).toBeNull();
    expect(modules.session.getClientStaffRole()).toBe('Officer');
    expect(modules.staff.staffRoleOf('officer')).toBe('Officer');
    expect(modules.staff.staffRoleOf('admin')).toBe('Admin');
    expect(modules.staff.staffRoleOf('tenant')).toBeNull();
  });

  it('lands an officer on a Housing Portal page only', () => {
    expect(modules.staff.staffLanding('/housing/surveys', 'Officer')).toBe('/housing/surveys');
    expect(modules.staff.staffLanding('/admin/users', 'Officer')).toBe('/housing');
    expect(modules.staff.staffLanding(null, 'Officer')).toBe('/housing');
    expect(modules.staff.staffLanding('/housing', 'Admin')).toBe('/admin');
  });

  it('reports no staff role once signed out', () => {
    browser.storage.set('tv_role', 'Admin');
    expect(modules.session.getClientStaffRole()).toBeNull();
    browser.storage.set('tv_token', jwtExpiringIn(3600));
    expect(modules.session.getClientStaffRole()).toBe('Admin');
    expect(modules.session.parseStaffRole('Client')).toBeNull();
  });

  it('signs in on the staff page and lands on an admin page only', () => {
    expect(modules.staff.staffSignInHref()).toBe('/login?account=staff');
    expect(modules.staff.staffSignInHref('/admin/users')).toBe(`/login?account=staff&next=${encodeURIComponent('/admin/users')}`);
    expect(modules.staff.staffSignInHref('//evil.example')).toBe('/login?account=staff');
    expect(modules.staff.staffLanding('/admin/users?page=2')).toBe('/admin/users?page=2');
    expect(modules.staff.staffLanding('/owner')).toBe('/admin');
    expect(modules.staff.staffLanding('/administrator')).toBe('/admin');
    expect(modules.staff.staffLanding(null)).toBe('/admin');
  });
});

describe('housing paths', () => {
  it('tells Housing Portal pages from others', () => {
    expect(isHousingPath('/housing')).toBe(true);
    expect(isHousingPath('/housing/red-flags?x=1')).toBe(true);
    expect(isHousingPath('/housingfirst')).toBe(false);
    expect(isHousingPath('//evil.example/housing')).toBe(false);
    expect(isHousingPath(null)).toBe(false);
  });
});

describe('admin paths', () => {
  it('tells admin pages from others', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/users/1?x=1')).toBe(true);
    expect(isAdminPath('/admins')).toBe(false);
    expect(isAdminPath('//evil.example/admin')).toBe(false);
    expect(isAdminPath(null)).toBe(false);
  });
});
