import { cleanup, descendants, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { OnboardingProgress } from '@/app/lib/onboarding';
import FinishSetupPrompt from './FinishSetupPrompt';

const progress = vi.hoisted(() => ({ get: vi.fn<() => Promise<OnboardingProgress>>() }));
vi.mock('@/app/lib/onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/onboarding')>()),
  onboardingApi: { get: progress.get, save: vi.fn() },
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

const saved = (place: Partial<OnboardingProgress>): OnboardingProgress => ({ role: 'tenant', step: null, completed_at: null, ...place });

describe('the dashboard\'s "Finish setup"', () => {
  it('offers to resume a setup that was closed part way, naming the step', async () => {
    progress.get.mockResolvedValue(saved({ step: 'history' }));
    const view = await render(<FinishSetupPrompt role="tenant" />);

    expect(textOf(view)).toContain('Finish setting up your profile');
    expect(textOf(view)).toContain('Pick up at "Rental history".');
    expect(getByName(view, 'a', 'Finish setup').getAttribute('href')).toBe('/tenant/onboarding');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('offers to resume a skipped setup', async () => {
    progress.get.mockResolvedValue(saved({ role: 'landlord', step: 'welcome' }));
    const view = await render(<FinishSetupPrompt role="landlord" />);

    expect(textOf(view)).toContain('You skipped setup.');
    expect(getByName(view, 'a', 'Finish setup').getAttribute('href')).toBe('/owner/onboarding');
  });

  it.each([
    ['finished', saved({ step: 'publish', completed_at: '2026-10-20T00:00:00Z' })],
    ['never started, such as a mobile account', saved({})],
    ['another role\'s', saved({ role: 'landlord', step: 'about' })],
  ])('says nothing about a setup that is %s', async (_state, place) => {
    progress.get.mockResolvedValue(place);
    const view = await render(<FinishSetupPrompt role="tenant" />);

    expect(descendants(view)).toEqual([]);
  });

  it('says nothing when the progress cannot load', async () => {
    progress.get.mockRejectedValue(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<FinishSetupPrompt role="tenant" />);

    expect(descendants(view)).toEqual([]);
  });

  it('invites a member who never started, where asked to', async () => {
    progress.get.mockResolvedValue(saved({}));
    const view = await render(<FinishSetupPrompt role="tenant" offerStart />);

    expect(textOf(view)).toContain('Set up your profile step by step');
    expect(getByName(view, 'a', 'Start setup').getAttribute('href')).toBe('/tenant/onboarding');
  });
});
