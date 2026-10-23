import type { OwnerAssistantConfirmation } from '@/app/lib/owner-assistant';

/** What a confirmed action saved, as the server returned it, and its receipt (R30). id lets the page move focus here. */
export default function ActionReceipt({ outcome, id }: { outcome: OwnerAssistantConfirmation; id?: string }) {
  return (
    <section id={id} tabIndex={-1} aria-label="Saved" className="mt-3 rounded-xl border border-success bg-white p-4 text-sm">
      <p className="font-semibold text-text-dark">Saved: {outcome.message}</p>
      {outcome.saved.length ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          {outcome.saved.map((field, index) => (
            <div key={`${field.label}-${index}`} className="contents">
              <dt className="font-semibold text-text-dark">{field.label}</dt>
              <dd className="min-w-0 break-words text-text-body">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-2 break-words text-text-body">
        {outcome.receipt
          ? `Receipt: ${outcome.receipt}`
          : 'The receipt could not be added to the chat history yet.'}
      </p>
    </section>
  );
}
