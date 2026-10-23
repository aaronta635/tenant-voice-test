// Job requests owners send the provider from the mobile app (backend
// /me/job-requests, tracker R33). The shared function decides each move:
// accept or decline a pending job, start an accepted one, complete one in
// progress. The owner is told each time.

import { apiFetch } from './api';

export type JobStatus = 'pending' | 'accepted' | 'declined' | 'in_progress' | 'completed' | 'cancelled';
export type JobMove = 'accepted' | 'declined' | 'in_progress' | 'completed';

export type ProviderJob = {
  id: string;
  title: string;
  description: string | null;
  status: JobStatus;
  owner_id: string | null;
  owner_name: string | null;
  property_title: string | null;
  listing_id: string | null;
  /** Written by assigning a repair: its visit is booked on the repairs list. */
  from_repair: boolean;
  created_at: string | null;
  next_statuses: JobMove[];
};

export const providerJobs = {
  list: () => apiFetch<ProviderJob[]>('/me/job-requests'),
  move: (id: string, status: JobMove) =>
    apiFetch<ProviderJob>(`/me/job-requests/${id}/status`, { method: 'POST', body: { status } }),
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: 'New request',
  accepted: 'Accepted',
  declined: 'Declined',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled by the owner',
};

/** The button for each move, and what the provider is told once it saved. */
export const JOB_MOVES: Record<JobMove, { label: string; done: string }> = {
  accepted: { label: 'Accept', done: 'Job accepted. The owner has been told.' },
  declined: { label: 'Decline', done: 'Job declined. The owner has been told.' },
  in_progress: { label: 'Start job', done: 'Job started. The owner has been told.' },
  completed: { label: 'Mark completed', done: 'Job completed. The owner has been told.' },
};
