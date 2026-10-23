// Where a tenant or landlord is in the web's onboarding (R19): the step to
// resume at and when they finished, which the server keeps in
// users.metadata.onboarding.<role> (backend/app/schemas/onboarding.py). The
// wizard saves each step's answers through the profile and documents APIs
// first, then its place here. Providers have their own wizard, which works
// its step out from the provider profile.

import { api } from './api';
import { safeNextPath } from './auth-redirect';
import { ROLE_HOME } from './session-role';

export type OnboardingRole = 'tenant' | 'landlord';

export type OnboardingProgress = {
  role: OnboardingRole;
  /** The step to resume at; null until the member first saves one. */
  step: string | null;
  /** When the member first finished; going through the steps again keeps it. */
  completed_at: string | null;
};

/**
 * The calls go through api.onboarding, so a page's test that replaces `api`
 * (as the dashboards' tests do) gets a refused call here, never a request to
 * a real server. Async, so a missing api.onboarding is a rejection, not a throw.
 */
export const onboardingApi = {
  get: async (): Promise<OnboardingProgress> => api.onboarding.get(),
  /** Saves the step to resume at; completed on the last step finishes onboarding. */
  save: async (step: string, completed = false): Promise<OnboardingProgress> => api.onboarding.save(step, completed),
};

/** Each role's wizard. */
export const ONBOARDING_HREF: Record<OnboardingRole, string> = {
  tenant: '/tenant/onboarding',
  landlord: '/owner/onboarding',
};

/** Each role's dashboard. */
export const ONBOARDING_HOME: Record<OnboardingRole, string> = {
  tenant: ROLE_HOME.Client,
  landlord: ROLE_HOME.Owner,
};

/**
 * Where leaving the wizard goes, finished or not: the task the member started
 * before signing up, such as listing a property, else their dashboard.
 */
export function onboardingExit(role: OnboardingRole, next: string | null): string {
  return safeNextPath(next) ?? ONBOARDING_HOME[role];
}

/** Started and not finished: skipped, or closed part way. The dashboard offers to finish. */
export function setupUnfinished(progress: OnboardingProgress | null | undefined): boolean {
  return Boolean(progress?.step && !progress.completed_at);
}
