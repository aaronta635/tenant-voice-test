import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyTenant } from '@/app/test-utils/my-profile';
import type { Profile } from './api';
import {
  changedFields,
  completionScore,
  getMyProfile,
  hasTenantDetails,
  isEmail,
  isPhone,
  isPostcode,
  moveInRange,
  numberOrNull,
  placeList,
  sydneyToday,
  textOrNull,
  updateMyProfile,
  type TenantDetails,
} from './my-profile';

afterEach(() => { vi.unstubAllGlobals(); });

const EMPTY_TENANT = emptyTenant();

describe('own profile requests', () => {
  function signedIn(body: unknown) {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { cookie: 'tv_token=mei-access; tv_role=Client' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('reads the profile with the member token, and saves a patch to the same place', async () => {
    const fetchMock = signedIn({ id: 'mei' });

    await getMyProfile();
    await updateMyProfile({ phone: null, tenant: { employment: { employer: 'Acme' } }, settings: { privacy: { public_profile: false } } });

    const [[readUrl, read], [saveUrl, saved]] = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(new URL(readUrl).pathname).toMatch(/\/profiles\/me$/);
    expect(read).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer mei-access' } });
    expect(new URL(saveUrl).pathname).toMatch(/\/profiles\/me$/);
    expect(saved.method).toBe('PATCH');
    expect(JSON.parse(String(saved.body))).toEqual({
      phone: null, tenant: { employment: { employer: 'Acme' } }, settings: { privacy: { public_profile: false } },
    });
  });
});

describe('completion', () => {
  it('reads the score the server worked out, even from a response typed as a plain profile', () => {
    const profile = { id: 'mei', completion: { score: 53 } } as unknown as Profile;

    expect(completionScore(profile)).toBe(53);
    expect(completionScore({ id: 'olly', completion: null } as unknown as Profile)).toBe(0);
    expect(completionScore(null)).toBe(0);
  });
});

describe('whether a tenant saved details of their own', () => {
  it('is false for an empty section and true for any one detail', () => {
    expect(hasTenantDetails(null)).toBe(false);
    expect(hasTenantDetails(EMPTY_TENANT)).toBe(false);
    for (const detail of [
      { about_me: 'Hi' }, { budget_max: 0 }, { preferred_locations: ['Newtown'] }, { has_pets: true },
      { employment: { ...EMPTY_TENANT.employment, notes: 'x' } },
      { emergency_contact: { ...EMPTY_TENANT.emergency_contact, phone: '0400 000 000' } },
      { rental_history: [{ id: 'a' }] }, { qualities: { tags: ['reliable_rent'], notes: null } },
    ]) {
      expect(hasTenantDetails({ ...EMPTY_TENANT, ...detail } as TenantDetails)).toBe(true);
    }
  });
});

describe('form values', () => {
  it('sends cleared boxes as null', () => {
    expect([textOrNull('  '), textOrNull(' Acme ')]).toEqual([null, 'Acme']);
    expect([numberOrNull(''), numberOrNull(' 450 '), Number.isNaN(numberOrNull('lots'))]).toEqual([null, 450, true]);
  });

  it('picks out only the fields that differ from what the server holds', () => {
    const stored = { phone: 'call me', budget: 600, suburbs: ['Newtown'], notes: null as string | null };

    expect(changedFields(stored, { ...stored })).toEqual({});
    expect(changedFields(stored, { ...stored, suburbs: ['Newtown'] })).toEqual({});
    expect(changedFields(stored, { ...stored, budget: 650, suburbs: ['Newtown', 'Glebe'], notes: '' }))
      .toEqual({ budget: 650, suburbs: ['Newtown', 'Glebe'], notes: '' });
    // A number box that holds no number is a change to check, not the stored null.
    expect(changedFields({ income: null as number | null }, { income: Number.NaN })).toEqual({ income: Number.NaN });
  });

  it('reads suburbs from a comma list without blanks or repeats', () => {
    expect(placeList('Newtown, , glebe,Newtown ,Glebe')).toEqual(['Newtown', 'glebe']);
  });

  it('checks phones, emails and postcodes as the server does', () => {
    expect(['0400 000 000', '+61 (2) 9999-0000', '123456'].every(isPhone)).toBe(true);
    expect(['12', 'call me', '0400 000 000 0000 00'].some(isPhone)).toBe(false);
    expect([isEmail('ines@example.test'), isEmail('not-an-email')]).toEqual([true, false]);
    expect([isPostcode('2042'), isPostcode('20000'), isPostcode('20a2')]).toEqual([true, false, false]);
  });

  it('takes move-in dates from a year ago to two years ahead, counted in Sydney', () => {
    // 2026-10-22T20:00Z is already 23 October in Sydney.
    const now = new Date('2026-10-22T20:00:00Z');

    expect(sydneyToday(now)).toBe('2026-10-23');
    expect(moveInRange(now)).toEqual({ min: '2025-10-23', max: '2028-10-22' });
  });
});
