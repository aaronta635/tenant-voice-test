import { cleanup, FakeElement, FakeText, render, textOf, type FakeNode } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, describe, expect, it } from 'vitest';
import DemoLabel from './DemoLabel';

afterEach(cleanup);

const classesOf = (element: FakeElement) => element.className.split(/\s+/);

/** The text a sighted reader sees: everything but screen-reader-only runs. */
function visibleText(node: FakeNode): string {
  if (node instanceof FakeElement && classesOf(node).includes('sr-only')) return '';
  if (node instanceof FakeText) return node.data;
  return node.childNodes.map(visibleText).join('');
}

async function label(variant?: 'pill' | 'notice') {
  const view = await render(<DemoLabel variant={variant} reason="sample photo, not of this listing" />);
  return view.children[0];
}

describe('DemoLabel pill', () => {
  it('shows "Demo" and reads its reason to screen readers', async () => {
    const pill = await label();

    expect(pill.tagName).toBe('SPAN');
    expect(pill.hasAttribute('data-demo-label')).toBe(true);
    expect(visibleText(pill)).toBe('Demo');
    expect(textOf(pill)).toBe('Demo: sample photo, not of this listing');
  });

  it('keeps AA contrast, an outline where fills are dropped, and dark text in print', async () => {
    const pill = await label();

    expect(lowContrastText(pill)).toEqual([]);
    // Forced colors and printing without backgrounds remove the fill; the border stays.
    expect(classesOf(pill)).toEqual(expect.arrayContaining(['border', 'border-primary-strong', 'print:border-text-dark', 'print:text-text-dark']));
  });

  it('takes the caller\'s placement', async () => {
    const view = await render(<DemoLabel reason="sample photo, not of this listing" className="absolute left-3 top-3" />);

    expect(classesOf(view.children[0])).toEqual(expect.arrayContaining(['absolute', 'left-3', 'top-3', 'bg-primary-strong']));
  });
});

describe('DemoLabel notice', () => {
  it('is a note named Demo that shows its reason beside the pill', async () => {
    const notice = await label('notice');

    expect(notice.getAttribute('role')).toBe('note');
    expect(notice.getAttribute('aria-label')).toBe('Demo');
    expect(notice.hasAttribute('data-demo-label')).toBe(true);
    expect(textOf(notice)).toBe('Demo: sample photo, not of this listing');
    const [pill, reason] = notice.children;
    expect(visibleText(pill)).toBe('Demo');
    expect(classesOf(pill)).toContain('bg-primary-strong');
    expect(visibleText(reason)).toBe('sample photo, not of this listing');
  });

  it('keeps AA contrast', async () => {
    expect(lowContrastText(await label('notice'))).toEqual([]);
  });

  it('lets the reason wrap below the pill on a narrow screen, not into a narrow column', async () => {
    const [, reason] = (await label('notice')).children;

    expect(classesOf(reason)).toEqual(expect.arrayContaining(['grow', 'basis-48', 'min-w-0']));
    expect(classesOf(reason)).not.toContain('flex-1');
  });
});
