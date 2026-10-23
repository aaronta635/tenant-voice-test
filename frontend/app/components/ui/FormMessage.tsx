type FormMessageProps = {
  error?: string | null;
  success?: string | null;
  className?: string;
};

/** Keep both live regions mounted so changes are announced reliably. */
export default function FormMessage({ error, success, className = '' }: FormMessageProps) {
  return <div className={`space-y-2 text-sm ${className}`}>
    <p role="alert" aria-atomic="true" className={error ? 'rounded-lg border border-danger p-3 text-danger' : ''}>{error ?? ''}</p>
    <p role="status" aria-live="polite" aria-atomic="true" className={success ? 'rounded-lg border border-success p-3 text-success' : ''}>{success ?? ''}</p>
  </div>;
}
