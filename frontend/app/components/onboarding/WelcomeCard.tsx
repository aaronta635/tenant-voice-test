import type { ReactNode, RefObject } from 'react';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';

export type WelcomeIcon = 'shield' | 'home' | 'lock' | 'briefcase';

/** What a role's welcome step says. */
export type WelcomeCopy = {
  title: string;
  description: string;
  highlights: { icon: WelcomeIcon; title: string; detail: string }[];
  duration: string;
};

type Props = {
  copy: WelcomeCopy;
  /** The member finished before: the step offers a review instead of a start. */
  finished: boolean;
  /** A task started before sign-up waits for the end of setup. */
  resumes: boolean;
  busy: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onStart: () => void;
  onSkip: () => void;
};

/** The wizard's first step: what setup is for, then start or skip it (reference step 1). */
export default function WelcomeCard({ copy, finished, resumes, busy, headingRef, onStart, onSkip }: Props) {
  return (
    <Card className="px-6 py-10 text-center sm:px-10">
      <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-surface text-primary-strong">
        <Icon name="shield" className="size-9" />
      </span>
      <h1 ref={headingRef} tabIndex={-1} className="mt-6 scroll-mt-24 font-heading text-[30px] font-bold leading-9 text-text-dark">
        {finished ? 'Your profile is set up' : copy.title}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-base text-text-body">
        {finished ? 'You finished setup. Go through the steps again to review or change your answers.' : copy.description}
      </p>
      {finished ? null : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-3">
          {copy.highlights.map((item) => (
            <li key={item.title} className="rounded-xl border border-border bg-background px-4 py-4">
              <Icon name={item.icon} className="mx-auto size-5 text-primary-strong" />
              <p className="mt-2 text-sm font-semibold text-text-dark">{item.title}</p>
              <p className="mt-1 text-xs text-text-body">{item.detail}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-text-body">
        {finished ? 'Each step saves as you go.' : `${copy.duration} Each step saves as you go, so you can stop and pick up where you left off.`}
        {resumes ? ' When you finish or leave setup, you go back to what you started.' : ''}
      </p>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button size="lg" onClick={onStart} disabled={busy} className="w-full sm:w-auto">
          {finished ? 'Review my answers' : 'Get started'}
          <Chevron />
        </Button>
        <Button size="lg" variant="ghost" onClick={onSkip} disabled={busy} className="w-full sm:w-auto">
          {finished ? 'Back to my dashboard' : 'Skip for now'}
        </Button>
      </div>
    </Card>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function Icon({ name, className = '' }: { name: WelcomeIcon; className?: string }) {
  const paths: Record<WelcomeIcon, ReactNode> = {
    shield: (
      <>
        <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M10 20v-6h4v6" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
    briefcase: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      {paths[name]}
    </svg>
  );
}
