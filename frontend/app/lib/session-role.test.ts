import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtExpiringIn, stubBrowser } from './test-browser';

type SessionRoleModule = typeof import('./session-role');
let sessionRole: SessionRoleModule;
let browser: ReturnType<typeof stubBrowser>;
const WEEK = 60 * 60 * 24 * 7;

beforeEach(async () => {
  vi.resetModules();
  browser = stubBrowser();
  sessionRole = await import('./session-role');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('stored session liveness', () => {
  it('treats a JWT as usable only until its exp claim passes', () => {
    expect(sessionRole.isUnexpiredJwt(jwtExpiringIn(3600))).toBe(true);
    expect(sessionRole.isUnexpiredJwt(jwtExpiringIn(-60))).toBe(false);
    expect(sessionRole.isUnexpiredJwt('not-a-jwt')).toBe(false);
    expect(sessionRole.isUnexpiredJwt(null)).toBe(false);
  });

  it('reports no role once the cookie has expired and only a stale mirror is left', () => {
    browser.storage.set('tv_token', jwtExpiringIn(-8 * 24 * 60 * 60));
    browser.storage.set('tv_role', 'Client');
    expect(sessionRole.getClientSessionRole()).toBeNull();
  });

  it('keeps the role for a live cookie, or an unexpired mirror awaiting migration', () => {
    browser.storage.set('tv_role', 'Owner');
    browser.storage.set('tv_token', jwtExpiringIn(3600));
    expect(sessionRole.getClientSessionRole()).toBe('Owner');
    browser.storage.set('tv_token', jwtExpiringIn(-WEEK));
    browser.cookies.set('tv_token', jwtExpiringIn(-60));
    expect(sessionRole.getClientSessionRole()).toBe('Owner');
  });
});

describe('role cookie', () => {
  it('is Secure on HTTPS when set and when cleared', () => {
    sessionRole.setSessionRole('Client');
    sessionRole.clearSessionRole();
    expect(browser.cookieWrites).toEqual([
      `tv_role=Client; path=/; max-age=${WEEK}; SameSite=Lax; Secure`,
      'tv_role=; path=/; max-age=0; SameSite=Lax; Secure',
    ]);
  });

  it('stays usable over plain-HTTP local development', async () => {
    vi.resetModules();
    browser = stubBrowser({ protocol: 'http:' });
    sessionRole = await import('./session-role');
    sessionRole.setSessionRole('Owner');
    expect(browser.cookieWrites).toEqual([`tv_role=Owner; path=/; max-age=${WEEK}; SameSite=Lax`]);
  });
});
