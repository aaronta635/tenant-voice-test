import Link, { type LinkProps } from 'next/link';

type BrandLogoProps = {
  href?: string;
  /** Passed to the Link, such as navigateWithinPage when href can be the open page. */
  onNavigate?: LinkProps['onNavigate'];
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  className?: string;
};

/** Heights match Figma Logo lockup (320×134). */
const sizes = {
  sm: { height: 32, markHeight: 28 },
  md: { height: 44, markHeight: 36 },
  lg: { height: 56, markHeight: 48 },
};

const LOGO_SRC = '/brand/tenantvoice-logo.svg';
const LOGO_WIDTH = 320;
const LOGO_HEIGHT = 134;
const LOGO_ASPECT = LOGO_WIDTH / LOGO_HEIGHT;
/** Icon sits in the top ~82% of the Figma Logo frame. */
const MARK_CROP = 0.82;
/** Visible icon crop is full width × cropped height (~320 / 109.88). */
const MARK_ASPECT = LOGO_WIDTH / (LOGO_HEIGHT * MARK_CROP);

/**
 * Official TenantVoice lockup from Figma (Hifi-capstone → Logo).
 * Full mark + TENANTVOICE wordmark, or icon-only via showWordmark={false}.
 */
export function BrandMark({ size = 36 }: { size?: number }) {
  const width = Math.round(size * MARK_ASPECT);
  const cropHeight = Math.round(size / MARK_CROP);

  return (
    <span
      className="relative inline-block overflow-hidden"
      style={{ width, height: size }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LOGO_SRC}
        alt=""
        width={width}
        height={cropHeight}
        className="absolute left-0 top-0 max-w-none"
        style={{ width, height: cropHeight }}
        draggable={false}
      />
    </span>
  );
}

export default function BrandLogo({
  href = '/',
  onNavigate,
  size = 'md',
  showWordmark = true,
  className = '',
}: BrandLogoProps) {
  const s = sizes[size];

  const content = showWordmark ? (
    <span className={`inline-flex items-center ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LOGO_SRC}
        alt="TenantVoice"
        height={s.height}
        width={Math.round(s.height * LOGO_ASPECT)}
        className="block h-auto max-w-none"
        style={{ height: s.height, width: Math.round(s.height * LOGO_ASPECT) }}
        draggable={false}
      />
    </span>
  ) : (
    <span className={`inline-flex items-center ${className}`}>
      <BrandMark size={s.markHeight} />
    </span>
  );

  if (!href) return content;

  return (
    <Link
      href={href}
      onNavigate={onNavigate}
      aria-label="Go to TenantVoice home"
      className="-m-2 inline-flex items-center rounded-[8px] p-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      {content}
    </Link>
  );
}
