import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubBrowser } from './test-browser';
import {
  clearLegacyProfile,
  getTenantExtras,
  legacyPrivateDetails,
  legacyProfilePatch,
  legacyProfileSummary,
  saveTenantExtras,
} from './tenant-profile-extras';

const KEY = 'tv_tenant_profile_extras';
// 23 October 2026 in Sydney.
const NOW = new Date('2026-10-23T01:00:00Z');

/** Everything an older build's screens could keep here, as they stored it. */
const OLDER_BUILD = {
  emergency_name: 'Ines Lin',
  emergency_phone: '0411 222 333',
  employment: 'Full-time, Royal Prince Alfred',
  annual_income: '92000',
  financial_notes: 'Permanent since 2021',
  budget_min: '450',
  budget_max: '700',
  preferred_suburb: ' Newtown ',
  property_type: 'Apartment or townhouse',
  move_in: '2026-12-01',
  has_pets: true,
  qualities: ['Reliable rent payments', 'Looking for a long-term stay', 'Throws parties'],
  quality_notes: 'References on request',
  notify_applications: true,
  notify_messages: false,
  notify_matches: false,
  privacy_hide_profile: true,
  privacy_share_score: false,
  addresses: [
    { id: 'a1', address: '12 King Street', suburb: 'Newtown', from: '2021-02', to: '2024-06' },
    { id: 'a2', address: '', suburb: 'Nowhere', from: '', to: '' },
    { id: 'a3', address: '3 Queen Street', suburb: '', from: '2024-07', to: '2031-01' },
  ],
  passport_name: 'passport.jpg',
  passport_uploaded_at: '2026-05-01T00:00:00.000Z',
  id_document_name: '',
  id_uploaded_at: '',
};

let browser: ReturnType<typeof stubBrowser>;

function keep(values: object) {
  browser.storage.set(KEY, JSON.stringify(values));
}

function kept(): Record<string, unknown> | null {
  const raw = browser.storage.get(KEY);
  return raw === undefined ? null : JSON.parse(raw);
}

beforeEach(() => {
  browser = stubBrowser();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what an older build left in this browser', () => {
  it('becomes one profile save, in the fields the account keeps', () => {
    keep(OLDER_BUILD);

    expect(legacyProfilePatch(NOW)).toEqual({
      tenant: {
        budget_min: 450,
        budget_max: 700,
        preferred_locations: ['Newtown'],
        rental_preferences: { property_types: ['apartment', 'townhouse'] },
        move_in_date: '2026-12-01',
        has_pets: true,
        qualities: { tags: ['reliable_rent', 'long_term_stay'], notes: 'References on request' },
      },
      settings: {
        notification_preferences: { message: false, matches: false },
        privacy: { public_profile: false, share_score: false },
      },
    });
  });

  it('never puts the private details in that save: anyone may have used this browser', () => {
    keep(OLDER_BUILD);

    expect(legacyProfilePatch(NOW)?.tenant).not.toHaveProperty('emergency_contact');
    expect(legacyProfilePatch(NOW)?.tenant).not.toHaveProperty('employment');
    expect(legacyProfilePatch(NOW)?.tenant).not.toHaveProperty('rental_history');
    expect(legacyPrivateDetails(NOW)).toEqual(['an emergency contact', 'employment and income', '2 previous addresses']);
  });

  it('leaves out what the account would refuse', () => {
    keep({
      emergency_name: 'Ines Lin', emergency_phone: 'ring me', budget_min: '900', budget_max: '700',
      move_in: '2031-01-01', annual_income: '-5', property_type: 'Castle with a moat',
      addresses: [{ address: '1 Old Road', from: '2019-13', to: '2018-01' }],
    });

    expect(legacyProfilePatch(NOW)).toEqual({
      tenant: { budget_max: 700, rental_preferences: { notes: 'Castle with a moat' } },
    });
    expect(legacyPrivateDetails(NOW)).toEqual(['1 previous address']);
  });

  it('is nothing when only defaults, blanks or document names are there', () => {
    expect(legacyProfilePatch(NOW)).toBeNull();
    keep({
      emergency_name: '', budget_min: '', addresses: [], qualities: [], has_pets: false, notify_applications: true,
      notify_messages: true, notify_matches: true, privacy_hide_profile: false, privacy_share_score: true,
      passport_name: 'passport.jpg',
    });
    expect(legacyProfilePatch(NOW)).toBeNull();
    browser.storage.set(KEY, 'not json');
    expect(legacyProfilePatch(NOW)).toBeNull();
  });

  it('is named in words, with its values, so a person can tell whether it is theirs', () => {
    keep(OLDER_BUILD);

    expect(legacyProfileSummary(legacyProfilePatch(NOW)!)).toEqual([
      'Rental preferences: $450 to $700 a week, Newtown, apartment or townhouse, moving in 1 Dec 2026, with pets',
      'Tenant qualities: Reliable rent payments, Looking for a long-term stay, and a note',
      'Notification and privacy choices',
    ]);
  });
});

describe('clearing it', () => {
  it('keeps only the note of the ID file chosen in this browser', () => {
    keep(OLDER_BUILD);

    clearLegacyProfile();

    expect(kept()).toEqual({ passport_name: 'passport.jpg', passport_uploaded_at: '2026-05-01T00:00:00.000Z' });
    expect(legacyProfilePatch(NOW)).toBeNull();
  });

  it('removes the key when nothing else is left', () => {
    keep({ budget_max: '700' });

    clearLegacyProfile();

    expect(kept()).toBeNull();
  });
});

describe('the ID screens note', () => {
  it('reads and saves only the file names, leaving the rest for the offer', () => {
    keep({ budget_max: '700' });

    saveTenantExtras({ id_document_name: 'licence.pdf', id_uploaded_at: '2026-10-01T00:00:00.000Z' });

    expect(getTenantExtras()).toEqual({
      passport_name: '', passport_uploaded_at: '', id_document_name: 'licence.pdf', id_uploaded_at: '2026-10-01T00:00:00.000Z',
    });
    expect(kept()).toEqual({ budget_max: '700', id_document_name: 'licence.pdf', id_uploaded_at: '2026-10-01T00:00:00.000Z' });
  });
});
