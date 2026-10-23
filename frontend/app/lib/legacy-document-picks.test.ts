import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeLegacyDocumentPicks } from './legacy-document-picks';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

beforeEach(() => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

describe('takeLegacyDocumentPicks', () => {
  it('takes the tenant screens\' file names once and keeps the other extras', () => {
    localStorage.setItem('tv_tenant_profile_extras', JSON.stringify({
      passport_name: ' Passport.pdf ', passport_uploaded_at: '2026-09-01', id_document_name: '', id_uploaded_at: '',
      budget_max: '650',
    }));

    expect(takeLegacyDocumentPicks('tenant')).toEqual(['Passport.pdf']);
    expect(JSON.parse(localStorage.getItem('tv_tenant_profile_extras') as string)).toEqual({ budget_max: '650' });
    expect(takeLegacyDocumentPicks('tenant')).toEqual([]);
  });

  it('takes the owner page\'s file name once', () => {
    localStorage.setItem('tv_owner_identity_document', 'ID.png');

    expect(takeLegacyDocumentPicks('landlord')).toEqual(['ID.png']);
    expect(localStorage.getItem('tv_owner_identity_document')).toBeNull();
    expect(takeLegacyDocumentPicks('landlord')).toEqual([]);
  });

  it('leaves the other role\'s names alone', () => {
    localStorage.setItem('tv_owner_identity_document', 'ID.png');
    localStorage.setItem('tv_tenant_profile_extras', JSON.stringify({ passport_name: 'Passport.pdf' }));

    expect(takeLegacyDocumentPicks('tenant')).toEqual(['Passport.pdf']);
    expect(localStorage.getItem('tv_owner_identity_document')).toBe('ID.png');
  });

  it('finds nothing in broken or unavailable storage, and never throws', () => {
    localStorage.setItem('tv_tenant_profile_extras', '{not json');
    expect(takeLegacyDocumentPicks('tenant')).toEqual([]);
    expect(localStorage.getItem('tv_tenant_profile_extras')).toBe('{not json');

    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(takeLegacyDocumentPicks('tenant')).toEqual([]);
    expect(takeLegacyDocumentPicks('landlord')).toEqual([]);
  });
});
