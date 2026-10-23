import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { adminApi, parseUserFilters, parseVerificationFilters, queueRoleOf, userFiltersHref, verificationHref } from './admin-api';

afterEach(() => vi.restoreAllMocks());

describe('the users page URL', () => {
  it('reads and writes the filters, dropping unknown values', () => {
    const filters = parseUserFilters(new URLSearchParams('role=landlord&status=SUSPENDED&q=leo&page=3'));
    expect(filters).toEqual({ role: 'landlord', status: 'SUSPENDED', q: 'leo', page: 3 });
    expect(userFiltersHref(filters)).toBe('/admin/users?role=landlord&status=SUSPENDED&q=leo&page=3');
    expect(parseUserFilters(new URLSearchParams('role=root&status=gone&page=-2'))).toEqual({ role: '', status: '', q: '', page: 1 });
    expect(userFiltersHref({ role: '', status: '', q: '  ', page: 1 })).toBe('/admin/users');
  });
});

describe('the verification page URL', () => {
  it('reads and writes the tab, status and page, with tenants in review as the default', () => {
    const filters = parseVerificationFilters(new URLSearchParams('role=provider&status=REJECTED&page=2'));
    expect(filters).toEqual({ role: 'provider', status: 'REJECTED', page: 2 });
    expect(verificationHref(filters)).toBe('/admin/verification?role=provider&status=REJECTED&page=2');
    expect(parseVerificationFilters(new URLSearchParams('role=admin&status=pending&page=x'))).toEqual({
      role: 'tenant', status: 'PENDING', page: 1,
    });
    expect(verificationHref({ role: 'tenant', status: 'PENDING', page: 1 })).toBe('/admin/verification');
  });

  it('files each web role under its tab, and staff under none', () => {
    expect([queueRoleOf('tenant'), queueRoleOf('landlord'), queueRoleOf('service_provider')]).toEqual([
      'tenant', 'landlord', 'provider']);
    expect([queueRoleOf('admin'), queueRoleOf('officer')]).toEqual([null, null]);
  });
});

describe('verification decisions', () => {
  it('name the version of the document the admin saw, and send a rejection reason trimmed', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});

    await adminApi.decideDocument({ id: 'doc 1', updated_at: '2026-10-20T00:00:00.123456Z' }, 'REJECTED', '  Blurred  ');
    await adminApi.decideDocument({ id: 'doc-2', updated_at: '2026-10-21T00:00:00Z' }, 'APPROVED');
    await adminApi.decideAccount('mia', 'APPROVED');

    expect(fetch.mock.calls).toEqual([
      ['/admin/documents/doc%201/decision', {
        method: 'POST', body: { decision: 'REJECTED', reason: 'Blurred', expected_updated_at: '2026-10-20T00:00:00.123456Z' },
      }],
      ['/admin/documents/doc-2/decision', {
        method: 'POST', body: { decision: 'APPROVED', reason: null, expected_updated_at: '2026-10-21T00:00:00Z' },
      }],
      ['/admin/users/mia/verification', { method: 'POST', body: { decision: 'APPROVED', reason: null } }],
    ]);
  });
});
