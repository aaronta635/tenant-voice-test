'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';
import { JOB_MOVES, JOB_STATUS_LABELS, providerJobs, type JobMove, type ProviderJob } from '@/app/lib/provider-jobs';

const OPEN = new Set(['pending', 'accepted', 'in_progress']);

/**
 * The job requests owners sent this provider from the mobile app. A request
 * that came with an assigned repair is booked on the repairs list above.
 */
export default function ProviderJobRequests() {
  const [jobs, setJobs] = useState<ProviderJob[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; error?: string; notice?: string } | null>(null);

  useEffect(() => {
    let active = true;
    providerJobs.list()
      .then((list) => { if (active) { setJobs(list); setLoadError(null); } })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Your job requests could not be loaded.');
      });
    return () => { active = false; };
  }, [attempt]);

  async function move(job: ProviderJob, next: JobMove) {
    if (busy) return;
    setBusy(job.id);
    setResult(null);
    try {
      const saved = await providerJobs.move(job.id, next);
      setJobs((list) => list?.map((item) => (item.id === saved.id ? saved : item)) ?? list);
      setResult({ id: job.id, notice: JOB_MOVES[next].done });
    } catch (err) {
      setResult({ id: job.id, error: err instanceof ApiError ? err.message : 'Could not update this job. Please try again.' });
    } finally {
      setBusy(null);
    }
  }

  const open = jobs?.filter((job) => OPEN.has(job.status)).length ?? 0;

  return (
    <section aria-labelledby="job-requests-heading" className="space-y-4">
      <div>
        <h2 id="job-requests-heading" className="font-heading text-xl font-semibold text-text-dark">Job requests</h2>
        <p className="mt-1 text-sm text-text-body">
          Jobs owners asked you for in the TenantVoice mobile app. Accept or decline each one; the owner is told.
          {open ? ` ${open} ${open === 1 ? 'is' : 'are'} open.` : ''}
        </p>
      </div>
      {loadError ? (
        <Card className="p-6">
          <p className="text-sm text-text-body">{loadError}</p>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => { setLoadError(null); setJobs(null); setAttempt((n) => n + 1); }}>
            Try again
          </Button>
        </Card>
      ) : !jobs ? (
        <p role="status" className="text-sm text-text-body">Loading your job requests…</p>
      ) : jobs.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-text-body">No job requests yet. When an owner asks you for a job in the mobile app, it appears here.</p>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {jobs.map((job) => (
            // min-w-0: a long word or link in a job must wrap, not widen the grid past the screen.
            <li key={job.id} className="min-w-0">
              <Card className="min-w-0 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-heading text-lg font-semibold [overflow-wrap:anywhere] text-text-dark">{job.title}</h3>
                    <p className="mt-1 text-sm text-text-body">
                      {[job.owner_name, job.property_title, job.created_at ? formatDate(job.created_at) : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-bold text-primary-strong">{JOB_STATUS_LABELS[job.status]}</span>
                </div>
                {job.description ? <p className="mt-3 whitespace-pre-line text-sm [overflow-wrap:anywhere] text-text-dark">{job.description}</p> : null}
                {job.from_repair ? (
                  <p className="mt-3 text-sm text-text-body">
                    This came with a repair: book its visit and mark it done from <Link href="/dashboard/repairs" className="font-semibold text-primary-strong underline">your assigned repairs</Link>.
                    {job.next_statuses.includes('declined')
                      ? ' Declining it here does not hand the repair back: ask the owner to assign someone else.'
                      : null}
                  </p>
                ) : null}
                {job.next_statuses.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {job.next_statuses.map((next) => (
                      <Button key={next} type="button" variant={next === 'declined' ? 'secondary' : 'primary'} disabled={busy === job.id}
                        onClick={() => void move(job, next)} aria-label={`${JOB_MOVES[next].label}: ${job.title}`}>
                        {JOB_MOVES[next].label}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <FormMessage error={result?.id === job.id ? result.error : null} success={result?.id === job.id ? result.notice : null}
                  className={result?.id === job.id ? 'mt-3' : ''} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
