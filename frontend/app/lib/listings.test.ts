import { describe, expect, it } from 'vitest';
import type { Application } from './api';
import {
  applicationInput,
  canWithdraw,
  decisionNote,
  listingActions,
  listingStatusNote,
  listingStatusOf,
  localityOf,
  prefillApplication,
  stageOf,
} from './listings';
import { emptyTenant, myProfile } from '@/app/test-utils/my-profile';

const TODAY = '2026-10-23';

describe('prefillApplication', () => {
  const profile = (tenant: object) => myProfile({ tenant: { ...emptyTenant(), ...tenant } });

  it('fills the form from the saved profile and says which fields it filled', () => {
    const { draft, prefilled } = prefillApplication(profile({
      move_in_date: '2026-11-15', household_size: 3, has_pets: true, household: { members: [], pets: ' A dog ' },
      budget_max: 600, about_me: 'Quiet couple. ',
    }), 650, TODAY);

    expect(draft).toEqual({
      moveInDate: '2026-11-15', occupants: '3', hasPets: true, pets: 'A dog', offer: '600', about: 'Quiet couple.',
      income: '', message: '', documentIds: [],
    });
    expect(prefilled).toEqual({ moveInDate: true, occupants: true, hasPets: true, pets: true, offer: true, about: true });
  });

  it('never offers more than the asking rent, and offers it without a budget', () => {
    expect(prefillApplication(profile({ budget_max: 900 }), 650, TODAY).draft.offer).toBe('650');
    expect(prefillApplication(profile({}), 650, TODAY).draft.offer).toBe('650');
    expect(prefillApplication(null, 650, TODAY).prefilled).toEqual({});
  });

  it('leaves out a move-in date that has passed and pet details without pets', () => {
    const { draft, prefilled } = prefillApplication(profile({
      move_in_date: '2026-10-22', has_pets: false, household: { members: [], pets: 'A dog' },
    }), 650, TODAY);

    expect(draft.pets).toBe('');
    expect(draft.moveInDate).toBe('');
    expect(prefilled.moveInDate).toBeUndefined();
  });
});

describe('applicationInput', () => {
  const draft = prefillApplication(null, 650, TODAY).draft;

  it('trims text and sends nulls for what is left empty', () => {
    expect(applicationInput('pr-1', { ...draft, about: '  Hi  ', pets: 'A cat', message: ' ' }, TODAY)).toEqual({
      input: {
        property_id: 'pr-1', move_in_date: null, occupants: null, has_pets: false, pets: null, rent_offered: 650,
        about: 'Hi', annual_income: null, message: null, document_ids: [],
      },
    });
  });

  it.each([
    [{ moveInDate: '2026-10-22' }, 'moveInDate'],
    [{ occupants: '0' }, 'occupants'],
    [{ occupants: '2.5' }, 'occupants'],
    [{ offer: '-5' }, 'offer'],
    [{ income: 'lots' }, 'income'],
  ])('refuses %o before it is sent', (change, field) => {
    expect(applicationInput('pr-1', { ...draft, ...change }, TODAY)).toMatchObject({ field });
  });
});

describe('listing statuses and actions', () => {
  it('reads an older response from the web status', () => {
    expect(listingStatusOf({ status: 'rented' })).toBe('leased');
    expect(listingStatusOf({ status: 'off_market' })).toBe('paused');
    expect(listingStatusOf({ status: 'available', listing_status: 'applications_closed' })).toBe('applications_closed');
  });

  it("offers each status only the moves the shared database allows, and none once leased", () => {
    const moves = (status: Parameters<typeof listingActions>[0]) => listingActions(status).map((action) => action.to);

    expect(moves('draft')).toEqual(['published', 'archive']);
    expect(moves('published')).toEqual(['applications_closed', 'paused', 'archive']);
    // Closed to applications, a listing reopens but never pauses; only an approval leases it.
    expect(moves('applications_closed')).toEqual(['published', 'archive']);
    expect(moves('paused')).toEqual(['published', 'archive']);
    expect(moves('leased')).toEqual([]);
  });

  it('says how a listing comes to be leased', () => {
    expect(listingStatusNote('published')).toBe('Approving an application leases the listing and declines the other open applications.');
    expect(listingStatusNote('leased')).toContain('To let the home again, create a new listing.');
    expect(listingStatusNote('paused')).toBeNull();
  });

  it('writes where a listing is without its street', () => {
    expect(localityOf({ suburb: 'Wollongong', state: 'NSW', postcode: '2500' })).toBe('Wollongong, NSW 2500');
    expect(localityOf({ suburb: null, state: 'NSW', postcode: null })).toBe('NSW');
  });
});

describe('application stages', () => {
  const application = (over: Partial<Application>) => ({ status: 'new', shortlisted: false, ...over }) as Application;

  it('reads an older response from the web status', () => {
    expect(stageOf(application({ status: 'reviewing', shortlisted: true }))).toBe('shortlisted');
    expect(stageOf(application({ status: 'reviewing' }))).toBe('under_review');
    expect(stageOf(application({ status: 'declined', stage: 'withdrawn' }))).toBe('withdrawn');
  });

  it('lets the tenant withdraw only while the landlord has not decided', () => {
    expect(canWithdraw(application({ stage: 'shortlisted' }))).toBe(true);
    expect(canWithdraw(application({ status: 'approved' }))).toBe(false);
    expect(canWithdraw(application({ stage: 'submitted', can_withdraw: false }))).toBe(false);
  });

  it("finds the landlord's newest note", () => {
    expect(decisionNote({ history: [
      { from_stage: null, to_stage: 'submitted', note: 'mine', by: 'applicant', created_at: '' },
      { from_stage: 'submitted', to_stage: 'declined', note: 'We chose a family.', by: 'landlord', created_at: '' },
    ] })).toBe('We chose a family.');
    expect(decisionNote({ history: [] })).toBeNull();
  });
});
