import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError, type ProviderRecommendation, type ProviderRecommendationsResponse, type RecommendationChatResponse, type ServiceProvider,
} from '@/app/lib/api';
import ProviderRecommendations from './ProviderRecommendations';

const mockApi = vi.hoisted(() => ({
  providers: { mine: vi.fn(), myServices: vi.fn() },
  recommendations: { provider: vi.fn(), analyzeProvider: vi.fn(), chat: vi.fn(), providerLocations: vi.fn() },
  connections: { request: vi.fn() },
  conversations: { startRental: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/app/components/ui/Card', async (importOriginal) => {
  const { default: RealCard } = await importOriginal<typeof import('@/app/components/ui/Card')>();
  return { default: (props: ComponentProps<typeof RealCard>) => <RealCard data-card="" {...props} /> };
});

const PROVIDER = { id: 'provider-1', category: 'Property management' } as ServiceProvider;
const NO_PROFILE = 'No service provider profile for this account';

function person(overrides: Partial<ProviderRecommendation>): ProviderRecommendation {
  return {
    id: 'lena', full_name: 'Lena Landlord', role: 'landlord', avatar_url: null, location: 'Parramatta', state: 'NSW',
    connection_status: null, match_level: 'strong', reasons: ['Lists Parramatta, one of your service areas.'],
    ...overrides,
  };
}

function suggestions(items: ProviderRecommendation[]): ProviderRecommendationsResponse {
  return { items, source: 'rules', ai_status: 'not_configured', message: null, generated_at: '2026-10-21T01:00:00Z', cached: false };
}

const PEOPLE = [
  person({}),
  person({ id: 'sam', full_name: 'Sam Tenant', role: 'tenant', location: 'Ryde' }),
  person({ id: 'ana', full_name: 'Ana Connected', role: 'tenant', connection_status: 'accepted' }),
];

function renderSuggestions() {
  mockApi.providers.mine.mockResolvedValue(PROVIDER);
  mockApi.recommendations.provider.mockResolvedValue(suggestions(PEOPLE));
  return render(<ProviderRecommendations />);
}

/** The card around a heading: a result card for a person's name, or the assistant. */
function cardOf(view: FakeElement, tag: 'h2' | 'h4', name: string) {
  let node: FakeElement | null = getByName(view, tag, name);
  while (node && !node.hasAttribute('data-card')) node = node.parentElement;
  if (!node) throw new Error(`No card around ${name}`);
  return node;
}

/** The live regions (FormMessage, alerts) that currently say exactly this. */
function regionsSaying(view: FakeElement, text: string) {
  return descendants(view).filter((element) => ['alert', 'status'].includes(element.getAttribute('role') ?? '') && textOf(element) === text);
}

/** A card's own status region, from its FormMessage. */
function statusIn(card: FakeElement) {
  return descendants(card).find((element) => element.getAttribute('role') === 'status') ?? null;
}

function focused(view: FakeElement) {
  return view.ownerDocument?.activeElement ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.providers.myServices.mockResolvedValue([]);
});
afterEach(async () => {
  await cleanup();
  // The test DOM keeps focus on a removed element; a browser returns it to the body.
  (document.activeElement as HTMLElement | null)?.blur();
});

describe('ProviderRecommendations before onboarding', () => {
  it('points to onboarding and sends no recommendation or chat requests', async () => {
    // Every endpoint behind this page answers 404 until onboarding step 1 creates the profile.
    for (const call of [mockApi.providers.mine, mockApi.providers.myServices, mockApi.recommendations.provider, mockApi.recommendations.chat]) {
      call.mockRejectedValue(new ApiError(404, NO_PROFILE));
    }
    const view = await render(<ProviderRecommendations />);

    expect(getByName(view, 'h2', 'Create your provider profile')).toBeTruthy();
    expect(getByName(view, 'a', 'Start onboarding').getAttribute('href')).toBe('/dashboard/onboarding');
    expect(textOf(view)).not.toContain(NO_PROFILE);
    expect(descendants(view).some((element) => element.tagName === 'TEXTAREA')).toBe(false);
    expect(mockApi.recommendations.provider).not.toHaveBeenCalled();
    expect(mockApi.recommendations.chat).not.toHaveBeenCalled();
    expect(mockApi.providers.myServices).not.toHaveBeenCalled();
  });

  it('offers a retry instead of setup when the profile check fails for another reason', async () => {
    mockApi.providers.mine.mockRejectedValueOnce(new ApiError(503, 'The service is busy. Please try again.')).mockResolvedValue(PROVIDER);
    mockApi.recommendations.provider.mockResolvedValue(suggestions([person({})]));
    const view = await render(<ProviderRecommendations />);

    expect(textOf(view)).toContain('Recommendations could not be loaded');
    expect(textOf(view)).toContain('The service is busy. Please try again.');
    expect(textOf(view)).not.toContain('Create your provider profile');
    expect(mockApi.recommendations.provider).not.toHaveBeenCalled();

    await click(getByName(view, 'button', 'Try again'));
    expect(mockApi.providers.mine).toHaveBeenCalledTimes(2);
    expect(mockApi.recommendations.provider).toHaveBeenCalledTimes(1);
    expect(textOf(view)).toContain('Lena Landlord');
    expect(descendants(view).some((element) => element.id === 'recommendation-chat-input')).toBe(true);
  });

  it('keeps the assistant and loads the suggestions again when only they failed', async () => {
    mockApi.providers.mine.mockResolvedValue(PROVIDER);
    mockApi.recommendations.provider.mockRejectedValueOnce(new ApiError(503, 'The service is busy. Please try again.'))
      .mockResolvedValue(suggestions([person({})]));
    const view = await render(<ProviderRecommendations />);

    expect(textOf(view)).toContain('Recommendations could not be loaded');
    expect(descendants(view).some((element) => element.id === 'recommendation-chat-input')).toBe(true);

    await click(getByName(view, 'button', 'Try again'));
    expect(mockApi.recommendations.provider).toHaveBeenCalledTimes(2);
    expect(textOf(view)).toContain('Lena Landlord');
    expect(textOf(view)).not.toContain('Recommendations could not be loaded');
  });
});

describe('ProviderRecommendations without the paid AI', () => {
  it('says the AI needs a verified account, once, while the guided questions and profile matches answer', async () => {
    const gate = {
      code: 'verification_required' as const, action: 'paid_ai', status: 'pending',
      message: 'Your account needs to be verified before you can use AI features. Upload the documents it asks for, or wait for the review to finish.',
      documents_href: '/dashboard/profile#verification-documents',
    };
    mockApi.recommendations.chat.mockResolvedValue({
      reply: 'I will look for tenants in any area.', state: 'confirm', missing: [], quick_replies: [], services: [],
      criteria: { role: 'tenant', location: '', service_ids: [], new_only: false }, source: 'rules',
      ai_status: 'verification_required', verification: gate,
    } satisfies RecommendationChatResponse);
    mockApi.recommendations.analyzeProvider.mockResolvedValue({
      ...suggestions([person({ id: 'tia', full_name: 'Tia Tenant', role: 'tenant' })]),
      ai_status: 'verification_required', verification: gate,
      message: 'AI refinement needs a verified account. Your profile matches are shown.',
    });
    const view = await renderSuggestions();
    const input = descendants(view).find((element) => element.id === 'recommendation-chat-input')!;
    const form = descendants(view).find((element) => element.tagName === 'FORM' && element.contains(input))!;
    const refusals = () => descendants(view).filter((element) => element.getAttribute('role') === 'alert' && textOf(element).includes(gate.message));

    await typeInto(input, 'Tenants anywhere');
    await dispatch(form, 'submit');

    const chat = cardOf(view, 'h2', 'Recommendation assistant');
    expect(textOf(chat)).toContain('Guided questions · AI needs a verified account');
    expect(refusals()).toHaveLength(1);
    expect(textOf(refusals()[0])).toContain('Verification needed');
    expect(getByName(refusals()[0], 'a', 'Go to your documents').getAttribute('href')).toBe('/dashboard/profile#verification-documents');

    await click(getByName(chat, 'button', 'Find matches'));

    expect(mockApi.recommendations.analyzeProvider).toHaveBeenCalledTimes(1);
    expect(textOf(view)).toContain('Tia Tenant');
    expect(refusals()).toHaveLength(1);
  });
});

describe('ProviderRecommendations card actions', () => {
  it('shows a failed Connect in that card and moves focus to the message', async () => {
    mockApi.connections.request.mockRejectedValue(new ApiError(409, 'A connection request already exists.'));
    const view = await renderSuggestions();

    await click(getByName(view, 'button', 'Connect with Sam Tenant'));
    const card = cardOf(view, 'h4', 'Sam Tenant');
    const regions = regionsSaying(view, 'A connection request already exists.');

    expect(regions).toHaveLength(1);
    expect(card.contains(regions[0])).toBe(true);
    expect(card.contains(focused(view))).toBe(true);
    expect(textOf(focused(view)!)).toBe('A connection request already exists.');
    // The test DOM focuses any element; a browser needs the tabindex.
    expect(focused(view)!.getAttribute('tabindex')).toBe('-1');
    // The focused element is the wrapper around the message. At zero height (h-0) the error box
    // would run out over the bottom of the card.
    expect(focused(view)!.className.split(/\s+/)).toEqual(['mt-3', 'scroll-mt-24']);
    expect(getByName(card, 'button', 'Connect with Sam Tenant').hasAttribute('disabled')).toBe(false);
  });

  it('shows a failed Message in that card and moves focus to the message', async () => {
    mockApi.conversations.startRental.mockRejectedValue(new ApiError(403, 'You can only message your connections.'));
    const view = await renderSuggestions();

    await click(getByName(view, 'button', 'Message connection Ana Connected'));
    const card = cardOf(view, 'h4', 'Ana Connected');

    const regions = regionsSaying(view, 'You can only message your connections.');

    expect(regions).toHaveLength(1);
    expect(card.contains(regions[0])).toBe(true);
    expect(card.contains(focused(view))).toBe(true);
  });

  it('keeps a sent request in place, pending, with its confirmation', async () => {
    mockApi.connections.request.mockResolvedValue({ id: 'c1' });
    const view = await renderSuggestions();
    expect(regionsSaying(view, '2 new potential connections')).toHaveLength(1);

    await click(getByName(view, 'button', 'Connect with Lena Landlord'));
    const card = cardOf(view, 'h4', 'Lena Landlord');
    // The heading of the section the card is listed under.
    const group = card.parentElement?.parentElement?.children[0];
    const regions = regionsSaying(view, 'Connection request sent.');

    expect(mockApi.connections.request).toHaveBeenCalledWith('lena');
    expect(regions).toHaveLength(1);
    expect(card.contains(regions[0])).toBe(true);
    expect(getByName(card, 'button', 'Connection pending').hasAttribute('disabled')).toBe(true);
    expect(textOf(group!)).toBe('New potential connections');
    // Listed with the new people until the next search, but no longer counted as new.
    expect(regionsSaying(view, '1 new potential connection')).toHaveLength(1);
  });

  it('announces Connect and Message progress from a live region already in the card', async () => {
    let send: (value: unknown) => void = () => {};
    mockApi.connections.request.mockReturnValue(new Promise((resolve) => { send = resolve; }));
    mockApi.conversations.startRental.mockReturnValue(new Promise(() => {}));
    const view = await renderSuggestions();
    const [lena, sam, ana] = ['Lena Landlord', 'Sam Tenant', 'Ana Connected'].map((name) => statusIn(cardOf(view, 'h4', name)));
    // The classes of the wrapper around the FormMessage. Even empty, FormMessage's space-y-2 leaves
    // an 8px margin under its alert, which the wrapper keeps: its zero height (h-0) is what stops
    // that from making cards without a message taller.
    const wrapperClasses = (region: FakeElement | null) => region?.parentElement?.parentElement?.className.split(/\s+/) ?? [];
    // Exactly h-0: hidden or invisible would also drop the region from the accessibility tree.
    const zeroHeight = (region: FakeElement | null) => wrapperClasses(region).join(' ') === 'h-0';

    // Mounted and empty before any click: a region inserted with its text is often not read out.
    expect([lena, sam, ana].map((region) => region && textOf(region))).toEqual(['', '', '']);
    expect([lena, sam, ana].map(zeroHeight)).toEqual([true, true, true]);

    await click(getByName(view, 'button', 'Connect with Sam Tenant'));
    expect(textOf(sam!)).toBe('Sending connection request…');
    expect(regionsSaying(view, 'Sending connection request…')).toHaveLength(1);
    expect(wrapperClasses(sam)).toEqual(['mt-3', 'scroll-mt-24']);
    expect([lena, sam, ana].map(zeroHeight)).toEqual([true, false, true]);

    send({ id: 'c1' });
    await settle();
    await click(getByName(view, 'button', 'Message connection Ana Connected'));
    expect(textOf(ana!)).toBe('Opening conversation…');
    expect(regionsSaying(view, 'Opening conversation…')).toHaveLength(1);
    expect([lena, sam, ana].map(zeroHeight)).toEqual([true, true, false]);
  });

  it('leaves focus where the provider moved it while a Connect was failing', async () => {
    let fail: (reason: unknown) => void = () => {};
    mockApi.connections.request.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const view = await renderSuggestions();
    const input = descendants(view).find((element) => element.id === 'recommendation-chat-input')!;

    await click(getByName(view, 'button', 'Connect with Sam Tenant'));
    input.focus();
    fail(new ApiError(409, 'A connection request already exists.'));
    await settle();

    expect(textOf(cardOf(view, 'h4', 'Sam Tenant'))).toContain('A connection request already exists.');
    expect(focused(view)).toBe(input);
  });

  it('reports at the top when a new search has replaced the card', async () => {
    let send: (value: unknown) => void = () => {};
    mockApi.connections.request.mockReturnValue(new Promise((resolve) => { send = resolve; }));
    const confirm: RecommendationChatResponse = {
      reply: 'I will look for tenants in any area.', state: 'confirm', missing: [], quick_replies: [], services: [],
      criteria: { role: 'tenant', location: '', service_ids: [], new_only: false }, source: 'rules', ai_status: 'not_configured',
    };
    mockApi.recommendations.chat.mockResolvedValue(confirm);
    mockApi.recommendations.analyzeProvider.mockResolvedValue(suggestions([person({ id: 'tia', full_name: 'Tia Tenant', role: 'tenant' })]));
    const view = await renderSuggestions();
    const input = descendants(view).find((element) => element.id === 'recommendation-chat-input')!;
    const form = descendants(view).find((element) => element.tagName === 'FORM' && element.contains(input))!;

    await click(getByName(view, 'button', 'Connect with Sam Tenant'));
    await typeInto(input, 'Tenants anywhere');
    await dispatch(form, 'submit');
    await click(getByName(cardOf(view, 'h2', 'Recommendation assistant'), 'button', 'Find matches'));
    send({ id: 'c1' });
    await settle();
    const regions = regionsSaying(view, 'Connection request sent.');

    expect(mockApi.recommendations.analyzeProvider).toHaveBeenCalledTimes(1);
    expect(textOf(view)).toContain('Tia Tenant');
    expect(textOf(view)).not.toContain('Sam Tenant');
    expect(regions).toHaveLength(1);
    expect(descendants(view).some((element) => element.hasAttribute('data-card') && element.contains(regions[0]))).toBe(false);
  });

  it('removes the message and its space from a card that a new search still lists', async () => {
    mockApi.connections.request.mockResolvedValue({ id: 'c1' });
    const confirm: RecommendationChatResponse = {
      reply: 'I will look for tenants in any area.', state: 'confirm', missing: [], quick_replies: [], services: [],
      criteria: { role: 'tenant', location: '', service_ids: [], new_only: false }, source: 'rules', ai_status: 'not_configured',
    };
    mockApi.recommendations.chat.mockResolvedValue(confirm);
    // Sam is listed again, now with the request pending.
    mockApi.recommendations.analyzeProvider.mockResolvedValue(suggestions([{ ...PEOPLE[1], connection_status: 'pending' }, PEOPLE[2]]));
    const view = await renderSuggestions();
    const input = descendants(view).find((element) => element.id === 'recommendation-chat-input')!;
    const form = descendants(view).find((element) => element.tagName === 'FORM' && element.contains(input))!;

    await click(getByName(view, 'button', 'Connect with Sam Tenant'));
    expect(textOf(statusIn(cardOf(view, 'h4', 'Sam Tenant'))!)).toBe('Connection request sent.');
    await typeInto(input, 'Tenants anywhere');
    await dispatch(form, 'submit');
    await click(getByName(cardOf(view, 'h2', 'Recommendation assistant'), 'button', 'Find matches'));
    const card = cardOf(view, 'h4', 'Sam Tenant');
    // Nothing to show any more, so the wrapper is zero-height again: its margin and the empty
    // alert's 8px margin would make the card taller.
    const classes = statusIn(card)?.parentElement?.parentElement?.className.split(/\s+/) ?? [];

    expect(mockApi.recommendations.analyzeProvider).toHaveBeenCalledTimes(1);
    expect(textOf(view)).not.toContain('Lena Landlord');
    expect(regionsSaying(view, 'Connection request sent.')).toHaveLength(0);
    expect(classes).toEqual(['h-0']);
  });
});

describe('ProviderRecommendations chat help', () => {
  it('only asks the provider to leave out personal details, and names no AI service', async () => {
    const view = await renderSuggestions();
    await settle();

    const help = descendants(view).find((element) => element.getAttribute('id') === 'recommendation-chat-help');
    expect(help ? textOf(help) : null).toBe('Avoid personal details such as names, phone numbers or street addresses.');
    expect(textOf(view)).not.toMatch(/DeepSeek|Shift\+Enter/);
  });
});
