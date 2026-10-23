import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CalendarDay from './CalendarDay';

function classesOf(props: { today: boolean; booked: boolean; enquiry: boolean }): string[] {
  const html = renderToStaticMarkup(<CalendarDay date="2026-10-21" day={21} {...props} />);
  return /^<span[^>]*\sclass="([^"]*)"/.exec(html)?.[1].split(/\s+/) ?? [];
}

describe('overview calendar day', () => {
  it('keeps the today outline on a day with an unaccepted enquiry', () => {
    const classes = classesOf({ today: true, booked: false, enquiry: true });
    expect(classes).toEqual(expect.arrayContaining(['border-dashed', 'border-warning', 'ring-2', 'ring-text-dark']));
  });

  it('outlines today on booked and empty days too', () => {
    expect(classesOf({ today: true, booked: true, enquiry: false })).toEqual(expect.arrayContaining(['bg-primary-strong', 'ring-2']));
    expect(classesOf({ today: true, booked: false, enquiry: false })).toEqual(expect.arrayContaining(['border-text-dark', 'ring-2']));
  });

  it('outlines no other day', () => {
    expect(classesOf({ today: false, booked: false, enquiry: true })).not.toContain('ring-2');
    expect(classesOf({ today: false, booked: true, enquiry: false })).not.toContain('ring-2');
    expect(classesOf({ today: false, booked: false, enquiry: false })).not.toContain('ring-2');
  });
});

describe('overview calendar day for screen readers', () => {
  const markup = (props: { today: boolean; booked: boolean; enquiry: boolean }) =>
    renderToStaticMarkup(<CalendarDay date="2026-10-21" day={21} {...props} />);
  // What a screen reader reads: the text, hidden helper text included, without the tags.
  const spoken = (html: string) => html.replace(/<[^>]+>/g, '');

  it('reads out the weekday and what the day holds', () => {
    expect(spoken(markup({ today: true, booked: true, enquiry: false }))).toBe('Wednesday 21, today, confirmed booking');
    expect(spoken(markup({ today: false, booked: false, enquiry: true }))).toBe('Wednesday 21, unaccepted enquiry');
    expect(spoken(markup({ today: false, booked: false, enquiry: false }))).toBe('Wednesday 21');
  });

  it('keeps the state out of aria-label, which a plain span cannot carry', () => {
    expect(markup({ today: true, booked: true, enquiry: true })).not.toContain('aria-label');
  });
});
