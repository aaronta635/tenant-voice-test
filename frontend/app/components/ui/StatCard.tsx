import Card from './Card';

/** Consistent workspace metric: label, value, then supporting context. */
export default function StatCard({ label, value, hint }: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="min-w-0 p-5">
      <p className="text-sm font-medium text-text-body">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold text-text-dark">{value}</p>
      {hint ? <p className="mt-1 text-sm text-text-muted">{hint}</p> : null}
    </Card>
  );
}
