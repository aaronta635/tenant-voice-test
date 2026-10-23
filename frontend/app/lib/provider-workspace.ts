import { ApiError, type Profile, type ProviderService, type ServiceProvider, type VerificationDocument } from './api';
import { providerHref } from './provider-view';

/** Accept common AUD input, while rejecting malformed grouping and exponential notation. */
export function parseServiceAmount(value: string): number {
  const cleaned = value.trim().replace(/^\$\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(cleaned)) return NaN;
  return Number(cleaned.replaceAll(',', ''));
}

/** The shared service rules (mobile_service_validate), which the server applies again. */
export const SERVICE_LIMITS = { title: 80, description: 1000, price: 100_000, area: 200 } as const;

/**
 * Why a service cannot be saved, or null: a name of up to 80 characters, a
 * price from $0 to $100,000, and, to be enabled, a description and a price
 * above $0. Pass the description to check it too.
 */
export function serviceProblem(
  title: string,
  price: string,
  { description, active = true }: { description?: string | null; active?: boolean } = {},
): string | null {
  const name = title.trim();
  if (!name || name.length > SERVICE_LIMITS.title) return `Use a service name of up to ${SERVICE_LIMITS.title} characters.`;
  const amount = parseServiceAmount(price);
  if (!Number.isFinite(amount) || amount < 0 || amount > SERVICE_LIMITS.price) return 'Enter a price between $0 and $100,000 (for example, $150 or 1,200).';
  if (active && amount <= 0) return 'Add a price above $0 to enable this service.';
  if (description !== undefined) {
    if ((description ?? '').length > SERVICE_LIMITS.description) return `Keep the description to ${SERVICE_LIMITS.description} characters.`;
    if (active && !(description ?? '').trim()) return 'Add a description to enable this service.';
  }
  return null;
}

/** An onboarding service row; booking_count comes from the saved service. */
export type DraftService = { id?: string; title: string; price: string; description?: string; pricing_type?: ProviderService['pricing_type']; is_active?: boolean; booking_count?: number };

export function draftFromService(service: ProviderService): DraftService {
  return { id: service.id, title: service.title, price: String(service.price), description: service.description ?? '', pricing_type: service.pricing_type, is_active: service.is_active, booking_count: service.booking_count };
}

/**
 * Deletes the services queued for removal, calling `onSettled` as each one
 * leaves the queue. The API refuses (409) to delete a service with bookings,
 * since that would strip past jobs of their service. Such a service settles
 * with a disabled copy to put back in the list, so setup is never stuck
 * retrying a removal that can't succeed. Any other failure is thrown and
 * leaves that service queued for a retry. Returns the services kept.
 */
export async function deleteQueuedServices(
  queued: DraftService[],
  remove: (id: string) => Promise<void>,
  onSettled: (service: DraftService, kept: DraftService | null) => void,
): Promise<DraftService[]> {
  const kept: DraftService[] = [];
  for (const service of queued) {
    if (!service.id) continue;
    let restored: DraftService | null = null;
    try {
      await remove(service.id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) throw err;
      restored = { ...service, is_active: false, booking_count: Math.max(service.booking_count ?? 0, 1) };
      kept.push(restored);
    }
    onSettled(service, restored);
  }
  return kept;
}

/**
 * The workspace account menu. An unpublished profile's public page is Not
 * found, so "Public profile" appears only once the profile is live, and
 * "Complete setup" until then.
 */
export function accountMenuLinks(provider: Pick<ServiceProvider, 'id' | 'slug' | 'is_published'> | null): { href: string; label: string }[] {
  const live = Boolean(provider?.is_published);
  return [
    { href: '/dashboard/profile', label: 'My profile' },
    ...(!live ? [{ href: '/dashboard/onboarding', label: 'Complete setup' }] : []),
    { href: '/dashboard/settings', label: 'Settings' },
    ...(provider && live ? [{ href: providerHref(provider), label: 'Public profile' }] : []),
    { href: '/faqs', label: 'Help and FAQs' },
    { href: '/contact', label: 'Contact support' },
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
  ];
}

/** The provider inbox's empty state; `published` is null until it is known. */
export function inboxEmptyMessage(published: boolean | null): string {
  if (published === null) return 'No conversations yet.';
  return published
    ? 'No conversations yet. Clients can message you from your public profile.'
    : 'No conversations yet. Once you finish setup and publish your profile, clients can message you from it.';
}

export function splitProviderLocation(value: string): { location: string | null; state: string | null } {
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  const last = parts.at(-1)?.toUpperCase();
  const state = last && ['NSW', 'VIC', 'QLD', 'ACT', 'NT', 'WA', 'SA', 'TAS'].includes(last) ? parts.pop()! : null;
  return { location: parts.join(', ') || null, state };
}

/**
 * The step setup opens at: the first one with something missing, counting
 * what profile completion scores (travel radius, headline) as well as what
 * each step requires. A live profile below 100% therefore opens where it can
 * improve; only a profile with nothing missing opens at the review.
 */
export function nextOnboardingStep(provider: ServiceProvider | null, profile: Profile | null, services: ProviderService[], documents: VerificationDocument[]): number {
  if (!provider?.category) return 1;
  if (!services.some((service) => service.is_active)) return 2;
  if (!profile?.location?.trim() || provider.service_radius_km == null) return 3;
  if (!documents.some((doc) => doc.status !== 'rejected')) return 4;
  if (!provider.business_name?.trim() || (provider.bio?.trim().length ?? 0) < 10) return 5;
  if (!provider.headline?.trim() && !provider.tagline?.trim()) return 5;
  return 6;
}

export function validTimeRange(start: string, end: string): boolean {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return time.test(start) && time.test(end) && start < end;
}

export const DOCUMENT_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';
export function documentFileProblem(file: Pick<File, 'size' | 'type'>): string | null {
  if (file.size > 5 * 1024 * 1024) return 'That file is over 5 MB. Upload a smaller scan or photo.';
  if (!DOCUMENT_ACCEPT.split(',').includes(file.type)) return 'Upload a PDF, PNG, JPG or WebP file.';
  return null;
}

export function documentFileName(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/');
    const name = decodeURIComponent(parts.at(-1) ?? 'Document');
    // Legacy uploads only stored a generated UUID. Do not present it as the
    // provider's original filename; new uploads have a UUID directory + name.
    if (/^[a-f0-9]{32}\.[a-z0-9]+$/i.test(name) && !/^[a-f0-9]{32}$/i.test(parts.at(-2) ?? '')) return 'uploaded document';
    return name || 'Document';
  }
  catch { return 'Document'; }
}
