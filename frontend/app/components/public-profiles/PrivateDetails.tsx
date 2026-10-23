import ConnectPanel from '@/app/components/public-profiles/ConnectPanel';
import ConnectButton from '@/app/components/trust/ConnectButton';
import ButtonLink from '@/app/components/ui/ButtonLink';
import type { BackendRole } from '@/app/lib/api';
import { authPageHref } from '@/app/lib/auth-redirect';

type Props = {
  role: 'tenant' | 'landlord';
  /** The member's users.id, to connect with them. */
  userId: string;
  name: string;
  /** The profile page, for sign-in and sign-up to return to. */
  path: string;
  signedIn: boolean;
};

// What a public profile leaves out (tracker assumption #1).
export const PRIVATE_SECTIONS: Record<Props['role'], string[]> = {
  tenant: ['Contact details', 'Rental history', 'Employment and income', 'References', 'Documents'],
  landlord: ['Contact details', 'Properties and tenancies', 'Documents'],
};
// The text under the blur is always this filler, never the member's data,
// so there is nothing private in the page to unblur or copy.
export const PLACEHOLDER_LINES = ['Private detail', 'Not on public profiles', 'Shared with connections only'];
// A sign-up names an account type, else it starts a provider's: landlords
// look tenants up, and tenants look landlords up.
const SIGN_UP_ROLE: Record<Props['role'], BackendRole> = { tenant: 'landlord', landlord: 'tenant' };

/** Blurred stand-ins for the private sections, and how to connect with the member. */
export default function PrivateDetails({ role, userId, name, path, signedIn }: Props) {
  return (
    <section aria-labelledby="private-details-heading" className="rounded-2xl border border-border bg-white p-5">
      <h2 id="private-details-heading" className="font-heading text-xl font-bold text-text-dark">Private details</h2>
      <p className="mt-1 text-sm text-text-body">A public profile never shows these.</p>
      <ul className="mt-4 space-y-3">
        {PRIVATE_SECTIONS[role].map((title) => (
          <li key={title} className="rounded-xl border border-border p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-text-dark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4 shrink-0" aria-hidden>
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              {title}
            </p>
            <div aria-hidden data-private-placeholder="" className="mt-2 space-y-1 blur-[3px] select-none">
              {PLACEHOLDER_LINES.map((line) => <p key={line} className="text-sm text-text-body">{line}</p>)}
            </div>
          </li>
        ))}
      </ul>
      {signedIn ? (
        <ConnectPanel key={userId} userId={userId} name={name} path={path} />
      ) : (
        <div className="mt-5 rounded-xl bg-surface p-4">
          <p className="font-semibold text-text-dark">Sign in or create an account to see more</p>
          <p className="mt-1 text-sm text-text-body">With an account you can connect with members. Private details are never shown on public profiles.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <ConnectButton userId={userId} name={name} signedIn={false} returnTo={path} />
            <ButtonLink href={authPageHref('/register', SIGN_UP_ROLE[role], path)} variant="secondary">Create an account</ButtonLink>
          </div>
        </div>
      )}
    </section>
  );
}
