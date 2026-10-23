import { describe, expect, it } from 'vitest';
import { safeNextPath } from './auth-redirect';
import { LIST_OPTIONS, listOptionHref, listOptionSignInHref } from './list-options';

const [service, property] = LIST_OPTIONS;
const query = (href: string) => Object.fromEntries(new URL(href, 'https://tenantvoice.test').searchParams);

describe('listOptionHref', () => {
  it('signs a visitor up for the account type each option needs, returning to its form', () => {
    expect(listOptionHref(service, null)).toBe(`/register?role=service_provider&next=${encodeURIComponent('/dashboard/services?new=1')}`);
    expect(query(listOptionHref(property, null) as string)).toEqual({ role: 'landlord', next: '/owner/properties/create' });
  });

  it('returns only forms the sign-up page accepts as a return path', () => {
    for (const option of LIST_OPTIONS) expect(safeNextPath(query(listOptionHref(option, null) as string).next)).toBe(option.form);
  });

  it('skips sign-up for the account type the form belongs to', () => {
    expect(listOptionHref(service, 'Provider')).toBe('/dashboard/services?new=1');
    expect(listOptionHref(property, 'Owner')).toBe('/owner/properties/create');
  });

  it('gives no link to another account type, which the workspace would turn away', () => {
    expect(listOptionHref(service, 'Owner')).toBeNull();
    expect(listOptionHref(service, 'Client')).toBeNull();
    expect(listOptionHref(property, 'Provider')).toBeNull();
    expect(listOptionHref(property, 'Client')).toBeNull();
  });
});

describe('listOptionSignInHref', () => {
  it('signs in as the account type the option needs and returns to its form', () => {
    expect(query(listOptionSignInHref(property))).toEqual({ role: 'landlord', next: '/owner/properties/create' });
    expect(query(listOptionSignInHref(service))).toEqual({ role: 'service_provider', next: '/dashboard/services?new=1' });
  });
});
