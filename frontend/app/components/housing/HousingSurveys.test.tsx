import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { Survey } from '@/app/lib/housing-api';
import HousingSurveys, { closesLabel } from './HousingSurveys';

const mocks = vi.hoisted(() => ({ surveys: vi.fn(), create: vi.fn(), setStatus: vi.fn() }));
vi.mock('@/app/lib/housing-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/housing-api')>()),
  housingApi: { surveys: mocks.surveys, createSurvey: mocks.create, setSurveyStatus: mocks.setStatus },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const SURVEY: Survey = {
  id: 'SV-2001', title: 'Rental repairs pulse', audience: 'Tenants', status: 'Draft', responses: 0, target_responses: 1000,
  closes_at: 'Not scheduled', created_at: '2026-10-01T00:00:00Z', questions: [{ id: 1, sort_order: 1, text: 'How quickly was your repair done?' }],
  next_status: 'Live',
};

const byId = (view: FakeElement, suffix: string) => descendants(view).find((element) => element.id.endsWith(suffix)) as FakeElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.surveys.mockResolvedValue([SURVEY]);
  mocks.create.mockImplementation(async (body) => ({ ...SURVEY, id: 'SV-NEW', title: body.title, questions: body.questions.map((text: string, index: number) => ({ id: 10 + index, sort_order: index + 1, text })) }));
  mocks.setStatus.mockImplementation(async (id: string, status: string) => ({ ...SURVEY, id, status, next_status: status === 'Live' ? 'Closed' : null }));
});
afterEach(cleanup);

describe('the housing surveys', () => {
  it('labels the surveys as prototypes and lists each with its questions', async () => {
    const view = await render(<HousingSurveys />);

    expect(textOf(view)).toContain('Demo: Prototype surveys: no survey is sent to anyone and no answers are collected yet.');
    expect(textOf(view)).toContain('Rental repairs pulse');
    expect(textOf(view)).toContain('How quickly was your repair done?');
    expect(textOf(view)).toContain('Responses stored: 0 of 1000');
  });

  it('saves a draft with one question per line', async () => {
    const view = await render(<HousingSurveys />);

    await typeInto(byId(view, '-title'), 'Bond returns');
    await typeInto(byId(view, '-questions'), 'Was your bond returned in full?\n\n  How long did it take?  ');
    await typeInto(byId(view, '-closes'), '2026-12-01');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(mocks.create).toHaveBeenCalledWith({
      title: 'Bond returns', audience: 'Tenants', target_responses: 1000, closes_on: '2026-12-01',
      questions: ['Was your bond returned in full?', 'How long did it take?'],
    });
    expect(textOf(view)).toContain('Draft saved. It is sent to nobody');
    expect(textOf(view)).toContain('How long did it take?');
  });

  it('asks for a title and a question before saving', async () => {
    const view = await render(<HousingSurveys />);

    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(textOf(view)).toContain('Give the survey a title.');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('takes a draft live, then offers to close it', async () => {
    const view = await render(<HousingSurveys />);

    await click(getByName(view, 'button', 'Go live: Rental repairs pulse'));

    expect(mocks.setStatus).toHaveBeenCalledWith('SV-2001', 'Live', 'Draft');
    expect(getByName(view, 'button', 'Close survey: Rental repairs pulse')).toBeTruthy();
  });

  it('shows why a change was refused', async () => {
    mocks.setStatus.mockRejectedValue(new ApiError(409, 'This survey is now Live. Reload the surveys and try again.'));
    const view = await render(<HousingSurveys />);

    await click(getByName(view, 'button', 'Go live: Rental repairs pulse'));

    expect(textOf(view)).toContain('This survey is now Live. Reload the surveys and try again.');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('reads a closing date the web saved, and keeps another app\'s words', () => {
    expect(closesLabel('2026-12-01')).toBe('1 Dec 2026');
    expect(closesLabel('End of term')).toBe('End of term');
    expect(closesLabel('')).toBe('Not scheduled');
  });
});
