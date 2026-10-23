import { cleanup, descendants, render, type FakeElement } from '@/app/components/ui/test-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProviderProfilePage from './profile/page';
import OnboardingPage from './onboarding/page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    categories: { list: async () => [] },
    profiles: { me: async () => ({ id: 'provider-user', full_name: 'Harbour Plumbing', location: 'Newtown', state: 'NSW' }) },
    providers: {
      mine: async () => ({ id: 'provider-1', slug: 'harbour-plumbing', category: 'tradie', business_name: 'Harbour Plumbing', profile_completion: 60, is_published: false }),
      myServices: async () => [],
      myDocuments: async () => [],
    },
  },
}));

afterEach(cleanup);

function completionBar(view: FakeElement) {
  const bars = descendants(view).filter((element) => element.getAttribute('role') === 'progressbar');
  expect(bars).toHaveLength(1);
  return bars[0];
}

describe.each([
  ['Profile', ProviderProfilePage],
  ['Onboarding', OnboardingPage],
])('the %s page completion bar', (_page, Page) => {
  it('reports its value to screen readers and keeps an edge and fill in forced-colors mode', async () => {
    const bar = completionBar(await render(<Page />));
    const [fill] = bar.children;

    expect(bar.getAttribute('aria-label')).toBe('Profile completion');
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuemax')]).toEqual(['60', '0', '100']);
    expect(bar.className.split(' ')).toEqual(expect.arrayContaining(['border', 'border-control-border']));
    expect(fill.style.width).toBe('60%');
    expect(fill.className.split(' ')).toContain('forced-colors:bg-[Highlight]');
  });
});
