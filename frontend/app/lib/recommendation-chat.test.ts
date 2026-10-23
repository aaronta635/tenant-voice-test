import { describe, expect, it } from 'vitest';
import type { RecommendationChatMessage } from './api';
import {
  chatHistory, criteriaReady, criteriaToFilters, describeSearch, EMPTY_CRITERIA, keepKnownServices, missingCriteria,
} from './recommendation-chat';

const SERVICES = [{ id: 's1', title: 'Rental appraisal' }, { id: 's2', title: 'Leasing' }];

describe('recommendation chat criteria', () => {
  it('needs both who and where before searching; "" means anywhere', () => {
    expect(criteriaReady(EMPTY_CRITERIA)).toBe(false);
    expect(missingCriteria(EMPTY_CRITERIA)).toEqual(['who to reach', 'an area']);
    expect(criteriaReady({ ...EMPTY_CRITERIA, role: 'any' })).toBe(false);
    expect(criteriaReady({ ...EMPTY_CRITERIA, role: 'any', location: '' })).toBe(true);
    expect(missingCriteria({ ...EMPTY_CRITERIA, location: 'Ryde' })).toEqual(['who to reach']);
  });

  it('maps criteria to the search filters the API accepts', () => {
    expect(criteriaToFilters({ role: 'any', location: '', service_ids: [], new_only: false }))
      .toEqual({ role: undefined, location: undefined, service_ids: undefined, new_only: undefined, limit: 12 });
    expect(criteriaToFilters({ role: 'landlord', location: ' Newtown ', service_ids: ['s1'], new_only: true }))
      .toEqual({ role: 'landlord', location: 'Newtown', service_ids: ['s1'], new_only: true, limit: 12 });
  });

  it('describes the search in plain words', () => {
    expect(describeSearch({ role: 'landlord', location: 'Newtown', service_ids: ['s1', 'gone'], new_only: false }, SERVICES))
      .toBe('landlords in Newtown for Rental appraisal');
    expect(describeSearch({ role: 'any', location: '', service_ids: [], new_only: true }, SERVICES))
      .toBe('landlords and tenants you are not connected with yet in any area');
  });

  it('drops service selections that no longer exist', () => {
    const criteria = { ...EMPTY_CRITERIA, service_ids: ['s1', 'old'] };
    expect(keepKnownServices(criteria, SERVICES).service_ids).toEqual(['s1']);
    const unchanged = { ...EMPTY_CRITERIA, service_ids: ['s2'] };
    expect(keepKnownServices(unchanged, SERVICES)).toBe(unchanged);
  });

  it('sends at most the 20 most recent messages', () => {
    const messages: RecommendationChatMessage[] = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', content: `m${index}`,
    }));
    const history = chatHistory(messages);
    expect(history).toHaveLength(20);
    expect(history.at(-1)?.content).toBe('m24');
  });
});
