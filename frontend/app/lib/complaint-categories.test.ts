import { describe, expect, it } from 'vitest';
import { describeStep, stepActor, type ComplaintStep } from './complaint-categories';

const step = (over: Partial<ComplaintStep>): ComplaintStep => ({
  id: 's1', kind: 'lodged', status: null, note: null, actor: 'you', created_at: '2026-10-01T00:00:00Z', ...over,
});

describe('a complaint timeline in words', () => {
  it('names who took each step from where the viewer stands', () => {
    const names = { complainant: 'Tia Nguyen', respondent: 'Oliver Grant' };
    expect(describeStep(step({}), names)).toBe('You lodged the complaint');
    expect(describeStep(step({ actor: 'complainant' }), names)).toBe('Tia Nguyen lodged the complaint');
    expect(describeStep(step({ kind: 'responded', actor: 'respondent' }), names)).toBe('Oliver Grant responded');
    expect(describeStep(step({ kind: 'status', status: 'escalated', actor: 'staff' }), names)).toBe('TenantVoice set the status to Escalated');
    expect(describeStep(step({ kind: 'status', status: 'dismissed' }), names)).toBe('You withdrew the complaint');
    expect(describeStep(step({ kind: 'other', actor: 'other' }), names)).toBe('The complaint was updated');
  });

  it('falls back to roles when a name is missing', () => {
    expect([stepActor({ actor: 'complainant' }), stepActor({ actor: 'respondent' }), stepActor({ actor: 'other' })]).toEqual([
      'The person who lodged it', 'The other party', 'Someone']);
  });
});
