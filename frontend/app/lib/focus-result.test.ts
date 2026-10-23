import { cleanup } from '@/app/components/ui/test-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { focusResult } from './focus-result';

/** A section with the button that was pressed and its result, and a field outside it. */
function page() {
  const section = document.body.appendChild(document.createElement('section'));
  return {
    section,
    button: section.appendChild(document.createElement('button')),
    result: section.appendChild(document.createElement('div')),
    field: document.body.appendChild(document.createElement('input')),
  };
}

afterEach(cleanup);

describe('focusResult', () => {
  it('moves focus to the result while focus is still inside the scope', () => {
    const { section, button, result } = page();
    button.focus();
    focusResult(result, section);
    expect(document.activeElement).toBe(result);
  });

  it('moves focus to the result when focus was lost to the page body', () => {
    const { section, button, result } = page();
    button.focus();
    button.blur();
    focusResult(result, section);
    expect(document.activeElement).toBe(result);
  });

  it('moves focus to the result when the focused control was removed', () => {
    const { section, button, result } = page();
    button.focus();
    section.removeChild(button);
    focusResult(result, section);
    expect(document.activeElement).toBe(result);
  });

  it('leaves focus on a field outside the scope that the person moved to', () => {
    const { section, result, field } = page();
    field.focus();
    focusResult(result, section);
    expect(document.activeElement).toBe(field);
  });
});
