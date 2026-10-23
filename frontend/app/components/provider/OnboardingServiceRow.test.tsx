import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OnboardingServiceRow from './OnboardingServiceRow';

const LABELABLE = /<(?:input|select|textarea|button|meter|output|progress)\b[^>]*>/g;

function labels(): { html: string; text: string; controls: string[] }[] {
  const markup = renderToStaticMarkup(
    <OnboardingServiceRow service={{ id: 'appraisal', title: 'Rental appraisal', price: '150', is_active: true }} index={1} invalid={false} canRemove onChange={() => undefined} onRemove={() => undefined} />,
  );
  return [...markup.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)].map(([, attributes, body]) => ({
    html: `<label${attributes}>`,
    text: body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    controls: body.match(LABELABLE) ?? [],
  }));
}

describe('onboarding service row', () => {
  it('labels one control per label, so the checkbox no longer shares the pricing label', () => {
    for (const label of labels()) expect(label.controls).toHaveLength(1);
  });

  it('names the enable checkbox by its own text, with the service it belongs to', () => {
    const enable = labels().find((label) => label.controls[0]?.includes('type="checkbox"'));
    expect(enable?.text).toBe('Enable service on my public profile, service 2');
  });

  it('offers the service form\'s three pricing types, with the saved one chosen', () => {
    const markup = renderToStaticMarkup(
      <OnboardingServiceRow service={{ title: 'Window clean', price: '85', pricing_type: 'hourly' }} index={0} invalid={false} canRemove onChange={() => undefined} onRemove={() => undefined} />,
    );
    const options = [...markup.matchAll(/<option value="([^"]+)"( selected="")?>([^<]+)<\/option>/g)].map(([, value, selected, label]) => [value, label, !!selected]);

    expect(options).toEqual([['flat', 'Fixed price', false], ['hourly', 'Hourly rate', true], ['from', 'Starting from', false]]);
  });

  it('gives the checkbox a larger box and a 44px tap row', () => {
    const enable = labels().find((label) => label.controls[0]?.includes('type="checkbox"'));
    expect(enable?.controls[0]).toContain('size-5');
    expect(enable?.html).toContain('min-h-11');
  });
});
