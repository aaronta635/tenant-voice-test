import { cleanup, descendants, render } from '@/app/components/ui/test-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RatingForm from './RatingForm';

afterEach(cleanup);

describe('the repair rating form', () => {
  it('lets a long repair title in its legend wrap instead of widening the page', async () => {
    const legend = `How was ${'Replace-the-hallway-smoke-alarm-'.repeat(6)}?`;
    const view = await render(<RatingForm action="Rate this repair" legend={legend} onSubmit={vi.fn()} />);

    // A fieldset is as wide as its content unless told otherwise (min-inline-size: min-content).
    const fieldset = descendants(view).find((element) => element.tagName === 'FIELDSET')!;
    expect((fieldset.getAttribute('class') ?? '').split(' ')).toContain('min-w-0');
    const text = descendants(view).find((element) => element.tagName === 'LEGEND')!;
    expect(text.getAttribute('class')).toContain('[overflow-wrap:anywhere]');
  });
});
