/**
 * WCAG contrast checks for trees rendered with test-dom. Colours resolve from
 * the design tokens in globals.css, so a test fails as soon as a component
 * puts text on a token pairing that does not reach AA.
 */
import { readFileSync } from 'node:fs';
import { descendants, FakeElement, FakeText, type FakeNode } from './test-dom';

const css = readFileSync(new URL('../../globals.css', import.meta.url), 'utf8');
const TOKENS = new Map<string, string>([['white', '#ffffff'], ['black', '#000000']]);
for (const [, name, hex] of css.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) TOKENS.set(name, hex.toLowerCase());

/** WCAG AA minimum for text below 18.66px bold or 24px regular. */
export const SMALL_TEXT_MINIMUM = 4.5;

function luminance(hex: string) {
  const [red, green, blue] = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrast(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The opaque colour an element sets with a `text-*` or `bg-*` utility.
 * Variant (`hover:`) and translucent (`/40`, `transparent`) utilities are
 * ignored, so the lookup falls through to an ancestor.
 */
function ownColour(element: FakeElement, kind: 'text' | 'bg') {
  let found: string | undefined;
  for (const utility of element.className.split(/\s+/)) {
    if (!utility.startsWith(`${kind}-`) || utility.includes(':') || utility.includes('/')) continue;
    const value = utility.slice(kind.length + 1);
    const hex = /^\[(#[0-9a-f]{6})\]$/i.exec(value)?.[1] ?? TOKENS.get(value);
    if (hex) found = hex.toLowerCase();
  }
  return found;
}

function inherited(element: FakeElement | null, kind: 'text' | 'bg', fallback: string) {
  for (let current = element; current; current = current.parentElement) {
    const hex = ownColour(current, kind);
    if (hex) return hex;
  }
  return fallback;
}

/**
 * Every visible text run whose colour against its background is below
 * `minimum`, described as `"text" #fg on #bg = n:1`. Screen-reader-only text
 * is skipped. Unstyled text falls back to the body colours in globals.css.
 */
export function lowContrastText(root: FakeNode, minimum = SMALL_TEXT_MINIMUM) {
  const failures: string[] = [];
  const visit = (node: FakeNode) => {
    if (node instanceof FakeElement && node.className.split(/\s+/).includes('sr-only')) return;
    if (node instanceof FakeText && node.data.trim()) {
      const foreground = inherited(node.parentElement, 'text', TOKENS.get('text-dark') as string);
      const background = inherited(node.parentElement, 'bg', TOKENS.get('background') as string);
      const ratio = contrast(foreground, background);
      if (ratio < minimum) failures.push(`"${node.data.trim()}" ${foreground} on ${background} = ${ratio.toFixed(2)}:1`);
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
  return failures;
}

/**
 * `root` as it looks under the pointer: on it and every element inside it,
 * the hover: utilities win over the rest. The pointer on a text run hovers
 * all its ancestors too, so lowContrastText then checks each run as it looks
 * with the pointer on it.
 */
export function hovered<T extends FakeElement>(root: T) {
  for (const element of [root, ...descendants(root)]) {
    const utilities = element.className.split(/\s+/);
    const hover = utilities.filter((utility) => utility.startsWith('hover:'));
    if (hover.length) element.setAttribute('class', [...utilities.filter((utility) => !hover.includes(utility)), ...hover.map((utility) => utility.slice('hover:'.length))].join(' '));
  }
  return root;
}
