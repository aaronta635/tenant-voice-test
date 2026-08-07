'use client';

import Button from '@/app/components/ui/Button';

export type StatusFilter = 'pending' | 'accepted' | 'rejected' | 'shortlist';

const FILTER_OPTIONS: { id: StatusFilter; label: string; dotClassName: string }[] = [
  { id: 'pending', label: 'Pending', dotClassName: 'bg-[#efb034]' },
  { id: 'accepted', label: 'Accepted', dotClassName: 'bg-[#22ccb2]' },
  { id: 'rejected', label: 'Rejected', dotClassName: 'bg-[#de3b40]' },
  { id: 'shortlist', label: 'Shortlist', dotClassName: 'bg-primary/30' },
];

export default function FilterApplicationsModal({
  selected,
  onChange,
  onApply,
  onClose,
}: {
  selected: StatusFilter[];
  onChange: (next: StatusFilter[]) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  function toggle(id: StatusFilter) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#171a1f]/30 pt-24 backdrop-blur-[1px]">
      <div className="w-full max-w-md rounded-2xl bg-background p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-2xl font-bold text-text-dark">Filter by Status</h2>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-sm text-text-body">Select application statuses:</p>
          <div className="flex gap-3 text-sm font-medium text-text-dark">
            <button type="button" onClick={() => onChange(FILTER_OPTIONS.map((o) => o.id))}>
              Select All
            </button>
            <button type="button" onClick={() => onChange([])}>
              Clear All
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {FILTER_OPTIONS.map((option) => (
            <label
              key={option.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-white px-4 py-3"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={() => toggle(option.id)}
                className="size-5 rounded border-2 border-text-muted text-primary focus:ring-primary"
              />
              <span className={`size-3.5 rounded-full ${option.dotClassName}`} />
              <span className="text-sm font-medium text-text-dark">{option.label}</span>
            </label>
          ))}
          {/* TODO: "Request More Info" has no corresponding field in the Applicant data
              model yet — omitted from real filtering until that state is tracked. */}
        </div>

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" onClick={onApply}>
            Apply Filters
          </Button>
        </div>
      </div>
    </div>
  );
}
