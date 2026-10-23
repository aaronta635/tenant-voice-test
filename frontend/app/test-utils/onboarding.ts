// For the onboarding tests: a stand-in for the server behind GET and PUT
// /me/onboarding (lib/onboarding), which keeps a member's place as the
// backend does (the step moves with every save, the first finish keeps its
// time), and the controls of the wizard found by what a person reads.
import { click, descendants, getByName, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import type { OnboardingProgress, OnboardingRole } from '@/app/lib/onboarding';

export function progressServer(role: OnboardingRole, initial: Partial<OnboardingProgress> = {}) {
  let stored: OnboardingProgress = { role, step: null, completed_at: null, ...initial };
  const saves: { step: string; completed: boolean }[] = [];
  return {
    get progress() {
      return { ...stored };
    },
    /** Every save, in order. */
    saves,
    get: async () => ({ ...stored }),
    save: async (step: string, completed = false) => {
      saves.push({ step, completed });
      stored = { ...stored, step, completed_at: stored.completed_at ?? (completed ? '2026-10-23T09:00:00Z' : null) };
      return { ...stored };
    },
  };
}

export const heading = (view: FakeElement) =>
  textOf(descendants(view).find((element) => element.tagName === 'H1') as FakeElement);

export const button = (view: FakeElement, name: string | RegExp) => getByName(view, 'button', name);

export const alerts = (view: FakeElement) =>
  descendants(view).filter((element) => element.getAttribute('role') === 'alert').map(textOf).filter(Boolean);

/** The fieldset a legend names, to tell apart controls with the same label in other groups. */
export function group(view: FakeElement, legend: string): FakeElement {
  const found = descendants(view).filter(
    (element) => element.tagName === 'FIELDSET'
      && descendants(element).some((child) => child.tagName === 'LEGEND' && textOf(child) === legend),
  );
  if (found.length === 0) throw new Error(`No group "${legend}"`);
  return found.at(-1) as FakeElement;
}

/** The control a label names: through its for, or the one inside it. */
export function field(view: FakeElement, label: string | RegExp): FakeElement {
  const labels = descendants(view).filter((element) => element.tagName === 'LABEL'
    && (typeof label === 'string' ? textOf(element) === label : label.test(textOf(element))));
  if (labels.length !== 1) throw new Error(`Expected one label ${String(label)}, found ${labels.length}`);
  const id = labels[0].getAttribute('for');
  const control = id
    ? descendants(view).find((element) => element.id === id)
    : descendants(labels[0]).find((element) => element.tagName === 'INPUT');
  if (!control) throw new Error(`No control for ${String(label)}`);
  return control;
}

/** Ticks or unticks a checkbox, or picks a radio, as a click does. */
export async function tick(view: FakeElement, label: string | RegExp) {
  const box = field(view, label);
  box.checked = box.getAttribute('type') === 'radio' ? true : !box.checked;
  await click(box);
}
