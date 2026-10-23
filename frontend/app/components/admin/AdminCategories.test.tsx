import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeChoice, IssueCategoryList } from '@/app/lib/admin-complaints-api';
import { ApiError } from '@/app/lib/api';
import { issueCategory } from '@/app/test-utils/admin-moderation';
import AdminCategories from './AdminCategories';

const mocks = vi.hoisted(() => ({
  categories: vi.fn(), createCategory: vi.fn(), updateCategory: vi.fn(), setCategoryActive: vi.fn(),
}));
vi.mock('@/app/lib/admin-complaints-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-complaints-api')>()),
  adminComplaintsApi: mocks,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const codes: CodeChoice[] = [
  { code: 'PROPERTY_CONDITION', label: 'Property condition', kind: 'general' },
  { code: 'SAFETY', label: 'Safety', kind: 'both' },
  { code: 'LEAK', label: 'Leak', kind: 'repair' },
];
const mould = issueCategory('k1', 'mould_damp', 'Mould and damp', {
  severity: 'HIGH', sla_hours: 48, description: 'Damp and mould.', source_categories: ['PROPERTY_CONDITION', 'Noise/Disturbance'],
  keywords: ['mould'], complaint_count: 3,
});
const noise = issueCategory('k2', 'noise', 'Noise', { is_active: false, complaint_count: 1, keywords: ['noise'] });

function listOf(over: Partial<IssueCategoryList> = {}): IssueCategoryList {
  return { categories: [mould, noise], codes, ...over };
}

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};
const checkbox = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item) === label)!;
  return descendants(element).find((item) => item.tagName === 'INPUT')!;
};
const openDialog = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open'))!;
const formIn = (element: FakeElement) => descendants(element).find((item) => item.tagName === 'FORM')!;
const cardOf = (view: FakeElement, name: string) =>
  descendants(view).find((element) => element.tagName === 'LI' && textOf(element).startsWith(name))!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.categories.mockResolvedValue(listOf());
});
afterEach(cleanup);

