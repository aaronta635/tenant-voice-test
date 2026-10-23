import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { adminDatapointApi, housingApi, referralActions } from './housing-api';

afterEach(() => vi.restoreAllMocks());

describe('the Housing Portal API', () => {
  it('reads each page from /housing', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue([]);

    await Promise.all([housingApi.me(), housingApi.overview(), housingApi.referrals(), housingApi.redFlags(), housingApi.complaints(),
      housingApi.datapointRequests(), housingApi.surveys(), housingApi.aggregates()]);

    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      '/housing/me', '/housing/overview', '/housing/referrals', '/housing/red-flags', '/housing/complaints',
      '/housing/datapoint-requests', '/housing/surveys', '/housing/aggregates',
    ]);
  });

  it('sends each change with the status the officer saw', async () => {
    const fetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});

    await housingApi.actOnReferral('ref 1', 'START_REVIEW', 'Asked the owner.');
    await housingApi.setFlagStatus('RF-1', 'Escalated', 'New');
    await housingApi.setSurveyStatus('SV-1', 'Live', 'Draft');
    await adminDatapointApi.answer('req-1', 'declined', 'Out of scope.', 'pending');

    expect(fetch.mock.calls).toEqual([
      ['/housing/referrals/ref%201/actions', { method: 'POST', body: { action: 'START_REVIEW', note: 'Asked the owner.' } }],
      ['/housing/red-flags/alerts/RF-1', { method: 'PATCH', body: { status: 'Escalated', from_status: 'New' } }],
      ['/housing/surveys/SV-1', { method: 'PATCH', body: { status: 'Live', from_status: 'Draft' } }],
      ['/admin/datapoint-requests/req-1', { method: 'PATCH', body: { status: 'declined', response: 'Out of scope.', from_status: 'pending' } }],
    ]);
  });
});

describe('the actions a referral offers', () => {
  it('follows the case from new to closed, and lets a closed one be reopened', () => {
    const actions = (status: string) => referralActions(status).map(({ action }) => action);

    expect(actions('REFERRED')).toEqual(['START_REVIEW', 'CLOSE']);
    expect(actions('UNDER_REVIEW')).toEqual(['PREPARE_PACKAGE', 'CLOSE']);
    expect(actions('PACKAGE_READY')).toEqual(['START_REVIEW', 'CLOSE']);
    expect(actions('CLOSED')).toEqual(['START_REVIEW']);
  });
});
