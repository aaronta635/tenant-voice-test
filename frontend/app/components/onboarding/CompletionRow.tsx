import ButtonLink from '@/app/components/ui/ButtonLink';

export type RowState = 'done' | 'todo' | 'unavailable';

type Props = {
  label: string;
  description: string;
  kind: 'required' | 'booster';
  state: RowState;
  /** The pill's words where the state alone does not say it, such as a document's "In review". */
  stateLabel?: string;
  /** Where to complete or review it; none while it cannot be done. */
  href?: string;
};

const STATE_LABELS: Record<RowState, string> = {
  done: 'Completed',
  todo: 'Not started',
  unavailable: 'Not available yet',
};
const KIND_LABELS = { required: 'Required', booster: 'Boosts profile' };
const PILLS: Record<RowState, string> = {
  done: 'bg-[#e7f8ef] text-success',
  todo: 'bg-surface text-primary-strong',
  unavailable: 'bg-[#f3f4f6] text-text-body',
};

/** One row of a completion checklist, as the reference's Rental Profile page lists them, with where to fix it. */
export default function CompletionRow({ label, description, kind, state, stateLabel, href }: Props) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <StateIcon state={state} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-text-dark">{label}</span>
          <span
            className={`text-[11px] font-semibold uppercase tracking-[0.8px] ${kind === 'required' ? 'text-danger' : 'text-primary-strong'}`}
          >
            {KIND_LABELS[kind]}
          </span>
        </p>
        <p className="mt-1 text-sm text-text-body">{description}</p>
      </div>
      <span className={`self-start rounded-full px-3 py-1 text-xs font-semibold sm:self-center ${PILLS[state]}`}>
        {stateLabel ?? STATE_LABELS[state]}
      </span>
      {href ? (
        <ButtonLink
          href={href}
          size="sm"
          variant={state === 'done' ? 'secondary' : 'primary'}
          className="self-start sm:self-center"
        >
          {state === 'done' ? 'Review' : 'Complete'}
          <span className="sr-only"> {label}</span>
        </ButtonLink>
      ) : null}
    </li>
  );
}

function StateIcon({ state }: { state: RowState }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`size-6 shrink-0 ${state === 'done' ? 'text-success' : 'text-text-body'}`}
      aria-hidden
    >
      {state === 'done' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </>
      ) : (
        <circle cx="12" cy="12" r="9" strokeDasharray={state === 'unavailable' ? '3 3' : undefined} />
      )}
    </svg>
  );
}
