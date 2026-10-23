import { mergeClasses } from '@/app/components/ui/merge-classes';

type Props = {
  /** The badge's accessible name, also its tooltip. */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
};

export const VERIFIED_LABEL = 'Verified by TenantVoice';

const SIZES = { sm: 'size-4', md: 'size-5' } as const;

/**
 * The one verified badge for profiles (R23): the brand-coloured seal with a
 * white check from the design reference. Render it only when the API says
 * the account is verified, which an admin's approval of the account decides
 * (backend services/badges.py); an uploaded document never earns it. It
 * sits after a name, so it is an image with its own name rather than text
 * inside a heading.
 */
export default function VerifiedBadge({ label = VERIFIED_LABEL, size = 'md', className = '' }: Props) {
  return (
    <span role="img" aria-label={label} title={label} className={mergeClasses('inline-flex shrink-0 align-middle', className)}>
      <svg viewBox="0 0 24 24" className={`${SIZES[size]} text-primary`} aria-hidden>
        <path
          fill="currentColor"
          d="M8.59 3.78Q12-2.38 15.41 3.78Q22.17 1.83 20.22 8.59Q26.38 12 20.22 15.41Q22.17 22.17 15.41 20.22Q12 26.38 8.59 20.22Q1.83 22.17 3.78 15.41Q-2.38 12 3.78 8.59Q1.83 1.83 8.59 3.78Z"
        />
        {/* Forced colours paint the seal in the text colour, so the check takes the page's. */}
        <path d="m8 12.3 2.6 2.6L16 9.4" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="forced-colors:stroke-[Canvas]" />
      </svg>
    </span>
  );
}
