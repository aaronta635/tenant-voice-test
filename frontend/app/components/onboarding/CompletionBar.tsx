/** A labelled count of rows done, as a bar that reports its value and keeps its edge and fill in forced colours. */
export default function CompletionBar({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div className="mt-5">
      <div className="flex justify-between gap-3 text-sm text-text-dark">
        <span>{label}</span>
        <span className="shrink-0">
          {done} of {total} completed
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={`${done} of ${total} completed`}
        className="mt-2 h-2.5 rounded-full border border-control-border bg-surface"
      >
        <div
          className="h-full rounded-full bg-primary forced-colors:bg-[Highlight]"
          style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
        />
      </div>
    </div>
  );
}
