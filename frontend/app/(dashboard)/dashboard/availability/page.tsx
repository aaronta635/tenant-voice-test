'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import FormMessage from '@/app/components/ui/FormMessage';
import EmptyState from '@/app/components/ui/EmptyState';
import { validTimeRange } from '@/app/lib/provider-workspace';
import { dayChanges, dayDraft, dayIsDirty, hiddenWindows, type DayDraft } from '@/app/lib/provider-availability';
import { formatTime } from '@/app/lib/format';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import {
  api,
  ApiError,
  orNotFound,
  type Availability,
  type ServiceProvider,
} from '@/app/lib/api';

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
] as const;

function weekFrom(rows: Availability[]): Record<number, DayDraft> {
  return Object.fromEntries(DAYS.map((day) => [day.value, dayDraft(rows, day.value)])) as Record<number, DayDraft>;
}

export default function AvailabilityPage() {
  const saveOrigin = useRef<HTMLElement | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [rows, setRows] = useState<Availability[]>([]);
  const [week, setWeek] = useState<Record<number, DayDraft>>(() => weekFrom([]));
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savePosition, setSavePosition] = useState<'top' | 'bottom'>('top');
  const [invalidDay, setInvalidDay] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  function applyRows(availability: Availability[]) {
    setRows(availability);
    setWeek(weekFrom(availability));
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [mine, availability] = await Promise.all([
          orNotFound<ServiceProvider | null>(api.providers.mine(), null),
          orNotFound(api.providers.myAvailability(), []),
        ]);
        if (!active) return;
        setProvider(mine);
        setNote(mine?.availability_note ?? '');
        applyRows(availability);
      } catch (err) {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Could not load your availability.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const enabledCount = useMemo(
    () => DAYS.filter((day) => week[day.value]?.enabled).length,
    [week],
  );

  function updateDay(day: number, patch: Partial<DayDraft>) {
    setSaved(false);
    setError(null);
    setWeek((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  }

  const dirty = note.trim() !== (provider?.availability_note ?? '') || DAYS.some((day) => dayIsDirty(week[day.value], rows, day.value));

  async function handleSave(position: 'top' | 'bottom') {
    if (saving || !provider || !dirty) return;
    setSavePosition(position);
    saveOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(null); setSaved(false); setInvalidDay(null);
    const invalid = DAYS.find((day) => week[day.value].enabled && !validTimeRange(week[day.value].start_time, week[day.value].end_time));
    if (invalid) {
      setError(`${invalid.label}: enter both times, with end time after start time.`);
      setInvalidDay(invalid.value);
      document.getElementById(`availability-${invalid.value}-start`)?.focus();
      return;
    }
    setSaving(true);
    try {
      for (const day of DAYS) {
        const draft = week[day.value];
        // Every saved row for the day must end up matching the one window shown.
        const { keep, save, remove } = dayChanges(draft, rows, day.value);
        if (save) {
          const payload = { day_of_week: day.value, start_time: draft.start_time, end_time: draft.end_time, is_available: true };
          const savedRow = keep ? await api.providers.updateAvailability(keep.id, payload) : await api.providers.createAvailability(payload);
          // Update only the saved baseline. Keep every unsaved draft intact on a later failure.
          setRows((prev) => [...prev.filter((row) => row.id !== savedRow.id), savedRow]);
        }
        for (const row of remove) {
          await api.providers.deleteAvailability(row.id);
          setRows((prev) => prev.filter((item) => item.id !== row.id));
        }
      }
      if (note.trim() !== (provider.availability_note ?? '')) {
        setProvider(await api.providers.updateMine({ availability_note: note.trim() || null }));
      }
      setSaved(true);
    } catch (err) {
      // Refresh only the saved baseline: a timed-out request may still have committed.
      // Never replace week/note here; those are the provider's unsaved draft.
      try { setRows(await api.providers.myAvailability()); } catch { /* Preserve known successful row IDs. */ }
      setError(`${err instanceof Error ? err.message : 'Could not save availability.'} Your edits are retained. Some days may have saved; retry saves only the remaining changes.`);
    } finally { setSaving(false); requestAnimationFrame(() => saveOrigin.current?.focus()); }
  }

  if (loading) {
    return <div><h1 className="font-heading text-h2 font-semibold text-text-dark">Availability</h1><p role="status">Loading availability…</p></div>;
  }
  if (loadError) {
    return (
      <div className="space-y-6"><h1 className="font-heading text-h2 font-semibold text-text-dark">Availability</h1><LoadErrorCard
        message={loadError}
        onRetry={() => {
          setLoading(true);
          setLoadError(null);
          setReloadKey((k) => k + 1);
        }}
      /></div>
    );
  }

  if (!provider) return <div className="space-y-6"><h1 className="font-heading text-h2 font-semibold text-text-dark">Availability</h1><EmptyState title="Create your provider profile" description="Complete the first onboarding step before setting booking hours." action={<Link href="/dashboard/onboarding" className="font-bold text-primary-strong underline">Start onboarding</Link>} /></div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-h2 font-semibold text-text-dark">
            Availability
          </h1>
          <p className="mt-1 text-[#5f6b76]">
            Set the days and hours clients can book you. {provider.is_published ? "These slots appear on your public profile." : "Publish your profile after setup so clients can request these slots."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSave('top')}
          aria-disabled={saving || !dirty}
          className="inline-flex min-h-11 shrink-0 items-center self-start rounded-lg bg-primary-strong px-4 text-sm font-bold whitespace-nowrap text-white disabled:opacity-60 sm:self-auto"
        >
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
      </div>

      <div id="availability-top-message"><FormMessage error={savePosition === "top" ? error : null} success={savePosition === "top" && saved ? "Availability saved." : dirty ? "You have unsaved schedule changes." : null} /></div>
      <section className="rounded-xl border border-border bg-white shadow-sm p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-[#1b1b1f]">Weekly hours</h2>
            <p className="mt-1 text-sm text-[#5f6b76]">
              {enabledCount === 0
                ? 'No days enabled yet.'
                : `${enabledCount} day${enabledCount === 1 ? '' : 's'} open for bookings.`}
            </p>
          </div>
          <Link href="/dashboard/bookings" className="shrink-0 whitespace-nowrap text-sm font-semibold text-primary-strong">
            View bookings →
          </Link>
        </div>

        <ul className="mt-5 divide-y divide-[#f4f4f8]">
          {DAYS.map((day) => {
            const draft = week[day.value];
            const hidden = hiddenWindows(rows, day.value);
            return (
              <li
                key={day.value}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
              >
                <label className="flex items-center gap-3 text-sm font-semibold text-[#1b1b1f]">
                  <input
                    type="checkbox"
                    disabled={saving}
                    checked={draft.enabled}
                    onChange={(e) => updateDay(day.value, { enabled: e.target.checked })}
                    className="size-4 accent-primary"
                  />
                  {day.label}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="time"
                    id={`availability-${day.value}-start`}
                    aria-invalid={invalidDay === day.value}
                    aria-describedby={invalidDay === day.value ? `availability-${savePosition}-message` : undefined}
                    value={draft.start_time}
                    disabled={!draft.enabled || saving}
                    onChange={(e) => updateDay(day.value, { start_time: e.target.value })}
                    className="h-10 rounded-[12px] border border-control-border bg-[#fafafe] px-3 text-sm disabled:opacity-40"
                    aria-label={`${day.label} start time`}
                  />
                  <span className="text-xs text-[#5f6b76]">to</span>
                  <input
                    type="time"
                    aria-invalid={invalidDay === day.value}
                    aria-describedby={invalidDay === day.value ? `availability-${savePosition}-message` : undefined}
                    value={draft.end_time}
                    disabled={!draft.enabled || saving}
                    onChange={(e) => updateDay(day.value, { end_time: e.target.value })}
                    className="h-10 rounded-[12px] border border-control-border bg-[#fafafe] px-3 text-sm disabled:opacity-40"
                    aria-label={`${day.label} end time`}
                  />
                </div>
                {hidden.length > 0 ? (
                  <p className="text-sm text-warning sm:basis-full">
                    Also saved for {day.label}: {hidden.map((row) => `${formatTime(row.start_time)}–${formatTime(row.end_time)}`).join(', ')}. Clients can book these hours too. Saving keeps only what is shown here.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-white shadow-sm p-5">
        <h2 className="font-bold text-[#1b1b1f]">Availability note</h2>
        <p className="mt-1 text-sm text-[#5f6b76]">
          Shown on your marketplace card — e.g. “Available weekdays” or “Same-week bookings”.
        </p>
        <input
          value={note}
          onChange={(e) => { setSaved(false); setNote(e.target.value); }}
          disabled={saving}
          aria-label="Availability note"
          placeholder="Available weekdays · Same-week bookings"
          className="mt-4 h-11 w-full rounded-[14px] border border-control-border bg-[#fafafe] px-4 text-sm outline-none focus:border-primary"
        />
      </section>
      <div id="availability-bottom-message"><FormMessage error={savePosition === "bottom" ? error : null} success={savePosition === "bottom" && saved ? "Availability saved." : null} /></div>
      <button type="button" onClick={() => void handleSave('bottom')} aria-disabled={saving || !dirty} className="inline-flex min-h-11 items-center rounded-lg border border-transparent bg-primary-strong px-5 text-sm font-bold text-white">{saving ? 'Saving…' : 'Save schedule'}</button>
    </div>
  );
}
