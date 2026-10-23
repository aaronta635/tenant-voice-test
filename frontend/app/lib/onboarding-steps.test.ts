import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANDLORD_WIZARD } from '@/app/components/onboarding/LandlordOnboarding';
import { TENANT_WIZARD } from '@/app/components/onboarding/TenantOnboarding';
import { LANDLORD_STEPS, stepLabel, TENANT_STEPS } from './onboarding-steps';

const doc = readFileSync(new URL('../../../docs/shared-db.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
const names = (text: string) => [...text.matchAll(/`([a-z][a-z0-9-]*)`/g)].map(([, name]) => name);

describe('the onboarding steps', () => {
  it('are the names docs/shared-db.md gives the step to resume at, after the welcome step', () => {
    const [, tenant, landlord] = /The tenant wizard's steps are (.+?); the landlord's are (.+?)\./.exec(doc) ?? [];

    expect(names(tenant ?? '')).toEqual(['welcome', ...TENANT_STEPS.map((step) => step.key)]);
    expect(names(landlord ?? '')).toEqual(['welcome', ...LANDLORD_STEPS.map((step) => step.key)]);
  });

  it('take a form the server accepts the name of', () => {
    for (const step of [...TENANT_STEPS, ...LANDLORD_STEPS]) expect(step.key).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
  });

  it.each([
    ['tenant', TENANT_WIZARD],
    ['landlord', LANDLORD_WIZARD],
  ])('each have a form in the %s wizard', (_role, wizard) => {
    expect(wizard.filter((step) => !step.Step).map((step) => step.key)).toEqual([]);
  });

  it('name the step a setup resumes at, and none for the welcome step or one the wizard dropped', () => {
    expect(stepLabel('tenant', 'budget')).toBe('Rent and timing');
    expect(stepLabel('landlord', 'business')).toBe('Rental business');
    expect(stepLabel('tenant', 'business')).toBeNull();
    expect(stepLabel('tenant', 'welcome')).toBeNull();
    expect(stepLabel('landlord', null)).toBeNull();
  });
});
