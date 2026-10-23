import { cleanup, render } from './test-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import Button from './Button';
import Card from './Card';
import Input from './Input';

afterEach(cleanup);

async function classesOf(ui: ReactNode, tag: string) {
  const [element] = (await render(ui)).querySelectorAll(tag);
  return element.className.split(/\s+/);
}

describe('shared primitives keep the caller classes Tailwind would apply', () => {
  it('lets a caller height replace the button size floor instead of rendering 44px', async () => {
    expect(await classesOf(<Button>Save</Button>, 'button')).toContain('min-h-11');
    for (const [ui, height] of [
      [<Button key="md" className="mt-5 h-10">Try again</Button>, 'h-10'],
      [<Button key="sm" size="sm" className="h-9">Apply</Button>, 'h-9'],
      [<Button key="icon" variant="ghost" className="size-9" aria-label="Close" />, 'size-9'],
    ] as const) {
      const classes = await classesOf(ui, 'button');
      expect(classes).toContain(height);
      expect(classes.filter((utility) => utility.startsWith('min-h-'))).toEqual([]);
    }
  });

  it('treats the heading scale as a font size, so the text colour stays', async () => {
    const primary = await classesOf(<Button className="text-h4">Book now</Button>, 'button');
    expect(primary).toEqual(expect.arrayContaining(['text-h4', 'text-white']));
    expect(primary).not.toContain('text-sm');

    const secondary = await classesOf(<Button variant="secondary" className="text-display">Browse</Button>, 'button');
    expect(secondary).toContain('text-primary-strong');
  });

  it('does the same for inputs and cards', async () => {
    const input = await classesOf(<Input aria-label="Search" className="h-12 text-h4" />, 'input');
    expect(input).toEqual(expect.arrayContaining(['h-12', 'text-h4', 'text-[#171a1f]']));
    expect(input).not.toContain('min-h-11');
    expect(input).not.toContain('text-sm');

    expect(await classesOf(<Card className="text-h3 text-text-body" />, 'div')).toEqual(expect.arrayContaining(['text-h3', 'text-text-body']));
  });
});
