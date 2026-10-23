/**
 * File names the old documents screens kept in this browser instead of
 * uploading anything: the tenant ID screens wrote them into the profile
 * extras (lib/tenant-profile-extras), the owner verification page under its
 * own key. They were never sent anywhere, so they are never shown as
 * uploaded. The documents panel takes them once, says they were not
 * uploaded, and they are gone from this browser.
 */

export type LegacyPickRole = 'tenant' | 'landlord';

const TENANT_EXTRAS_KEY = 'tv_tenant_profile_extras';
// Each old file-name field with the timestamp it was saved with.
const TENANT_PICK_FIELDS: [name: string, savedAt: string][] = [
  ['passport_name', 'passport_uploaded_at'],
  ['id_document_name', 'id_uploaded_at'],
];
const OWNER_PICK_KEY = 'tv_owner_identity_document';

function tenantPicks(): string[] {
  const raw = localStorage.getItem(TENANT_EXTRAS_KEY);
  if (!raw) return [];
  let extras: Record<string, unknown>;
  try {
    extras = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!extras || typeof extras !== 'object') return [];
  const names: string[] = [];
  let changed = false;
  for (const fields of TENANT_PICK_FIELDS) {
    const name = extras[fields[0]];
    if (typeof name === 'string' && name.trim()) names.push(name.trim());
    for (const field of fields) {
      if (field in extras) {
        delete extras[field];
        changed = true;
      }
    }
  }
  // The rest of the extras (contact details, preferences, ...) stay as they were.
  if (changed) localStorage.setItem(TENANT_EXTRAS_KEY, JSON.stringify(extras));
  return names;
}

function ownerPicks(): string[] {
  const name = localStorage.getItem(OWNER_PICK_KEY);
  localStorage.removeItem(OWNER_PICK_KEY);
  return name?.trim() ? [name.trim()] : [];
}

/** The names the old screen kept for this role, removed from this browser as they are read. */
export function takeLegacyDocumentPicks(role: LegacyPickRole): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return role === 'tenant' ? tenantPicks() : ownerPicks();
  } catch {
    // Storage can be unavailable (private mode, blocked): there is nothing to clear then.
    return [];
  }
}
