import { toBackendRole } from './api';
import { authPageHref } from './auth-redirect';
import type { SessionRole } from './session-role';

/** The services page opens its new-service form for ?new=1. */
export const ADD_SERVICE_HREF = '/dashboard/services?new=1';
/** The first step of the landlord's listing wizard. */
export const ADD_PROPERTY_HREF = '/owner/properties/create';

export type ListOption = {
  id: 'service' | 'property';
  label: string;
  description: string;
  /** The account type whose workspace holds the form. */
  role: SessionRole;
  account: string;
  task: string;
  form: string;
};

/** What the header's "List" menu offers. */
export const LIST_OPTIONS: ListOption[] = [
  {
    id: 'service',
    label: 'List your service',
    description: 'For service providers: offer upfront-priced work',
    role: 'Provider',
    account: 'service provider',
    task: 'list a service',
    form: ADD_SERVICE_HREF,
  },
  {
    id: 'property',
    label: 'List your property',
    description: 'For landlords: advertise a rental and review applicants',
    role: 'Owner',
    account: 'landlord',
    task: 'list a property',
    form: ADD_PROPERTY_HREF,
  },
];

/**
 * Where an option leads for the session: a visitor signs up for its account
 * type and lands on the form; that account type goes straight to the form.
 * Another account type cannot open it, so it gets null and an explanation.
 */
export function listOptionHref(option: ListOption, session: SessionRole | null): string | null {
  if (!session) return listOptionSignUpHref(option);
  return session === option.role ? option.form : null;
}

/** Sign-up for the option's account type, which lands on its form. */
export function listOptionSignUpHref(option: ListOption): string {
  return authPageHref('/register', toBackendRole(option.role), option.form);
}

/** Sign-in for the option's account type, which returns to its form. */
export function listOptionSignInHref(option: ListOption): string {
  return authPageHref('/login', toBackendRole(option.role), option.form);
}
