import { describe, expect, it } from 'vitest';
import { ApiError, type Profile, type ProviderService, type ServiceProvider, type VerificationDocument } from './api';
import { accountMenuLinks, deleteQueuedServices, documentFileName, documentFileProblem, inboxEmptyMessage, nextOnboardingStep, parseServiceAmount, serviceProblem, splitProviderLocation, validTimeRange, type DraftService } from './provider-workspace';

describe('service prices', () => {
  it('accepts common currency input without silently changing malformed prices', () => {
    expect(parseServiceAmount('$150')).toBe(150);
    expect(parseServiceAmount('1,200.50')).toBe(1200.5);
    for (const input of ['', '1,2', '1e3', '-1', '1.234', 'Infinity', 'abc']) expect(Number.isNaN(parseServiceAmount(input))).toBe(true);
  });
  it('rejects invalid row data before onboarding makes any requests', () => {
    expect(serviceProblem('Inspection', '100001')).toContain('$100,000');
    expect(serviceProblem('Inspection', '0')).toContain('above $0');
    expect(serviceProblem('Inspection', '0', { active: false })).toBeNull();
    expect(serviceProblem(' ', '150')).toContain('name');
    expect(serviceProblem('x'.repeat(81), '150')).toContain('80 characters');
    expect(serviceProblem('Inspection', '100000')).toBeNull();
  });
  it('asks for a description before a service is enabled, as the shared rules do', () => {
    expect(serviceProblem('Inspection', '150', { description: ' ' })).toBe('Add a description to enable this service.');
    expect(serviceProblem('Inspection', '150', { description: '', active: false })).toBeNull();
    expect(serviceProblem('Inspection', '150', { description: 'x'.repeat(1001) })).toContain('1000 characters');
    expect(serviceProblem('Inspection', '150', { description: 'Entry and exit reports.' })).toBeNull();
  });
});

describe('availability', () => {
  it('requires both valid times in chronological order', () => {
    expect(validTimeRange('', '17:00')).toBe(false);
    expect(validTimeRange('09:00', '')).toBe(false);
    expect(validTimeRange('09:00', '09:00')).toBe(false);
    expect(validTimeRange('17:00', '09:00')).toBe(false);
    expect(validTimeRange('24:00', '25:00')).toBe(false);
    expect(validTimeRange('09:00', '17:00')).toBe(true);
  });
});

describe('profile location', () => {
  it('preserves multi-part locations and extracts a recognised final state only', () => {
    expect(splitProviderLocation('Surry Hills, Sydney, NSW')).toEqual({ location: 'Surry Hills, Sydney', state: 'NSW' });
    expect(splitProviderLocation('Surry Hills, Sydney')).toEqual({ location: 'Surry Hills, Sydney', state: null });
    expect(splitProviderLocation('')).toEqual({ location: null, state: null });
  });
});

describe('onboarding resume', () => {
  const profile = { location: 'Sydney' } as Profile;
  const provider = { category: 'tradie', business_name: 'Plumbing Co', bio: 'Residential plumbing services.', headline: 'Licensed plumber', service_radius_km: 15 } as ServiceProvider;
  const services = [{ is_active: true }] as ProviderService[];
  const documents = [{ status: 'pending' }] as VerificationDocument[];
  it('resumes at the first incomplete prerequisite, without treating a rejected credential as submitted', () => {
    expect(nextOnboardingStep(null, profile, services, documents)).toBe(1);
    // The API sends a null category until the provider picks one.
    expect(nextOnboardingStep({ ...provider, category: null }, profile, services, documents)).toBe(1);
    expect(nextOnboardingStep(provider, profile, [], documents)).toBe(2);
    expect(nextOnboardingStep(provider, { ...profile, location: null }, services, documents)).toBe(3);
    expect(nextOnboardingStep(provider, profile, services, [{ status: 'rejected' }] as VerificationDocument[])).toBe(4);
    expect(nextOnboardingStep({ ...provider, bio: '' }, profile, services, documents)).toBe(5);
    expect(nextOnboardingStep(provider, profile, services, documents)).toBe(6);
  });

  it('opens the step for a gap that profile completion counts, even once required details are in', () => {
    expect(nextOnboardingStep({ ...provider, service_radius_km: null }, profile, services, documents)).toBe(3);
    expect(nextOnboardingStep({ ...provider, headline: null, tagline: null }, profile, services, documents)).toBe(5);
    expect(nextOnboardingStep({ ...provider, headline: ' ', tagline: null }, profile, services, documents)).toBe(5);
    // Completion takes the tagline for the headline, as older profiles only have one.
    expect(nextOnboardingStep({ ...provider, headline: null, tagline: 'Fast and tidy' }, profile, services, documents)).toBe(6);
  });
});

