import { cleanup, click, FakeElement, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { act, useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecommendationViews from './RecommendationViews';

/** The query useSearchParams reports; setSearchParams writes it, as the History API does under Next. */
const navigation = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    search: '',
    listeners,
    sync(search: string) { this.search = search; listeners.forEach((listener) => listener()); },
  };
});
const mounts = vi.hoisted(() => ({ people: 0, opportunities: 0 }));

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => { navigation.listeners.add(listener); return () => { navigation.listeners.delete(listener); }; };
  return { useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => navigation.search)) };
});
vi.mock('@/app/lib/page-url', () => ({
  setSearchParams: vi.fn((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(navigation.search);
    for (const [key, value] of Object.entries(changes)) if (value) params.set(key, value); else params.delete(key);
    navigation.sync(params.toString());
  }),
}));
vi.mock('@/app/components/provider/ProviderRecommendations', () => ({
  default: function People({ nav }: { nav?: ReactNode }) {
    useEffect(() => { mounts.people += 1; }, []);
    return <section><h1>People view</h1>{nav}</section>;
  },
}));
vi.mock('@/app/components/provider/WorkOpportunities', () => ({
  default: function Opportunities({ nav }: { nav?: ReactNode }) {
    useEffect(() => { mounts.opportunities += 1; }, []);
    return <section><h1>Opportunities view</h1>{nav}</section>;
  },
}));

const hiddenText = (view: FakeElement, heading: string) =>
  getByName(view, 'h1', heading).parentElement?.parentElement?.hasAttribute('hidden');
/** The view on screen: each view has the switch, and the other one is hidden. */
const shown = (view: FakeElement) =>
  view.childNodes.find((node): node is FakeElement => node instanceof FakeElement && !node.hasAttribute('hidden')) as FakeElement;

beforeEach(() => {
  navigation.search = '';
  Object.assign(mounts, { people: 0, opportunities: 0 });
});
afterEach(cleanup);

describe('RecommendationViews', () => {
  it('opens on the people to connect with, without loading the opportunities', async () => {
    const view = await render(<RecommendationViews />);

    expect(hiddenText(view, 'People view')).toBe(false);
    expect(textOf(view)).not.toContain('Opportunities view');
    expect(getByName(view, 'button', 'People to connect with').getAttribute('aria-pressed')).toBe('true');
  });

  it('switches to the work opportunities in the URL, and back without losing the assistant', async () => {
    const view = await render(<RecommendationViews />);

    await click(getByName(shown(view), 'button', 'Work opportunities'));
    expect(navigation.search).toBe('view=opportunities');
    expect(hiddenText(view, 'Opportunities view')).toBe(false);
    expect(hiddenText(view, 'People view')).toBe(true);

    await click(getByName(shown(view), 'button', 'People to connect with'));
    expect(navigation.search).toBe('');
    expect(hiddenText(view, 'People view')).toBe(false);
    expect(mounts).toEqual({ people: 1, opportunities: 1 });
  });

  it('opens straight on the work opportunities from a link, loading the assistant only when shown', async () => {
    navigation.search = 'view=opportunities';
    const view = await render(<RecommendationViews />);

    expect(hiddenText(view, 'Opportunities view')).toBe(false);
    expect(textOf(view)).not.toContain('People view');
    expect(mounts).toEqual({ people: 0, opportunities: 1 });
    await act(async () => navigation.sync(''));
    expect(hiddenText(view, 'People view')).toBe(false);
    expect(hiddenText(view, 'Opportunities view')).toBe(true);
  });
});
