// Rows the admin console's moderation pages read, for their tests.
import type { AdminComplaint, AdminComplaintDetail, IssueCategory } from '@/app/lib/admin-complaints-api';
import type { ModeratedListing, ModeratedReview } from '@/app/lib/admin-moderation-api';

export function adminComplaint(id: string, over: Partial<AdminComplaint> = {}): AdminComplaint {
  return {
    id, subject: `Complaint ${id}`, description: 'The heater is broken.', category: 'MAINTENANCE', category_label: 'Maintenance',
    category_active: true, severity: 'MEDIUM', status: 'OPEN', withdrawn: false, lodged_at: '2026-10-01T00:00:00Z',
    resolved_at: null, complainant: { id: 'tia', full_name: 'Tia Nguyen', role: 'tenant' },
    against: { id: 'oliver', full_name: 'Oliver Grant', role: 'landlord' }, property_id: 'p1', listing_id: 'l1',
    property_title: 'Harbour flat', assignee: null, responded: false, ...over,
  };
}

export function adminComplaintDetail(id: string, over: Partial<AdminComplaintDetail> = {}): AdminComplaintDetail {
  return {
    ...adminComplaint(id), response: null, responded_at: null, resolution_note: null, evidence_urls: [],
    timeline: [{
      id: 'e1', event_type: 'CREATED', note: null, from_status: null, to_status: null,
      actor: { id: 'tia', full_name: 'Tia Nguyen', role: 'tenant' }, assignee: null, source: 'web', created_at: '2026-10-01T00:00:00Z',
    }],
    transitions: ['IN_REVIEW', 'ESCALATED', 'RESOLVED', 'CLOSED'],
    ...over,
  };
}

export function issueCategory(id: string, code: string, name: string, over: Partial<IssueCategory> = {}): IssueCategory {
  return {
    id, code, name, description: '', severity: 'NORMAL', sla_hours: 72, routing_team: 'Complaint Resolution Team',
    source_categories: [], keywords: [], is_active: true, updated_at: '2026-10-01T00:00:00Z', complaint_count: 0, ...over,
  };
}

export function moderatedReview(id: string, over: Partial<ModeratedReview> = {}): ModeratedReview {
  return {
    id, status: 'PUBLISHED', rating: 1, title: null, body: 'The owner is a crook.', reply: null, is_verified_interaction: true,
    created_at: '2026-10-01T00:00:00Z', reviewer: { id: 'mia', full_name: 'Mia Tenant', role: 'tenant' },
    reviewed: { id: 'oliver', full_name: 'Oliver Grant', role: 'landlord' }, property_id: 'p1', listing_id: 'l1',
    property_title: 'Harbour flat', open_reports: 1,
    reports: [{
      id: 'r1', reporter: { id: 'oliver', full_name: 'Oliver Grant', role: 'landlord' }, reason: 'offensive',
      details: 'Defamatory.', open: true, created_at: '2026-10-02T00:00:00Z',
    }],
    decisions: [],
    ratings: {}, details: null, photo_count: 0, photos: [],
    ...over,
  };
}

export function moderatedListing(id: string, over: Partial<ModeratedListing> = {}): ModeratedListing {
  return {
    id, title: `Listing ${id}`, status: 'PUBLISHED', weekly_rent: 650, address: '12 Harbour St, Wollongong, NSW, 2500',
    suburb: 'Wollongong', created_at: '2026-10-01T00:00:00Z', published_at: '2026-10-01T00:00:00Z',
    owner: { id: 'oliver', full_name: 'Oliver Grant', role: 'landlord' }, manager: null, actions: ['pause', 'archive'],
    last_decision: null, ...over,
  };
}
