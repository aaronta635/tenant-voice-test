import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { adminRepairsApi, parseRepairFilters, repairFiltersHref } from './admin-repairs-api';

afterEach(() => vi.restoreAllMocks());

describe("the repairs page's URL", () => {
  it('reads and writes the status, priority, search and page', () => {
    expect(parseRepairFilters(new URLSearchParams('status=in_progress&priority=urgent&q=pipe&page=2'))).toEqual({
      status: 'in_progress', priority: 'urgent', q: 'pipe', page: 2,
    });
    expect(repairFiltersHref({ status: 'in_progress', priority: 'urgent', q: ' pipe ', page: 2 })).toBe(
      '/admin/repairs?status=in_progress&priority=urgent&q=pipe&page=2');
    expect(repairFiltersHref({ status: '', priority: '', q: '', page: 1 })).toBe('/admin/repairs');
  });

  it('reads a value it does not know as no filter', () => {
    expect(parseRepairFilters(new URLSearchParams('status=OPEN&priority=high&page=-1'))).toEqual({
      status: '', priority: '', q: '', page: 1,
    });
  });
});

describe('the requests', () => {
  it('page the list and name the work order status the admin saw', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});

    await adminRepairsApi.list({ status: 'open', priority: '', q: ' pipe ', page: 3 });
    await adminRepairsApi.decide({ id: 'r 1', work_status: 'SCHEDULED' }, 'cancel', '  Moved out  ');

    expect(fetch.mock.calls).toEqual([
      ['/admin/repairs', { query: { status: 'open', priority: '', q: 'pipe', limit: 20, offset: 40 } }],
      ['/admin/repairs/r%201/decision', { method: 'POST', body: { action: 'cancel', reason: 'Moved out', expected_status: 'SCHEDULED' } }],
    ]);
  });
});
