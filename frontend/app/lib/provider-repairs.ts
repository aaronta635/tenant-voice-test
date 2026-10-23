// The repairs owners assigned to the signed-in provider (backend /me/repairs,
// tracker R33). The street address, access notes and tenant arrive only once
// a visit is booked. Visit times are Sydney wall-clock times, as the server
// books them.

import { apiFetch } from './api';
import { categoryLabel } from './repair-categories';

export type RepairStage = 'assigned' | 'scheduled' | 'completed' | 'cancelled';

export type ProviderRepair = {
  id: string;
  /** awaiting_confirmation once marked done, until the tenant confirms the work. */
  status: 'open' | 'in_progress' | 'awaiting_confirmation' | 'resolved' | 'cancelled';
  stage: RepairStage;
  /** One of the eight shared codes (lib/repair-categories). */
  category: string;
  category_label?: string | null;
  priority: string;
  title: string;
  description: string;
  /** Short-lived links to the tenant's photos. */
  photo_urls?: string[];
  property_title: string | null;
  suburb: string | null;
  state: string | null;
  address: string | null;
  access_notes: string | null;
  tenant_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  appointment_at: string | null;
  estimated_duration_minutes: number | null;
  appointment_note: string | null;
  completed_at: string | null;
  completion_note: string | null;
  /** The tenant's 1 to 5, once they confirmed or rated the job. */
  tenant_rating?: number | null;
  created_at: string;
  updated_at: string;
};

/** A visit as the schedule endpoint takes it: a Sydney date and time. */
export type RepairVisit = { date: string; time: string; duration_minutes: number; note: string | null };

export const providerRepairs = {
  list: () => apiFetch<ProviderRepair[]>('/me/repairs'),
  schedule: (id: string, visit: RepairVisit) =>
    apiFetch<ProviderRepair>(`/me/repairs/${id}/schedule`, { method: 'POST', body: visit }),
  complete: (id: string, note: string) =>
    apiFetch<ProviderRepair>(`/me/repairs/${id}/complete`, { method: 'POST', body: { note } }),
};

export const STAGE_LABELS: Record<RepairStage, string> = {
  assigned: 'Needs a visit',
  scheduled: 'Visit booked',
  completed: 'Done',
  cancelled: 'Cancelled',
};

/** A repair's category label (lib/repair-categories): a code the backend does not know reads as General. */
export function repairCategoryLabel(code: string): string {
  return categoryLabel(code);
}

/** The four priorities, as the mobile app names them. */
export const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent', high: 'High priority', medium: 'Medium priority', low: 'Low priority',
};

/** "45 min", "1 h", "1 h 30 min". */
export function formatVisitLength(minutes: number | null | undefined): string {
  if (!minutes) return '';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

const SYDNEY = 'Australia/Sydney';

/** A moment as Sydney wall-clock "YYYY-MM-DDTHH:MM", which compares as text. */
export function sydneyWallClock(at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: SYDNEY, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(at).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Whether the visit has started, so the job can be marked done (the server checks it again). */
export function visitHasStarted(repair: Pick<ProviderRepair, 'appointment_at'>, now = new Date()): boolean {
  if (!repair.appointment_at) return false;
  const at = new Date(repair.appointment_at).getTime();
  return !Number.isNaN(at) && at <= now.getTime();
}

/** The visit form's first values: a booked visit's own, else tomorrow at 9 am, for an hour. */
export function visitFormValues(repair: Pick<ProviderRepair, 'appointment_at' | 'estimated_duration_minutes' | 'appointment_note'>, now = new Date()) {
  const booked = repair.appointment_at ? new Date(repair.appointment_at) : null;
  if (booked && !Number.isNaN(booked.getTime())) {
    const [date, time] = sydneyWallClock(booked).split('T');
    return { date, time, duration: repair.estimated_duration_minutes ?? 60, note: repair.appointment_note ?? '' };
  }
  const tomorrow = sydneyWallClock(new Date(now.getTime() + 24 * 60 * 60 * 1000)).slice(0, 10);
  return { date: tomorrow, time: '09:00', duration: 60, note: '' };
}

/** Why a visit typed into the form cannot be booked, or null. */
export function visitProblem(date: string, time: string, now = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return 'Choose the day and time of the visit.';
  if (`${date}T${time}` <= sydneyWallClock(now)) return 'Choose a visit time that has not passed yet.';
  return null;
}