describe('the alert policies', () => {
  it('list every policy with its state, limits, the categories and words it covers, and its complaints', async () => {
    const view = await render(<AdminCategories />);

    expect(textOf(view)).toContain('Alert policies');
    const card = cardOf(view, 'Mould and damp');
    expect(textOf(card)).toContain('Active');
    expect(textOf(card)).toContain('mould_damp');
    expect(textOf(card)).toContain('High severity');
    expect(textOf(card)).toContain('Respond within 48 hours');
    expect(textOf(card)).toContain('Covers 3 complaints');
    // A code by its name; another app's value as stored.
    expect(textOf(card)).toContain('Categories: Property condition, Noise/Disturbance');
    expect(textOf(card)).toContain('Keywords: mould');
    expect(textOf(cardOf(view, 'Noise'))).toContain('Inactive');
    expect(textOf(cardOf(view, 'Noise'))).toContain('No categories: keywords only');
    expect(getByName(cardOf(view, 'Noise'), 'button', 'Activate Noise')).toBeTruthy();
  });

  it('creates a policy whose code comes from its name, with the categories ticked', async () => {
    mocks.createCategory.mockResolvedValue(issueCategory('k5', 'pest_control', 'Pest control'));
    const view = await render(<AdminCategories />);

    await click(getByName(view, 'button', 'New policy'));
    const dialog = openDialog(view);
    await typeInto(field(dialog, 'Name') as FakeElement, 'Pest control');
    expect(textOf(dialog)).toContain('Its code will be pest_control, from the name.');
    const hours = field(dialog, 'Respond within') as FakeElement;
    await typeInto(hours, '2161');
    await dispatch(formIn(dialog), 'submit');
    expect(mocks.createCategory).not.toHaveBeenCalled();
    expect(textOf(dialog)).toContain('Give the response time as a whole number of hours, from 1 to 2160.');

    await typeInto(hours, '24');
    const severity = field(dialog, 'Severity') as FakeElement;
    severity.value = 'URGENT';
    await dispatch(severity, 'change');
    await click(checkbox(dialog, 'Leak'));
    await click(checkbox(dialog, 'Property condition'));
    await typeInto(field(dialog, 'Keywords') as FakeElement, 'rats, cockroach');
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.createCategory).toHaveBeenCalledWith({
      name: 'Pest control', description: '', severity: 'URGENT', sla_hours: 24, routing_team: 'Complaint Resolution Team',
      // In the list's order, whatever the order ticked.
      source_categories: ['PROPERTY_CONDITION', 'LEAK'], keywords: ['rats', 'cockroach'],
    });
    expect(textOf(view)).toContain('Pest control was added and raises alerts.');
  });

  it('asks for a name of 3 characters and a team before saving', async () => {
    const view = await render(<AdminCategories />);
    await click(getByName(view, 'button', 'New policy'));
    const dialog = openDialog(view);

    await typeInto(field(dialog, 'Name') as FakeElement, 'ab');
    await dispatch(formIn(dialog), 'submit');
    expect(textOf(dialog)).toContain('Give the policy a name of 3 to 80 characters.');
    await typeInto(field(dialog, 'Name') as FakeElement, 'Pests');
    await typeInto(field(dialog, 'Team') as FakeElement, ' x ');
    await dispatch(formIn(dialog), 'submit');
    expect(textOf(dialog)).toContain('Name the team in 3 to 80 characters.');
    expect(mocks.createCategory).not.toHaveBeenCalled();
  });

  it('edits only the fields that changed, on the version it opened, keeping its code', async () => {
    mocks.updateCategory.mockResolvedValue({ ...mould, sla_hours: 12, source_categories: ['PROPERTY_CONDITION', 'SAFETY'], complaint_count: null });
    const view = await render(<AdminCategories />);

    await click(getByName(cardOf(view, 'Mould and damp'), 'button', 'Edit Mould and damp'));
    const dialog = openDialog(view);
    expect(textOf(dialog)).toContain('Code mould_damp, which never changes.');
    expect((checkbox(dialog, 'Property condition') as FakeElement).checked).toBe(true);
    await typeInto(field(dialog, 'Respond within') as FakeElement, '12');
    await click(checkbox(dialog, 'Safety'));
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.updateCategory).toHaveBeenCalledWith(mould, { sla_hours: 12, source_categories: ['PROPERTY_CONDITION', 'SAFETY'] });
    expect(textOf(view)).toContain('Mould and damp was saved.');
  });

  it('shows why an edit was refused, and reads the list again', async () => {
    mocks.updateCategory.mockRejectedValue(new ApiError(409, 'This policy changed while you were editing it. Reload it and try again.'));
    const view = await render(<AdminCategories />);

    await click(getByName(cardOf(view, 'Mould and damp'), 'button', 'Edit Mould and damp'));
    const dialog = openDialog(view);
    await typeInto(field(dialog, 'Name') as FakeElement, 'Damp');
    await dispatch(formIn(dialog), 'submit');

    expect(textOf(dialog)).toContain('This policy changed while you were editing it.');
    expect(mocks.categories).toHaveBeenCalledTimes(2);
  });

  it('needs a reason to deactivate a policy, and activates one at once', async () => {
    mocks.setCategoryActive
      .mockResolvedValueOnce({ ...mould, is_active: false, complaint_count: null })
      .mockResolvedValueOnce({ ...noise, is_active: true, complaint_count: null });
    const view = await render(<AdminCategories />);

    await click(getByName(cardOf(view, 'Mould and damp'), 'button', 'Deactivate Mould and damp'));
    const dialog = openDialog(view);
    expect(textOf(dialog)).toContain('It stops raising alerts');
    await dispatch(formIn(dialog), 'submit');
    expect(mocks.setCategoryActive).not.toHaveBeenCalled();
    await typeInto(field(dialog, 'Reason') as FakeElement, 'Merged into Safety');
    mocks.categories.mockResolvedValue(listOf({ categories: [{ ...mould, is_active: false }, noise] }));
    await dispatch(formIn(dialog), 'submit');

    expect(mocks.setCategoryActive).toHaveBeenCalledWith('k1', false, 'Merged into Safety');
    expect(textOf(view)).toContain('Mould and damp no longer raises alerts.');
    expect(textOf(cardOf(view, 'Mould and damp'))).toContain('Inactive');

    await click(getByName(cardOf(view, 'Noise'), 'button', 'Activate Noise'));
    expect(mocks.setCategoryActive).toHaveBeenLastCalledWith('k2', true);
    expect(textOf(view)).toContain('Noise raises alerts again.');
  });

  it('offers a retry when the policies cannot load, and says when there are none', async () => {
    mocks.categories.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'))
      .mockResolvedValueOnce(listOf({ categories: [] }));
    const view = await render(<AdminCategories />);

    expect(textOf(view)).toContain("Couldn't load the policies");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('No policies yet, so no complaint raises an alert.');
  });

  it('keeps the page and the form at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminCategories />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
    await click(getByName(view, 'button', 'New policy'));
    expect(lowContrastText(openDialog(view))).toEqual([]);
  });
});
