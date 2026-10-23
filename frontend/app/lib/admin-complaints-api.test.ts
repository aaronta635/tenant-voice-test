import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import {
  adminComplaintsApi,
  codeFromName,
  complaintFiltersHref,
  complaintStatusLabel,
  parseComplaintFilters,
  splitWords,
  statusAction,
  stepStatusLabel,
} from './admin-complaints-api';

afterEach(() => vi.restoreAllMocks());

describe('the complaints page URL', () => {
  it('reads and writes the filters, dropping unknown values', () => {
    const admin = 'a3000000-0000-4000-8000-000000000001';
    const filters = parseComplaintFilters(new URLSearchParams(`status=ESCALATED&category=SAFETY&assignee=${admin}&q=heater&page=2`));
    expect(filters).toEqual({ status: 'ESCALATED', category: 'SAFETY', assignee: admin, q: 'heater', page: 2 });
    expect(complaintFiltersHref(filters)).toBe(`/admin/complaints?status=ESCALATED&category=SAFETY&assignee=${admin}&q=heater&page=2`);
    expect(parseComplaintFilters(new URLSearchParams(`status=dismissed&category=${'x'.repeat(61)}&assignee=bob&page=0`))).toEqual({
      status: '', category: '', assignee: '', q: '', page: 1,
    });
    expect(parseComplaintFilters(new URLSearchParams('assignee=me')).assignee).toBe('me');
    // Another app's names for a category, as the filter offers them, are kept and written back.
    for (const name of ['Noise/Disturbance', 'Pest & vermin', 'a,b']) {
      const kept = parseComplaintFilters(new URLSearchParams({ category: name }));
      expect(kept.category).toBe(name);
      expect(parseComplaintFilters(new URL(complaintFiltersHref(kept), 'https://tv.test').searchParams).category).toBe(name);
    }
    expect(complaintFiltersHref({ status: '', category: '', assignee: '', q: ' ', page: 1 })).toBe('/admin/complaints');
  });
});

describe('statuses in words', () => {
  it('names a withdrawn complaint, each move and both vocabularies of the timeline', () => {
    expect(complaintStatusLabel({ status: 'CLOSED', withdrawn: true })).toBe('Withdrawn');
    expect(complaintStatusLabel({ status: 'IN_REVIEW', withdrawn: false })).toBe('In review');
    expect(statusAction('RESOLVED', 'IN_REVIEW')).toBe('Reopen');
    expect(statusAction('OPEN', 'IN_REVIEW')).toBe('Move to review');
    expect(statusAction('IN_REVIEW', 'RESOLVED')).toBe('Resolve');
    expect([stepStatusLabel('ESCALATED'), stepStatusLabel('under_review'), stepStatusLabel('dismissed'), stepStatusLabel(null)]).toEqual([
      'Escalated', 'Under review', 'Withdrawn', null]);
  });
});

describe('policy fields', () => {
  it('splits typed lists and shows the code the database derives from the name', () => {
    expect(splitWords(' flood, Burst  pipe ,\nflood,, ')).toEqual(['flood', 'Burst pipe']);
    // As mobile_admin_save_issue_category: non-alphanumerics to _, lower case, no _ at either end.
    expect(codeFromName('Pest control & vermin')).toBe('pest_control_vermin');
    expect(codeFromName(' Mould/Damp! ')).toBe('mould_damp');
    expect(codeFromName('  ')).toBe('');
  });
});

describe('the requests', () => {
  it('name the status the admin saw, trim notes and send the category version', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});

    await adminComplaintsApi.setStatus({ id: 'c 1', status: 'OPEN' }, 'IN_REVIEW', '  Asked the owner.  ');
    await adminComplaintsApi.assign('c-2', null, '   ');
    await adminComplaintsApi.updateCategory({ id: 'cat-1', updated_at: '2026-10-20T00:00:00Z' }, { name: 'Damp' });
    await adminComplaintsApi.setCategoryActive('cat-1', false, ' Merged ');
    await adminComplaintsApi.list({ status: '', category: 'SAFETY', assignee: 'me', q: ' mould ', page: 3 });

    expect(fetch.mock.calls).toEqual([
      ['/admin/complaints/c%201/status', { method: 'POST', body: { status: 'IN_REVIEW', note: 'Asked the owner.', expected_status: 'OPEN' } }],
      ['/admin/complaints/c-2/assignment', { method: 'POST', body: { assignee_id: null, note: null } }],
      ['/admin/complaint-categories/cat-1', { method: 'PATCH', body: { name: 'Damp', expected_updated_at: '2026-10-20T00:00:00Z' } }],
      ['/admin/complaint-categories/cat-1/active', { method: 'POST', body: { is_active: false, reason: 'Merged' } }],
      ['/admin/complaints', { query: { status: '', category: 'SAFETY', assignee: 'me', q: 'mould', limit: 20, offset: 40 } }],
    ]);
  });
});
