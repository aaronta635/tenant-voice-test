import { useImperativeHandle, type RefObject } from 'react';
import type { MyProfile, MyProfileUpdate } from '@/app/lib/my-profile';

/**
 * What a step's answers come to when the member moves on: a patch for
 * PATCH /profiles/me, a problem to fix first (with the id of the field to
 * focus), or null when nothing changed or the step saves on its own, as the
 * documents step does.
 */
export type StepAnswers = { patch: MyProfileUpdate } | { problem: string; field?: string } | null;

export type StepHandle = { answers: () => StepAnswers };

export type StepProps = {
  /** The profile as the server last sent it; a step's form starts from it. */
  profile: MyProfile;
  /** Filled by the step, read by the wizard on Continue, Back and Save & close. */
  handle: RefObject<StepHandle | null>;
};

/** Hands the wizard a step's answers, from its latest form. */
export function useStepAnswers(handle: RefObject<StepHandle | null>, answers: () => StepAnswers) {
  useImperativeHandle(handle, () => ({ answers }));
}

/**
 * Focus an element once the change that shows it has rendered: a step's
 * control that unmounts or disables the one the member pressed hands focus
 * on, instead of dropping it to the page.
 */
export function focusSoon(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

/** The keys of an object whose values are defined: what a patch of changed fields holds. */
export function defined<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** A patch from the changed fields, or null when none changed. */
export function patchOf(patch: MyProfileUpdate, changed: object): StepAnswers {
  return Object.keys(changed).length ? { patch } : null;
}
