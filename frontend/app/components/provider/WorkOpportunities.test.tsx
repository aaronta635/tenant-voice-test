import { cleanup, click, descendants, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { WorkOpportunities as Opportunities, WorkOpportunity } from '@/app/lib/work-opportunities';
import WorkOpportunities from './WorkOpportunities';

const opportunities = vi.hoisted(() => ({ workOpportunities: vi.fn() }));
vi.mock('@/app/lib/work-opportunities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/work-opportunities')>()),
  workOpportunities: opportunities.workOpportunities,
}));
// The Connect button reads each person's state; nobody here is connected yet.
vi.mock('@/app/lib/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/connections')>()),
  getConnectionState: async (userId: string) => ({ user_id: userId, state: 'none', connection_id: null }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const ava: WorkOpportunity = {
  id: 'ava', display_name: 'Ava Lister', role_label: 'Landlord', location: 'Parramatta', state: 'NSW', verified: true,
  rating_avg: 4.67, review_count: 3, listing_count: 3, match: 'listing_in_area',
  reasons: ['2 listings on TenantVoice in Glebe, an area your “Bond clean” service covers.', 'Verified by TenantVoice.'],
};
const eve: WorkOpportunity = {
  id: 'eve', display_name: 'Eve Statewide', role_label: 'Agent', location: null, state: null, verified: false,
  rating_avg: null, review_count: 0, listing_count: 0, match: 'same_state', reasons: ['Based in NSW, the state you work in.'],
};
const answer = (items: WorkOpportunity[], areas = ['Newtown', 'Glebe']): Opportunities => ({ items, areas, generated_at: '2026-10-23T00:00:00Z' });
const card = (view: FakeElement, name: string) => {
  let node: FakeElement | null = getByName(view, 'h3', name);
  while (node && !(node.className.includes('flex-col') && node.className.includes('p-5'))) node = node.parentElement;
  return node as FakeElement;
};

beforeEach(() => {
  vi.clearAllMocks();
  opportunities.workOpportunities.mockResolvedValue(answer([ava, eve]));
});
afterEach(cleanup);

describe('WorkOpportunities', () => {
  it('shows each owner with their rating, seal, match and the facts that place them', async () => {
    const view = await render(<WorkOpportunities nav={<p>Tabs</p>} />);
    const owner = card(view, 'Ava Lister');

    expect(textOf(view)).toContain('Tabs');
    expect(textOf(view)).toContain('Based on Newtown and Glebe.');
    expect(textOf(owner)).toContain('Based in Parramatta, NSW');
    expect(textOf(owner)).toContain('Listings in your areas');
    expect(textOf(owner)).toContain('2 listings on TenantVoice in Glebe, an area your “Bond clean” service covers.');
    expect(textOf(owner)).toContain('Rated 4.7 out of 5 from 3 reviews');
    expect(descendants(owner).some((element) => element.getAttribute('aria-label') === 'Verified by TenantVoice')).toBe(true);
    // The visible label comes first in the name, so a voice command saying it finds the link (WCAG 2.5.3).
    expect(getByName(owner, 'a', 'View profile: Ava Lister').getAttribute('href')).toBe('/public/ava');
    expect(getByName(owner, 'button', 'Connect with Ava Lister')).toBeTruthy();
  });

  it('shows an owner without reviews, seal or area for what they are', async () => {
    const owner = card(await render(<WorkOpportunities />), 'Eve Statewide');

    expect(textOf(owner)).toContain('No ratings yet');
    expect(textOf(owner)).toContain('Area not listed');
    expect(textOf(owner)).toContain('In your state');
    expect(descendants(owner).some((element) => element.getAttribute('aria-label') === 'Verified by TenantVoice')).toBe(false);
  });

  it('keeps the owners at AA contrast', async () => {
    expect(lowContrastText(await render(<WorkOpportunities />))).toEqual([]);
  });

  it('says it is looking while the owners load', async () => {
    opportunities.workOpportunities.mockReturnValue(new Promise(() => {}));

    expect(textOf(await render(<WorkOpportunities />))).toContain('Finding owners in your areas…');
  });

  it('offers a retry when the owners cannot be loaded', async () => {
    opportunities.workOpportunities.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<WorkOpportunities />);

    expect(textOf(view)).toContain('Work opportunities could not be loaded');
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Ava Lister');
  });

  it('sends a provider without a business profile to onboarding', async () => {
    opportunities.workOpportunities.mockRejectedValue(new ApiError(404, 'No service provider profile for this account'));
    const view = await render(<WorkOpportunities />);

    expect(textOf(view)).toContain('Create your provider profile');
    expect(getByName(view, 'a', 'Start onboarding').getAttribute('href')).toBe('/dashboard/onboarding');
  });

  it('asks for areas when the provider has none to match on', async () => {
    opportunities.workOpportunities.mockResolvedValue(answer([], []));
    const view = await render(<WorkOpportunities />);

    expect(textOf(view)).toContain('Add the areas you serve');
    expect(getByName(view, 'a', 'profile').getAttribute('href')).toBe('/dashboard/profile');
    expect(getByName(view, 'a', 'your services').getAttribute('href')).toBe('/dashboard/services');
  });

  it('lists owners who only share the state under their own heading, not as in the areas served', async () => {
    const view = await render(<WorkOpportunities />);
    const section = (id: string) => descendants(view).find((element) => element.getAttribute('aria-labelledby') === id)!;

    expect(textOf(section('work-opportunities-heading'))).toContain('Ava Lister');
    expect(textOf(section('work-opportunities-heading'))).not.toContain('Eve Statewide');
    expect(textOf(section('work-opportunities-state'))).toContain('Elsewhere in your state');
    expect(textOf(section('work-opportunities-state'))).toContain('Eve Statewide');
  });

  it('shows the owners a provider whose profile names only a state is matched to', async () => {
    opportunities.workOpportunities.mockResolvedValue(answer([eve], []));
    const view = await render(<WorkOpportunities />);

    expect(textOf(view)).not.toContain('Add the areas you serve');
    expect(textOf(view)).toContain('Based on the state on your profile.');
    expect(getByName(view, 'h3', 'Eve Statewide')).toBeTruthy();
  });

  it('says when nobody is in the provider\'s areas yet', async () => {
    opportunities.workOpportunities.mockResolvedValue(answer([]));

    expect(textOf(await render(<WorkOpportunities />))).toContain('No owners in your areas yet');
  });
});
