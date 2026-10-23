'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import OnboardingFrame from '@/app/components/onboarding/OnboardingFrame';
import WelcomeCard, { type WelcomeCopy } from '@/app/components/onboarding/WelcomeCard';
import type { StepHandle, StepProps } from '@/app/components/onboarding/step-types';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { getMyProfile, updateMyProfile, type MyProfile } from '@/app/lib/my-profile';
import {
  ONBOARDING_HREF,
  onboardingApi,
  onboardingExit,
  type OnboardingProgress,
  type OnboardingRole,
} from '@/app/lib/onboarding';
import type { StepInfo } from '@/app/lib/onboarding-steps';

/** The welcome step's name in users.metadata.onboarding.<role>.step. */
export const WELCOME = 'welcome';

/** A step of lib/onboarding-steps with the form it shows. */
export type OnboardingStep = StepInfo & { Step: ComponentType<StepProps> };

type Props = { role: OnboardingRole; welcome: WelcomeCopy; steps: OnboardingStep[] };

type Loaded = { attempt: number; progress: OnboardingProgress | null; error: string | null };
type Busy = 'start' | 'skip' | 'back' | 'continue' | 'close' | 'finish';

const FALLBACK_ERROR = 'Could not save this step. Please try again.';
const ROLE_NOUNS: Record<OnboardingRole, string> = { tenant: 'tenant', landlord: 'landlord' };

/**
 * Where a visit starts: the saved step, or the welcome step when there is
 * none, it is one the wizard no longer has, or the member already finished.
 * Positions count the welcome step as 0.
 */
export function startPosition(steps: OnboardingStep[], progress: OnboardingProgress): number {
  if (!progress.step || progress.completed_at) return 0;
  return steps.findIndex((step) => step.key === progress.step) + 1;
}

/**
 * A tenant's or landlord's onboarding (R19). Each step's answers save to the
 * account through the profile API when the member moves on, Back included,
 * and then the step to resume at; so a later visit, in any browser, opens
 * where they left off. Save & close, Skip for now and the last step's Finish
 * all leave for the task the member started before signing up (`next`), else
 * their dashboard; only Finish marks setup done.
 */
