import { statusPill } from '@/app/lib/inspections';

/** A slot's, booking's or record's status, in words and colour. */
export default function StatusPill({ kind, status }: { kind: 'slot' | 'booking' | 'record'; status: string }) {
  const { label, className } = statusPill(kind, status);
  return (
    <span className={`inline-flex min-h-7 shrink-0 items-center rounded-full border bg-white px-3 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}
