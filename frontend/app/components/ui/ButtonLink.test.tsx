import { readFileSync } from 'node:fs';
import { cleanup, render } from './test-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Button from './Button';
import ButtonLink from './ButtonLink';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const css = readFileSync(new URL('../../globals.css', import.meta.url), 'utf8');

/** Selectors of the rules that draw a border inside @media (forced-colors: active). */
function forcedColorBorderSelectors() {
  const block = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , declarations]) => /(^|;)\s*border:/.test(declarations))
    .map(([, selector]) => selector.trim());
}

afterEach(cleanup);

describe('ButtonLink', () => {
  it('renders a link with the same classes as the matching Button', async () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'destructive'] as const) {
      const link = (await render(<ButtonLink href="/dashboard/services" variant={variant}>Manage services</ButtonLink>)).children[0];
      const button = (await render(<Button variant={variant}>Manage services</Button>)).children[0];

      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBe('/dashboard/services');
      expect(link.className).toBe(button.className);
    }
  });

  it('keeps an outline in forced-colors mode, where its fill is removed', async () => {
    const link = (await render(<ButtonLink href="/dashboard/onboarding">Start onboarding</ButtonLink>)).children[0];

    expect(link.hasAttribute('data-button-link')).toBe(true);
    expect(forcedColorBorderSelectors().some((selector) => selector.includes('[data-button-link]'))).toBe(true);
  });
});