export default function OnboardingWizard({ role, welcome, steps }: Props) {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const exit = onboardingExit(role, next);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The server keeps no place for this member (409: another app stored it in another shape).
  const [placeLost, setPlaceLost] = useState(false);
  // Set at once, so a second click before the buttons re-render starts nothing.
  const running = useRef(false);
  const handle = useRef<StepHandle | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = loaded?.attempt === attempt ? loaded : null;
  const ready = Boolean(current?.progress && profile);

  useEffect(() => {
    let active = true;
    Promise.all([getMyProfile(), onboardingApi.get()]).then(
      ([me, progress]) => {
        if (!active) return;
        setProfile(me);
        setPosition(startPosition(steps, progress));
        setLoaded({ attempt, progress, error: null });
      },
      (err) => {
        if (active) setLoaded({ attempt, progress: null, error: err instanceof ApiError ? err.message : 'Please try again.' });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, steps]);

  useEffect(() => {
    // Each step opens at its heading, so a screen reader starts there.
    if (!ready) return;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'start' });
  }, [position, ready]);

  if (!current) {
    return (
      <OnboardingFrame>
        <p role="status" className="text-sm text-text-body">Loading your setup…</p>
      </OnboardingFrame>
    );
  }
  if (!current.progress || !profile) {
    return (
      <OnboardingFrame>
        <LoadErrorCard
          title="Your setup could not be loaded"
          message={current.error ?? undefined}
          onRetry={() => setAttempt((count) => count + 1)}
        />
      </OnboardingFrame>
    );
  }
  const progress = current.progress;
  if (progress.role !== role) {
    return (
      <OnboardingFrame accountId={profile.id}>
        <Card className="p-6 text-center sm:p-8">
          <h1 className="font-heading text-2xl font-bold text-text-dark">This setup is for {ROLE_NOUNS[role]} accounts</h1>
          <p className="mt-2 text-sm text-text-body">You are signed in with a {ROLE_NOUNS[progress.role]} account, which has its own setup.</p>
          <ButtonLink href={ONBOARDING_HREF[progress.role]} className="mt-5">
            Open my setup
          </ButtonLink>
        </Card>
      </OnboardingFrame>
    );
  }

  const step = position > 0 ? steps[position - 1] : null;
  const last = position === steps.length;

  /**
   * Runs one action at a time; one that leaves the page keeps the buttons disabled.
   * The pressed button is disabled while the action runs, which drops focus to
   * the page: when the member stays on this step, it has focus again.
   */
  async function run(kind: Busy, action: () => Promise<'left' | void>) {
    if (running.current) return;
    running.current = true;
    const pressed = document.activeElement as HTMLElement | null;
    setBusy(kind);
    setError(null);
    try {
      if ((await action()) === 'left') return;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : FALLBACK_ERROR);
    }
    running.current = false;
    setBusy(null);
    // A new step's heading, or the field a problem names, keeps the focus it took.
    requestAnimationFrame(() => focusResult(pressed, null));
  }

  /** Saves what the open step changed; false, with the reason shown, when it has a problem to fix first. */
  async function saveAnswers(): Promise<boolean> {
    const answers = handle.current?.answers() ?? null;
    if (answers && 'problem' in answers) {
      setError(answers.problem);
      if (answers.field) document.getElementById(answers.field)?.focus();
      return false;
    }
    if (answers) setProfile(await updateMyProfile(answers.patch));
    return true;
  }

  /**
   * Records the step to resume at, keeping what the server answers. A place
   * the server cannot keep (409) never stops the member: their answers are
   * saved, and they are told once that setup will not resume where they leave.
   */
  async function remember(key: string, completed = false) {
    try {
      const saved = await onboardingApi.save(key, completed);
      setLoaded((previous) => (previous ? { ...previous, progress: saved } : previous));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) throw err;
      setPlaceLost(true);
    }
  }

  const lostNotice = placeLost ? (
    <p role="status" className="mt-4 rounded-lg border border-warning bg-white p-3 text-sm text-warning">
      Your answers are saved, but this setup can&apos;t remember the step you reached: another app keeps it in a form
      the website can&apos;t change. Next time it starts at the beginning.
    </p>
  ) : null;

  const start = () => run('start', async () => {
    await remember(steps[0].key);
    setPosition(1);
  });
  const skip = () => run('skip', async () => {
    // Best effort: the record only lets the dashboard offer to finish setup, so
    // leaving never waits on it. A finished setup has nothing left to offer.
    if (!progress.completed_at) await remember(WELCOME).catch(() => undefined);
    router.push(exit);
    return 'left';
  });
  const back = () => run('back', async () => {
    if (await saveAnswers()) setPosition(position - 1);
  });
  const forward = () => run('continue', async () => {
    if (!(await saveAnswers())) return;
    await remember(steps[position].key);
    setPosition(position + 1);
  });
  const close = () => run('close', async () => {
    if (!step || !(await saveAnswers())) return;
    await remember(step.key);
    router.push(exit);
    return 'left';
  });
  const finish = () => run('finish', async () => {
    if (!step || !(await saveAnswers())) return;
    await remember(step.key, true);
    router.push(exit);
    return 'left';
  });

  if (!step) {
    return (
      <OnboardingFrame accountId={profile.id}>
        <WelcomeCard
          copy={welcome}
          finished={Boolean(progress.completed_at)}
          resumes={exit !== onboardingExit(role, null)}
          busy={busy !== null}
          headingRef={heading}
          onStart={start}
          onSkip={skip}
        />
        {lostNotice}
        <FormMessage error={error} className="mt-4" />
      </OnboardingFrame>
    );
  }

  const Step = step.Step;
  return (
    <OnboardingFrame
      accountId={profile.id}
      place={{ label: step.label, position, total: steps.length }}
      action={(
        <Button variant="ghost" size="sm" onClick={close} disabled={busy !== null}>
          {busy === 'close' ? 'Saving…' : 'Save & close'}
        </Button>
      )}
    >
      <Card className="p-6 sm:p-8">
        <h1 ref={heading} tabIndex={-1} className="scroll-mt-40 font-heading text-2xl font-bold text-text-dark">
          {step.title}
        </h1>
        <p className="mt-1 text-sm text-text-body">{step.description}</p>
        <div className="mt-6">
          <Step key={step.key} profile={profile} handle={handle} />
        </div>
      </Card>
      {lostNotice}
      <FormMessage error={error} className="mt-4" />
      <div className="mt-6 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={back} disabled={busy !== null}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
          {busy === 'back' ? 'Saving…' : 'Back'}
        </Button>
        <Button onClick={last ? finish : forward} disabled={busy !== null}>
          {busy === 'continue' || busy === 'finish' ? 'Saving…' : last ? 'Finish setup' : 'Continue'}
          {last ? null : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden>
              <path d="m9 18 6-6-6-6" />
            </svg>
          )}
        </Button>
      </div>
    </OnboardingFrame>
  );
}
