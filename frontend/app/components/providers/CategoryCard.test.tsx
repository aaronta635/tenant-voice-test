import { cleanup, render, textOf } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '@/app/lib/api';
import CategoryCard from './CategoryCard';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

afterEach(cleanup);

// As seeded: the co-host category is the one with a badge.
const coHost: Category = {
  slug: 'co-host-inspector', category: 'co_host_inspector', name: 'Co-Host Inspector',
  description: 'Pre-stay walkthroughs, damage reports and listing audits for Airbnb hosts.',
  icon_bg: '#eeeffd', badge: 'NEW', sort_order: 1, provider_count: 3, from_price: 120,
};

describe('CategoryCard', () => {
  it('keeps its small text at AA contrast, "Browse →" and the badge included', async () => {
    const view = await render(<CategoryCard category={coHost} />);
    expect(textOf(view)).toContain('NEW');
    expect(textOf(view)).toContain('Browse →');
    expect(lowContrastText(view)).toEqual([]);
  });
});