describe('credential upload validation', () => {
  it('rejects oversized and unsupported files before storage upload', () => {
    expect(documentFileProblem({ size: 10 * 1024 * 1024, type: 'application/pdf' })).toContain('5 MB');
    expect(documentFileProblem({ size: 100, type: 'image/svg+xml' })).toContain('PDF');
    expect(documentFileProblem({ size: 5 * 1024 * 1024, type: 'application/pdf' })).toBeNull();
  });
  it('reads a persisted filename from its signed URL after refresh', () => {
    expect(documentFileName('https://storage.example.test/verification/profile/0123456789abcdef0123456789abcdef/Professional%20indemnity%202026.pdf?token=private')).toBe('Professional indemnity 2026.pdf');
    expect(documentFileName('https://storage.example.test/verification/profile/0123456789abcdef0123456789abcdef.pdf?token=private')).toBe('uploaded document');
    expect(documentFileName('not a URL')).toBe('Document');
  });
});

describe('removing services during onboarding', () => {
  const appraisal: DraftService = { id: 'appraisal', title: 'Rental appraisal', price: '150', is_active: true, booking_count: 0 };
  const clean: DraftService = { id: 'clean', title: 'Bond clean', price: '300', is_active: true, booking_count: 0 };
  const refuseBooked = (refused: string) => async (id: string) => {
    if (id === refused) throw new ApiError(409, "This service has bookings, so it can't be removed. Unpublish it instead.");
  };

  it('puts a service the API refuses to delete back as disabled and takes it off the queue', async () => {
    const settled: [string | undefined, DraftService | null][] = [];
    const kept = await deleteQueuedServices([appraisal, clean], refuseBooked('appraisal'), (service, restored) => settled.push([service.id, restored]));
    const disabled = { ...appraisal, is_active: false, booking_count: 1 };
    expect(kept).toEqual([disabled]);
    // Both leave the queue, so the next Continue no longer retries the refused delete.
    expect(settled).toEqual([['appraisal', disabled], ['clean', null]]);
  });

  it('keeps a service queued when its delete fails for another reason', async () => {
    const settled: (string | undefined)[] = [];
    const failing = async (id: string) => { if (id === 'clean') throw new ApiError(503, 'Service unavailable'); };
    await expect(deleteQueuedServices([appraisal, clean], failing, (service) => settled.push(service.id))).rejects.toThrow('Service unavailable');
    expect(settled).toEqual(['appraisal']);
  });

  it('still hands back a refused service when a later delete fails', async () => {
    const restored: DraftService[] = [];
    const failing = async (id: string) => {
      if (id === 'appraisal') throw new ApiError(409, 'Has bookings');
      throw new TypeError('Failed to fetch');
    };
    await expect(deleteQueuedServices([appraisal, clean], failing, (_service, kept) => { if (kept) restored.push(kept); })).rejects.toThrow('Failed to fetch');
    expect(restored).toEqual([{ ...appraisal, is_active: false, booking_count: 1 }]);
  });
});

describe('workspace links to the public profile', () => {
  const draft = { id: 'provider-1', slug: 'harbour-plumbing', is_published: false };
  const labels = (provider: typeof draft | null) => accountMenuLinks(provider).map((link) => link.label);

  it('offers Complete setup, not a Public profile that would be Not found, while unpublished', () => {
    expect(labels(draft)).toContain('Complete setup');
    expect(labels(draft)).not.toContain('Public profile');
    expect(labels(null)).not.toContain('Public profile');
  });

  it('links a live profile to its public page', () => {
    const links = accountMenuLinks({ ...draft, is_published: true });
    expect(links).toContainEqual({ href: '/providers/harbour-plumbing', label: 'Public profile' });
    expect(links.map((link) => link.label)).not.toContain('Complete setup');
  });

  it('only promises messages from a public profile once it is live', () => {
    expect(inboxEmptyMessage(true)).toContain('Clients can message you from your public profile.');
    expect(inboxEmptyMessage(false)).not.toContain('Clients can message you from your public profile.');
    expect(inboxEmptyMessage(false)).toContain('publish your profile');
    expect(inboxEmptyMessage(null)).toBe('No conversations yet.');
  });
});
