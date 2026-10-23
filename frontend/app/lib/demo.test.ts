import { describe, expect, it } from 'vitest';
import { isDemoAccount, isDemoProvider, isSampleEmail, isSamplePhone, sampleContactReason } from './demo';

const seedId = (prefix: string, number: number) => `${prefix}0000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

describe('demo accounts', () => {
  it.each([
    ['provider', 'a', 6],
    ['tenant', 'b', 9],
    ['landlord', 'c', 7],
    ['admin', 'd', 1],
  ])('recognises every seeded %s and no id past the last one', (_role, prefix, count) => {
    const ids = Array.from({ length: count }, (_, index) => seedId(prefix, index + 1));

    expect(ids.every(isDemoAccount)).toBe(true);
    expect(isDemoAccount(seedId(prefix, count + 1))).toBe(false);
    expect(isDemoAccount(seedId(prefix, 0))).toBe(false);
  });

  it('leaves real accounts and missing ids alone', () => {
    for (const id of ['e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000010', '3f6c2a1e-9b7d-4c1a-8e2f-5d4b3a291c0e', '', null, undefined]) {
      expect(isDemoAccount(id)).toBe(false);
    }
  });

  it('still tells the seeded providers from the other demo accounts', () => {
    expect(isDemoProvider(seedId('a', 1))).toBe(true);
    expect(isDemoProvider(seedId('c', 1))).toBe(false);
  });
});

describe('sample email addresses', () => {
  it.each(['support@tenantvoice.test', 'help@tenantvoice.invalid', 'team@example.com', 'a@b.example', 'me@localhost', ' SUPPORT@TENANTVOICE.TEST '])('treats %s as a sample', (email) => {
    expect(isSampleEmail(email)).toBe(true);
  });

  it.each(['support@tenantvoice.com.au', 'help@test.com', 'team@examples.com', '', null, undefined])('treats %s as real or absent', (email) => {
    expect(isSampleEmail(email)).toBe(false);
  });
});

describe('sample support numbers', () => {
  it.each(['1800 000 000', '1800 836 268', '1800836268'])('treats %s as a sample', (phone) => {
    expect(isSamplePhone(phone)).toBe(true);
  });

  it.each(['02 9000 0000', '1800 836 269', '', null, undefined])('treats %s as real or absent', (phone) => {
    expect(isSamplePhone(phone)).toBe(false);
  });
});

describe('the reason a support contact is labelled', () => {
  it('names only the parts that are placeholders', () => {
    expect(sampleContactReason({ email: 'support@tenantvoice.test', phone: '1800 836 268' })).toMatch(/email address and phone number are placeholders/);
    expect(sampleContactReason({ email: 'help@tenantvoice.com.au', phone: '1800 000 000' })).toMatch(/the phone number is a placeholder/);
    expect(sampleContactReason({ email: 'support@tenantvoice.test', phone: '02 9000 0000' })).toMatch(/the email address is a placeholder/);
    expect(sampleContactReason({ email: 'help@tenantvoice.com.au', phone: '02 9000 0000' })).toBeNull();
    expect(sampleContactReason(null)).toBeNull();
  });
});
