import { describe, expect, it } from 'vitest';
import { authPageHref, registerLanding, safeNextPath, roleForSignIn, roleForSignUp } from './auth-redirect';

describe('safeNextPath', () => {
  it.each([null, '', 'https://example.org', '//example.org', '/\\example.org/phish', '/%5Cexample.org/phish', '/%09/example.org', '/%255cexample.org', '/%0a/example.org', '/%2fexample.org', '/\\\\example.org', '/%'])('rejects unsafe redirect %s', (value) => expect(safeNextPath(value)).toBeNull());
  it.each(['/a/..//evil.com', '/..//evil.com', '/x/../..//evil.com/path', '/%2e%2e//evil.com', '/././/evil.com'])('rejects dot segments that normalise to another host: %s', (value) => expect(safeNextPath(value)).toBeNull());
  it.each(['/dashboard/bookings', '/owner/properties?q=Sydney', '/providers/amelia?service=123&slot=2026-10-04%7C09%3A00%3A00#booking'])('preserves safe return path %s', (value) => expect(safeNextPath(value)).toBe(value));
  it('still resolves harmless dot segments to a local path', () => expect(safeNextPath('/dashboard/../owner')).toBe('/owner'));
  it('infers the requested workspace without misreading similarly named routes', () => {
    expect(roleForSignIn(null,'/owner/properties')).toBe('Owner');
    expect(roleForSignIn(null,'/tenant/bookings')).toBe('Client');
    expect(roleForSignIn(null,'/dashboard/bookings')).toBe('Provider');
    expect(roleForSignIn('landlord','/providers/amelia')).toBe('Owner');
  });
  it('preselects no account type for marketplace pages and the plain sign-in link', () => {
    // Every account type books providers; a guessed tab gets the sign-in refused.
    expect(roleForSignIn(null,'/providers/amelia?service=svc-1#booking')).toBeNull();
    expect(roleForSignIn(null,'/ownership')).toBeNull();
    expect(roleForSignIn(null,'/dashboards')).toBeNull();
    expect(roleForSignIn(null,null)).toBeNull();
    expect(roleForSignIn(null,'//evil.example/owner')).toBeNull();
  });
});

describe('sign-up return path', () => {
  const booking = '/providers/amelia?service=svc-1&slot=2026-10-27%7C10%3A00%3A00&suburb=Newtown#booking';
  it('sends a new account back to the page that asked it to sign in', () => {
    expect(registerLanding('Client', booking)).toBe(booking);
    expect(registerLanding('Provider', '/providers/amelia')).toBe('/providers/amelia');
  });
  it('starts every role\'s new account with its onboarding without a safe return path', () => {
    expect(registerLanding('Provider', null)).toBe('/dashboard/onboarding');
    expect(registerLanding('Owner', null)).toBe('/owner/onboarding');
    expect(registerLanding('Client', null)).toBe('/tenant/onboarding');
    expect(registerLanding('Client', '//evil.example')).toBe('/tenant/onboarding');
  });
  it('sends a new provider through onboarding first when the task is in the provider workspace', () => {
    // A new provider has no provider profile yet, so the services page could not add one.
    expect(registerLanding('Provider', '/dashboard/services?new=1')).toBe(`/dashboard/onboarding?next=${encodeURIComponent('/dashboard/services?new=1')}`);
    expect(registerLanding('Provider', '/dashboard/onboarding')).toBe('/dashboard/onboarding');
  });
  it('holds a task in the landlord or tenant workspace until onboarding, which carries it', () => {
    expect(registerLanding('Owner', '/owner/properties/create')).toBe(`/owner/onboarding?next=${encodeURIComponent('/owner/properties/create')}`);
    expect(registerLanding('Client', '/tenant/properties/pr-1')).toBe(`/tenant/onboarding?next=${encodeURIComponent('/tenant/properties/pr-1')}`);
    expect(registerLanding('Owner', '/owner/onboarding')).toBe('/owner/onboarding');
    expect(registerLanding('Client', '/tenant/onboarding?next=%2Ftenant%2Fbookings')).toBe('/tenant/onboarding?next=%2Ftenant%2Fbookings');
  });
  it('takes a new account straight to a page outside every workspace', () => {
    expect(registerLanding('Owner', '/providers/amelia')).toBe('/providers/amelia');
  });
  it('starts a new account at its own onboarding when the task is in another role\'s workspace', () => {
    // A visitor picked "List your property", then signed up as a tenant: /owner would turn them away.
    expect(registerLanding('Client', '/owner/properties/create')).toBe('/tenant/onboarding');
    expect(registerLanding('Owner', '/dashboard/services?new=1')).toBe('/owner/onboarding');
    expect(registerLanding('Provider', '/tenant/bookings')).toBe('/dashboard/onboarding');
  });
  it('gives a new account the type its link names, else Tenant for a booking, else Service provider', () => {
    expect(roleForSignUp('landlord', booking)).toBe('Owner');
    expect(roleForSignUp(null, booking)).toBe('Client');
    expect(roleForSignUp(null, '/owner/properties')).toBe('Owner');
    expect(roleForSignUp(null, null)).toBe('Provider');
  });
  it('links to sign-up without a role when no account type was chosen', () => {
    expect(authPageHref('/register', null, booking)).toBe(`/register?next=${encodeURIComponent(booking)}`);
    expect(authPageHref('/register', null, '//evil.example')).toBe('/register');
  });
  it('links between sign-in and sign-up with the role and only a safe next', () => {
    const link = new URL(authPageHref('/register', 'tenant', booking), 'https://tenantvoice.invalid');
    expect(link.pathname).toBe('/register');
    expect(link.searchParams.get('role')).toBe('tenant');
    expect(link.searchParams.get('next')).toBe(booking);
    expect(authPageHref('/login', 'landlord', null)).toBe('/login?role=landlord');
    expect(authPageHref('/login', 'landlord', 'https://evil.example')).toBe('/login?role=landlord');
  });
});
