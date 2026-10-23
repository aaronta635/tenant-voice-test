import type { ProviderSuggestion } from '@/app/lib/owner-assistant';

/** Providers for the owner's question (R31): verified, public profiles from mobile_owner_provider_search. */
export default function ProviderSuggestions({ providers }: { providers: ProviderSuggestion[] }) {
  if (!providers.length) return null;
  return (
    <section aria-label="Suggested providers" className="mt-3 rounded-xl border border-border bg-white p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-body">Suggested providers</p>
      <ol className="mt-2 space-y-2">
        {providers.map((provider) => (
          <li key={provider.id}>
            <p className="break-words font-semibold text-text-dark">{provider.name}</p>
            <p className="break-words text-text-body">{provider.reasons.join(' · ')}</p>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-text-body">Verified providers with public profiles, best rated first.</p>
    </section>
  );
}
